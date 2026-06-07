---
name: t3-orchestration-command-workflow
description: Use this whenever adding, changing, debugging, or reviewing a T3 Code orchestration command end-to-end, especially command schemas, command invariants, decider fanout, dispatch receipts, in-memory projection, persistent projection impact, bounded orchestration reads, or live-server orchestration command tests. Trigger on orchestration command, decider, command invariant, `dispatchCommand`, command receipt, projector impact, `packages/contracts/src/orchestration.ts`, or requests to wire a new orchestration behavior through the server.
---

# T3 Orchestration Command Workflow

Use this skill for server-side orchestration command work that crosses contracts, command validation, event fanout, projection, and test coverage.

This is the main T3 workflow for "I need to add or change an orchestration command." Use it before making scattered local edits.

## What This Skill Covers

- command schemas and unions in `packages/contracts/src/orchestration.ts`
- NativeApi and websocket request wiring in `packages/contracts/src/ipc.ts`, `packages/contracts/src/ws.ts`, and `apps/server/src/wsServer.ts`
- command invariant enforcement in `packages/orchestration-core/src/commandInvariants.ts`
- command-to-event fanout in `packages/orchestration-core/src/decider.ts`
- in-memory read-model updates in `packages/orchestration-core/src/projector.ts`
- command dispatch and receipts in `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- persistent projection impact in `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- bounded orchestration reads in `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`

## Primary Files

Contracts:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`

Core orchestration logic:

- `packages/orchestration-core/src/commandInvariants.ts`
- `packages/orchestration-core/src/decider.ts`
- `packages/orchestration-core/src/projector.ts`

Server orchestration:

- `apps/server/src/wsServer.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`

High-value tests:

- `packages/contracts/src/orchestration.test.ts`
- `packages/orchestration-core/src/decider.test.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.test.ts`
- `apps/server/src/wsServer.test.ts`

## Default Workflow

### 1. Classify the command shape first

Before editing, identify which class of command you are touching:

- create/delete lifecycle command
- metadata update command
- session/runtime control command
- turn/message command
- checkpoint/revert command
- program/notification command

That tells you where fanout and invariant risk usually lives.

### 2. Start from contracts, not the UI

Always inspect the command schema and union membership first.

When adding a new command, verify:

- the command schema exists
- the command is included in the right client/server unions
- any new payload fields are represented in the event payloads or read surfaces intentionally

Do not start by patching `wsServer.ts` or UI call sites before the command shape is coherent.

### 3. Trace the full write path

Walk the command through these layers in order:

1. command schema
2. command invariants
3. decider event fanout
4. in-memory projector impact
5. persistent projector impact
6. operational/snapshot read impact
7. websocket/browser exposure if relevant

If you skip steps 4-6, you will often land a command that emits events but never becomes queryable in the expected shape.

### 4. Treat multi-event fanout as the default risk

Do not assume a command emits one event.

Check whether the command:

- emits multiple events directly
- causes projector-visible side effects on multiple read surfaces
- changes global sequencing behavior
- affects program, notification, wake, or checkpoint state indirectly

For command refactors, explicitly verify event order and event count in tests.

### 5. Review projection impact deliberately

When a command changes any thread/project/program field, inspect both:

- `packages/orchestration-core/src/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`

The first controls in-memory command-time correctness.
The second controls persisted query correctness.

Do not assume one mirrors the other automatically.

### 6. Prefer bounded reads for verification

If the work needs assertions or debug inspection, prefer bounded query surfaces such as:

- `listProjects`
- `getProjectByWorkspace`
- `listProjectThreads`
- `listSessionThreads`
- `getProjectById`
- `getThreadById`

Do not default to broad snapshots when a narrower operational query is enough.

### 7. Add live-server coverage for integration points

Use `apps/server/src/wsServer.test.ts` when the task changes:

- websocket command routing
- command normalization
- live dispatch behavior
- bounded read semantics after dispatch

Use engine/pipeline tests when the task changes:

- command invariants
- event fanout
- projection batching/applicability behavior
- replay/bootstrap correctness

## Review Checklist

Before finishing orchestration command work, answer these:

1. Does the command schema decode cleanly in contracts?
2. Does the decider emit the intended event set and order?
3. Do in-memory and persistent projections both reflect the change?
4. Do bounded operational reads expose the new state correctly?
5. Is websocket routing or browser mapping required?
6. Are dry-run semantics needed too?

If the answer to 6 is yes, also use `t3-orchestration-dry-run-workflow`.

## Tests To Prefer

For contract or schema changes:

```bash
cd packages/contracts
bun run test src/orchestration.test.ts
```

For decider/invariant changes:

```bash
cd packages/orchestration-core
bun run test src/decider.test.ts src/roundtrip.test.ts
```

For server orchestration changes:

```bash
cd apps/server
bun run test src/orchestration/Layers/OrchestrationEngine.test.ts
bun run test src/orchestration/Layers/ProjectionPipeline.test.ts
bun run test src/orchestration/Layers/ProjectionOperationalQuery.test.ts
bun run test src/wsServer.test.ts
```

## Footguns

- Do not add a command only to contracts and `wsServer.ts`; check invariants, decider, projector, and persisted projections too.
- Do not assume event fanout is harmless; sequencing and read-model effects are part of the feature.
- Do not use `getCurrentState()` as the first verification tool when a bounded query already exists.
- Do not forget command receipts in `OrchestrationEngine.ts` when changing dispatch semantics.
- Do not run `bun test`; use `bun run test`.

## Companion Skills

- Use `t3-orchestration-dry-run-workflow` when the task includes non-mutating command previews.
- Use `t3-orchestration-trace` when the task is primarily explaining an existing flow rather than changing it.
- Use `t3-react-query-rpc-workflow` when the browser query layer must consume the new command-adjacent RPCs.
