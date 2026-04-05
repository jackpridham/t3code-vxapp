# Orchestrator Worker Wake Queue Design

**Date:** 2026-04-05
**Repo:** `t3code-vxapp`
**Status:** `Proposed`

## Objective

Add first-class orchestrator wake support to T3 so worker threads dispatched under an orchestrator can safely notify that orchestrator when they finish, without interrupting active orchestrator turns, targeting the wrong thread, or spamming multiple wake messages when several workers complete near the same time.

This design assumes:

- `vx` remains the dispatch and context/system-prompt control plane
- `t3code-vxapp` remains the thread/runtime/source-of-truth plane
- worker lineage is already stamped into T3 thread metadata

## Problem Statement

T3 already understands orchestrator/worker lineage well enough to:

- create worker threads with parent/orchestrator metadata
- persist that metadata in projections
- render worker groupings in the sidebar

What it does not yet do is treat worker completion as a structured orchestration event with durable wake semantics.

Today, the missing behaviors are:

- no authoritative queue for worker completion wakeups
- no guarantee that a worker wake targets the correct orchestrator thread
- no safe buffering when the orchestrator is currently active
- no batching/coalescing when multiple workers finish
- no mechanism to consume stale queued wakes once the orchestrator has effectively re-checked a worker
- no web-visible queue state for human operators

## Current State

The current implementation already provides the required foundation:

- lineage fields are defined in `packages/contracts/src/orchestration.ts`
- thread create/meta update persistence keeps `orchestratorProjectId`, `orchestratorThreadId`, `parentThreadId`, `spawnRole`, `spawnedBy`, and `workflowId`
- the server projection pipeline persists lineage to thread projections
- the web client creates worker implementation threads with lineage
- the sidebar already groups worker threads by lineage
- provider runtime ingestion already sees authoritative worker turn lifecycle including `turn.completed`

## Architecture Decision

> [!IMPORTANT]
> T3 should own the durable wake queue, wake derivation, wake delivery policy, and wake visibility. `vx` should not own the queue.

### Why T3 owns this

T3 already has the authoritative answers to the questions that matter:

- which orchestrator a worker belongs to
- whether that orchestrator thread still exists
- whether the orchestrator is active or inactive
- whether the worker actually finished a terminal turn

If wake ownership lived in `vx`, the system would need to duplicate thread identity, lineage, queue state, and activity state outside the runtime that already owns it.

### Why `vx` still matters

`vx` remains responsible for:

- dispatching workers
- packaging context and system prompts
- preserving orchestration workflows and continuity rules
- ensuring worker creation continues to stamp correct lineage

But `vx` should not be responsible for deciding whether it is safe to message the orchestrator.

## Scope

### In scope

- worker terminal-turn wake detection
- durable orchestrator wake queue
- wake target validation
- orchestrator-active queue deferral
- orchestrator-inactive wake drain
- wake batching/coalescing
- stale wake consumption rules
- queue visibility in T3 snapshot and web UI

### Out of scope for v1

- waking on approval-blocked or user-input-blocked states
- freeform worker-to-orchestrator direct messaging
- external producers other than T3 runtime lifecycle
- advanced queue controls such as manual reorder or forced dispatch

## Core Invariants

### 1. Never route by heuristics

Wake delivery must never use:

- latest thread in a project
- thread title matching
- label matching
- best-effort orchestrator lookup

Wake delivery must use only stored lineage:

- `orchestratorThreadId`
- `orchestratorProjectId`

### 2. Never interrupt an active orchestrator

If the orchestrator thread is active, worker completion is queued only.

The wake reactor must not start or inject a new orchestrator turn while:

- `session.activeTurnId` is set
- or session status is `starting`
- or session status is `running`

### 3. Queue state is structured, not textual

The durable object is a wake item, not a literal message.

The final delivery text is synthesized from queued items at drain time.

### 4. Terminal outcomes only in v1

Wake-worthy worker outcomes for v1 are:

- `completed`
- `failed`
- `interrupted`

Do not wake for:

- approval requests
- user-input requests
- intermediate progress

### 5. Supersession is structural

Queued wakes must be consumed using observable thread/turn state, not prompt text parsing.

## Data Model

Add a dedicated orchestrator wake projection model.

### `OrchestratorWakeItem`

- `wakeId`
- `orchestratorThreadId`
- `orchestratorProjectId`
- `workerThreadId`
- `workerProjectId`
- `workerTurnId`
- `workflowId`
- `workerTitleSnapshot`
- `outcome`
- `summary`
- `queuedAt`
- `state`
- `deliveryMessageId`
- `deliveredAt`
- `consumedAt`
- `consumeReason`

### Allowed `outcome`

- `completed`
- `failed`
- `interrupted`

### Allowed `state`

- `pending`
- `delivering`
- `delivered`
- `consumed`
- `dropped`

### Allowed `consumeReason`

- `worker_rechecked`
- `worker_superseded_by_new_turn`
- `worker_deleted`
- `worker_reparented`
- `orchestrator_missing`
- `orchestrator_deleted`
- `orchestrator_mismatch`
- `duplicate`
- `manual_dismiss`

### Deduplication key

One undelivered wake item per:

`(workerThreadId, workerTurnId, outcome)`

If T3 sees the same worker terminal turn more than once, it must not enqueue duplicates.

## Wake Derivation

The cleanest source for wake creation is T3 runtime ingestion.

### Source

Derive wake intents from terminal worker lifecycle events already observed by T3:

- provider runtime `turn.completed`
- normalized latest-turn/session state
- worker lineage on the thread projection

### Eligibility rules

A worker completion is wake-eligible only when all are true:

- thread exists
- thread has `spawnRole = "worker"` or equivalent worker lineage
- `orchestratorThreadId` is present
- `orchestratorProjectId` is present
- worker turn ended in a terminal outcome

### Target validation

Before enqueueing:

1. resolve the target orchestrator thread by `orchestratorThreadId`
2. verify it exists
3. verify it belongs to `orchestratorProjectId`
4. reject if the worker points to itself
5. reject if the lineage is contradictory

Rejected wake attempts should become structured activity or logs, not silent no-ops.

## Queue Lifecycle

### Enqueue

When a worker terminal turn is accepted:

1. validate lineage and target
2. derive normalized summary
3. dedupe against existing undelivered wake items
4. persist a new `pending` wake item
5. trigger drain evaluation for that orchestrator thread

### Deliver

When an orchestrator thread is inactive:

1. acquire a per-orchestrator drain lock
2. load pending wake items for that orchestrator
3. choose a bounded batch
4. synthesize one orchestrator wake message
5. start a single orchestrator turn with that message
6. mark batch items as `delivering`
7. on successful orchestration turn start, mark them `delivered`

### Consume

Pending or delivering wake items become `consumed` when they are no longer actionable.

### Drop

Wake items become `dropped` only when the target relationship is invalid or no longer recoverable.

## Drain Policy

### Inactive definition

For v1, an orchestrator is inactive when:

- there is no `activeTurnId`
- session status is not `starting`
- session status is not `running`

States that are safe to drain into:

- `ready`
- `stopped`
- `interrupted`
- no active session, if thread still exists and is resumable through normal orchestration flow

### Batch size

Drain a bounded batch, not every pending wake at once.

Recommended initial batch size:

- `5` wake items per orchestrator delivery turn

### Ordering

- oldest pending first
- stable ordering by `queuedAt`

### Drain triggers

Re-evaluate drain when:

- a new wake item is queued
- the orchestrator session transitions from active to inactive
- the orchestrator turn completes
- the server restarts and restores projections

## Wake Message Synthesis

The wake message should be normalized and compact.

It does not need to reproduce worker text verbatim.

### Example

```text
Worker updates are ready for review.

Pending worker outcomes:
- sidebar-lineage-refine — completed — lineage badges and grouping updated
- wake-queue-reactor — failed — projection/model mismatch remains
- worker-cleanup-pass — interrupted — stopped before verification

Review the worker threads, decide next actions, and continue orchestration.
```

### Summary source

Preferred summary inputs, in order:

1. structured outcome + worker title snapshot
2. checkpoint/diff summary when available
3. runtime error message when failed
4. fallback generic phrase

## Supersession Rules

This addresses the requirement:

> if the orchestrator checks on the worker and they have a queued message, remove the message from the queue

The safest v1 implementation is to treat a new worker turn as the structured signal that the worker has been re-checked or superseded.

### Supersession events

Consume undelivered wake items for a worker when:

- the worker starts a new turn after the queued terminal turn
- the worker is deleted
- the worker is reparented or its orchestrator lineage changes

Recommended consume reason for new-turn supersession:

- `worker_superseded_by_new_turn`

### Why this is the right v1 interpretation

It is machine-detectable and reliable.

It avoids trying to infer “the orchestrator checked the worker” from natural-language messages, which would be fragile and wrong under load.

### Future enhancement

If needed later, T3 can add an explicit command such as “mark worker reviewed” from the UI or orchestrator tooling. That should be a structured action, not a text heuristic.

## Web UI

Because the queue lives in T3, it should be visible in the web UI.

### Sidebar

Add a pending wake badge on orchestrator threads:

- `1 waiting`
- `3 waiting`

### Orchestrator thread detail

When an orchestrator thread is selected, show pending and recently delivered wake items:

- worker title
- outcome
- queued time
- summary
- state

### Worker thread detail

When a worker thread is selected, show whether its terminal outcome is:

- pending orchestrator review
- delivered
- consumed
- dropped

### v1 controls

Minimal controls only:

- view queue state
- optional admin/debug dismiss

No manual reorder or forced “send now” in v1.

## Server Components

### New server layer

Add `OrchestratorWakeReactor`.

Responsibilities:

- listen to orchestration/runtime lifecycle
- derive wake items from worker terminal turns
- validate targets
- enqueue
- consume stale wake items
- drain when safe

### Recommended dependencies

- `OrchestrationEngineService`
- projection repositories/query services
- provider/runtime session state already exposed through orchestration projections

### Locking

Use a per-orchestrator drain lock to prevent burst completions from racing and dispatching multiple wake turns simultaneously.

## Contracts And Snapshot Surface

Extend orchestration contracts to expose wake state through T3 snapshot APIs.

Recommended additions:

- `OrchestratorWakeItem`
- `OrchestratorWakeOutcome`
- `OrchestratorWakeState`
- snapshot field such as `orchestratorWakeItems`

This keeps the queue web-visible without requiring a second API surface.

## Persistence

Add a dedicated projection table for wake items.

Do not derive the queue from freeform thread activities.

Reasons:

- queue state needs durable lifecycle transitions
- dedupe is easier and safer
- UI queries become straightforward
- consume/drop reasons remain explicit

## Integration With Existing Flow

### Existing worker creation

Keep current worker lineage stamping and treat it as the upstream prerequisite.

### Existing runtime ingestion

Use the current provider runtime ingestion path as the wake derivation source.

### Existing sidebar lineage

Reuse current lineage grouping in the UI and layer wake badges/queue details on top.

## Edge Cases

### Multiple workers finish simultaneously

All enqueue independently.
Drain lock ensures only one orchestrator delivery batch starts at a time.

### Orchestrator is active for a long time

Wake items remain pending until the session becomes inactive.

### Orchestrator no longer exists

Wake items move to `dropped` with `consumeReason = "orchestrator_missing"` or equivalent drop reason.

### Worker starts a new turn before wake delivery

Prior wake is consumed as superseded.

### Duplicate provider completion signals

Deduplication key prevents duplicate queue items.

### Worker lineage is malformed

Reject queue creation and append structured warning/error activity for diagnosis.

## Testing Strategy

### Server tests

- worker terminal completion creates a wake item
- duplicate terminal completion does not duplicate wake item
- invalid orchestrator lineage rejects enqueue
- active orchestrator prevents delivery
- inactive orchestrator drains one bounded batch
- multiple worker completions coalesce into one orchestrator delivery
- worker new turn consumes prior pending wake
- missing orchestrator drops queued wake

### Web tests

- snapshot wake items map into UI state
- sidebar badge count reflects pending wakes
- orchestrator detail view renders wake queue
- worker detail view renders wake lifecycle state

## Recommended Implementation Order

1. Extend contracts and persistence model for wake items
2. Add projection repository/query support
3. Implement `OrchestratorWakeReactor`
4. Wire drain logic against orchestrator activity state
5. Expose wake items in snapshot
6. Add UI badges and queue panels
7. Add comprehensive tests

## Final Recommendation

T3 should derive and own worker wake state internally from worker terminal turn lifecycle.

`vx` should continue dispatching and injecting context, but should not directly own or deliver orchestrator wake notifications.

This gives the strongest guarantees for:

- not messaging an inactive or wrong orchestrator
- not interrupting the orchestrator
- batching multiple worker completions safely
- consuming stale queued wakes when worker state moves on
- making queue state inspectable in the T3 web UI
