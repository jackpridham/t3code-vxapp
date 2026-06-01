---
name: t3-orchestration-trace
description: "Trace any orchestration concept end-to-end across contracts, commands, decider, projector, projections, queries, store, and UI. Use this whenever the user asks where a thread/project/session/title/label/runtime field comes from, where it is stored, why a UI value changed, which events a command emits, or how an orchestration behavior flows through the system. Triggers on: 'trace this field', 'where is this set', 'how does this flow', 'what emits this event', 'why did the UI show this', 'where is this persisted', 'follow this command', 'follow this event'."
allowed-tools: Read, Glob, Grep, Bash
---

# Orchestration Trace

Use this skill to answer "where does this come from?" questions in the orchestration stack without rediscovering the architecture from scratch.

## What This Skill Covers

Trace a concept through these layers:

1. Contracts in `packages/contracts/src/orchestration.ts`
2. Command fanout in `apps/server/src/orchestration/decider.ts`
3. In-memory read-model updates in `apps/server/src/orchestration/projector.ts`
4. Persistent projection writes in `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
5. Snapshot/operational reads in `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` and `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`
6. Web mapping in `apps/web/src/store.ts` and `apps/web/src/routes/__root.tsx`
7. UI entry points such as `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/ProjectSidebar.tsx`, and `apps/web/src/components/OrchestrationSidebar.tsx`

## Default Workflow

### 1. Identify the unit you are tracing

Classify the question first:

- Field or payload member: `title`, `runtimeMode`, `orchestratorThreadId`
- Command: `thread.turn.start`, `thread.meta.update`
- Event: `thread.turn-start-requested`, `thread.meta-updated`
- UI behavior: sidebar row, chat header, worker badge

### 2. Start from contracts

Always begin in:

```bash
rg -n "<term>|<command>|<event>" packages/contracts/src/orchestration.ts
```

This tells you whether the thing is:

- thread state
- event metadata
- event payload
- command input
- read-model summary only

### 3. Find the server write path

For commands:

```bash
rg -n "case \"<command>\"" apps/server/src/orchestration/decider.ts
```

For events:

```bash
rg -n "\"<event>\"" apps/server/src/orchestration/projector.ts apps/server/src/orchestration/Layers/ProjectionPipeline.ts
```

Use the decider to answer "what gets emitted" and the projector/pipeline split to answer:

- what changes in memory immediately
- what is persisted in projection tables

### 4. Find the read/query surface

If the question involves bootstrap, snapshots, thread catalogs, or session lists, inspect:

```bash
rg -n "<term>|<event>" apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts
```

### 5. Find the web mapping

For browser-visible behavior:

```bash
rg -n "<event>|<field>" apps/web/src/store.ts apps/web/src/routes/__root.tsx apps/web/src/components
```

This usually reveals:

- event-to-store updates in `store.ts`
- optimistic/live event handling in `__root.tsx`
- the specific UI component rendering the value

## Fast Verification Commands

Use these patterns instead of broad repo-wide searches:

```bash
rg -n "<term>" packages/contracts/src/orchestration.ts
rg -n "case \"<command>\"" apps/server/src/orchestration/decider.ts
rg -n "\"<event>\"" apps/server/src/orchestration/projector.ts apps/server/src/orchestration/Layers/ProjectionPipeline.ts
rg -n "<term>" apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts
rg -n "<term>|<event>" apps/web/src/store.ts apps/web/src/routes/__root.tsx apps/web/src/components
```

## Don’t Confuse These Layers

- `decider.ts` says what events should happen
- `projector.ts` updates the in-memory read model
- `ProjectionPipeline.ts` updates persistent projection tables
- `ProjectionSnapshotQuery.ts` rebuilds rich read models from projection tables
- `ProjectionOperationalQuery.ts` serves lighter operational/thread list queries
- `store.ts` is the browser-side projection, not the server source of truth

## Response Pattern

When answering, structure the result in this order:

1. Source of truth
2. Write path
3. Persistence path
4. Read/UI path
5. Important guardrails or caveats

## Escalate to Other Skills

- Use `t3-event-metadata-semantics` when the confusion is about `commandId`, `correlationId`, or `causationEventId`
- Use `t3-thread-lineage-decoder` when the question is about orchestrator/worker relationships
- Use `t3-orchestrator-wake-flow` for wake-item delivery/consumption logic
- Use `t3-provider-runtime-ingestion-map` for runtime/provider event translation
- Use `t3-checkpoint-lifecycle` for checkpoint capture, placeholder, diff, or revert behavior
