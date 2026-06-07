---
name: t3-orchestration-dry-run-workflow
description: Use this whenever adding, changing, refactoring, or reviewing any T3 Code orchestration command, command normalization path, dispatch flow, side-effecting command behavior, live-server E2E orchestration test, or `vortex-scripts` integration that needs to simulate orchestration safely. Trigger on orchestration command, dry run, safe preview, simulate command, non-mutating command execution, `dryRunCommand`, `dispatchCommand`, `thread.turn.start`, E2E orchestration testing, or requests to make command behavior testable without writing state.
---

# T3 Orchestration Dry-Run Workflow

Use this skill to keep orchestration commands previewable without mutating persistence or external systems.

The goal is not only to add a `dryRunCommand` branch for one command. The goal is to keep every orchestration command usable from a live server in a way that future E2E tooling can exercise safely.

## What This Skill Covers

This skill applies when work touches any of these:

- command schemas in `packages/contracts/src/orchestration.ts`
- NativeApi or WebSocket request routing in `packages/contracts/src/ipc.ts`, `packages/contracts/src/ws.ts`, `apps/web/src/wsNativeApi.ts`, or `apps/server/src/wsServer.ts`
- orchestration command decision logic in `apps/server/src/orchestration/decider.ts`
- orchestration preview/execution behavior in `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- command preprocessing or side effects such as attachments, project hooks, provider/session setup, checkpoint capture, or filesystem writes
- live-server tests in `apps/server/src/wsServer.test.ts`

## Required Outcome

When you finish orchestration-command work, answer these questions explicitly:

1. Can this command be previewed through `orchestration.dryRunCommand`?
2. If yes, what events are predicted and what sequence range is returned?
3. If no side effect happens during preview, which stable skipped-effect tokens explain what was suppressed?
4. What focused test proves the dry run did not mutate persisted state or external artifacts?

Do not consider the task complete if the command only works through live dispatch.

## Primary Files

Contracts:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`

Server:

- `apps/server/src/wsServer.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Services/OrchestrationEngine.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`

Web:

- `apps/web/src/wsNativeApi.ts`

Tests:

- `apps/server/src/wsServer.test.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.test.ts`
- `apps/web/src/wsNativeApi.test.ts`

## Default Workflow

### 1. Classify the command

Before editing, decide which class the command falls into:

- pure decider command: preview only needs current read model plus event prediction
- normalized command: preview must reuse command normalization but avoid mutations
- side-effecting command: preview must skip writes or external calls and report them explicitly

Do not assume a command is pure just because the decider itself is pure. Check preprocessing in `wsServer.ts` and any helper layers it calls first.

### 2. Preserve one normalization path

Prefer a single normalization/preprocessing path with an explicit mode switch such as:

- `mode: "live"`
- `mode: "dry-run"`

The dry-run mode should validate and reshape inputs exactly as live mode does wherever possible, but it must not persist files, emit external writes, start provider work, or trigger irreversible actions.

Do not fork validation rules between live and dry-run unless there is a strong reason.

### 3. Keep dry-run execution pure

`dryRunDispatch` should:

- use the current in-memory read model
- run the normal command decision path
- synthesize predicted events with synthetic sequence numbers
- return the normalized command, current sequence, final sequence, predicted events, and skipped effects

It must not:

- append to the event store
- advance projection state
- publish domain-event pushes
- create attachments on disk
- mutate project/thread/session rows
- call side-effecting hooks or providers

### 4. Report skipped effects with stable tokens

When dry-run suppresses a real side effect, return a stable token in the result.

Current examples:

- `attachments.persist`
- `project-hooks.before-prompt`

If you introduce a new skipped effect, extend the schema in `packages/contracts/src/orchestration.ts` and keep the name stable and implementation-focused. Use `domain.action` style names. Avoid human prose strings.

### 5. Expose narrow read surfaces for E2E

If E2E or `vortex-scripts` needs to verify command behavior, prefer narrow operational RPCs over broad debug snapshots.

Good examples:

- `getProjectById`
- `getThreadById`

Add small targeted reads when a test needs to assert live-server state before or after a dry run. Do not default to exporting full snapshots if a bounded query will do.

### 6. Add non-mutating tests

For any command whose dry-run support is added or changed, add a focused live-server test in `apps/server/src/wsServer.test.ts` that proves:

- the dry run returns the expected predicted events
- no live domain event push is emitted for that command
- replayed persisted events are unchanged before vs after dry run
- suppressed side effects did not happen on disk or through dependent services

Also update the closest unit tests for any changed normalization or engine behavior.

### 7. Review neighboring commands

When touching one orchestration command, scan nearby commands in the same area and check whether they also lack dry-run coverage or skipped-effect reporting.

If the neighboring command shares the same normalization or side-effect path, extend the change there too unless doing so would meaningfully expand scope or risk.

## Dry-Run Acceptance Checklist

Before finishing, verify all relevant items:

- command contracts still decode cleanly
- `orchestration.dryRunCommand` accepts the command shape
- live dispatch behavior is unchanged
- dry-run result returns stable predicted events
- dry-run does not mutate persistence
- dry-run does not emit orchestration domain pushes
- skipped effects are present for every intentionally suppressed external action
- tests cover both the positive preview result and the absence of mutation

## Preferred Test Shape

For live-server tests, prefer this pattern:

1. Create the minimum real project/thread state with live commands.
2. Record pre-dry-run persisted events or bounded query state.
3. Call `orchestration.dryRunCommand`.
4. Assert the predicted event types and skipped effects.
5. Assert no push arrived for the dry-run command.
6. Re-read persisted events or bounded query state and prove it did not change.
7. Assert the external artifact that would have been written does not exist.

## Footguns

- Do not implement a second decider path just for dry runs.
- Do not let dry-run drift from live validation or normalization.
- Do not silently suppress side effects without reporting a skipped-effect token.
- Do not use snapshot-export endpoints as the default E2E assertion surface.
- Do not mark dry-run complete if it still writes attachments, updates projection rows, or emits live pushes.
- Do not forget browser and contracts wiring when exposing a new orchestration RPC.
- Do not run `bun test`; use `bun run test`.

## Completion Standard

Run the repo-required checks:

```bash
bun fmt
bun lint
bun typecheck
```

If tests are relevant, use focused `bun run test` commands for the touched orchestration surfaces.
