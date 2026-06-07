---
name: worker-agent-runtime
description: Use when adding, changing, debugging, reviewing, or displaying worker agent runtime contract data in T3 Code, especially owner-backed worker runtime snapshots, `.agents/runtime/*.json`, installed packs, capabilities, context mode, closeout authority, audit findings, or the `server.getWorkerRuntimeSnapshot` flow. Trigger on worker runtime, agent runtime, runtime contract, selectedPacks, allowedCapabilities, forbiddenCapabilities, context-plan.json, dispatch-contract.json, installed-packs.json, instruction-stack-audit.json, runtime workspace resolution, or requests to surface worker runtime data in the web UI.
---

# Worker Agent Runtime

Use this skill when the task is about reading or surfacing owner-backed worker runtime contract data for a worker workspace under `.agents/runtime/`.

T3 does not own runtime policy. `agents-vxapp` owns the runtime read contract, and its worker-runtime/role-session owners remain authoritative for workspace resolution and audit semantics. T3 should only transport, normalize, and display the owner-backed result.

## What This Skill Covers

- selected worker runtime inspection
- `.agents/runtime/*.json` file ingestion
- normalized runtime snapshot shaping
- browser-to-server RPC for worker runtime data
- redacted fixture refresh for mock/test data
- deciding where worker runtime data should and should not live in T3

## Primary Files

Contracts:

- `packages/contracts/src/workerRuntime.ts`
- `packages/contracts/src/server.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`

Server:

- `apps/server/src/workerRuntime/Services/WorkerRuntime.ts`
- `apps/server/src/workerRuntime/Layers/WorkerRuntime.ts`
- `apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts`
- `apps/server/src/wsServer.ts`
- `apps/server/src/serverLayers.ts`

Web:

- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/lib/workerRuntimeReactQuery.ts`
- `apps/web/src/components/vx/workerRuntimeDialogState.ts`
- `apps/web/src/components/vx/OrchestrationSidebar.tsx`

Fixtures and tests:

- `apps/web/src/lib/workerRuntime/__fixtures__/catalog.json`
- `apps/web/src/lib/workerRuntime/__fixtures__/snapshots/`
- `scripts/refresh-worker-runtime-fixtures.ts`
- `packages/contracts/src/workerRuntime.test.ts`
- `apps/web/src/lib/workerRuntimeReactQuery.test.ts`
- `apps/server/src/wsServer.test.ts`

## Runtime File Set

The canonical runtime directory for a worker thread is:

```text
<workspace>/.agents/runtime/
```

The current runtime file set is:

- `context-plan.json`
- `dispatch-contract.json`
- `installed-packs.json`
- `instruction-stack-audit.json`

Do not invent alternate file locations unless the upstream runtime producer changes.

## Current T3 Boundary

The current implementation is intentionally bounded:

- input should be an authoritative worker runtime target: `threadId` plus canonical `workspace`
- that target should come from `agents-vxapp` owner-backed program/sidebar/runtime reads, not from local project or thread heuristics
- the server routes the request through `agentsVxappOwnerClient.ts`
- `agents-vxapp` resolves runtime files and audits from the worker `workspace`
- T3 returns the normalized snapshot through `server.getWorkerRuntimeSnapshot`
- browser consumes that through `workerRuntimeSnapshotQueryOptions`

If a compact vxapp surface such as worker chips in the VX sidebar needs runtime state, render it from owner-provided runtime targets and availability. Do not reintroduce local `thread.worktreePath` heuristics into the sidebar model.

## Normalized Snapshot Shape

The RPC returns a `WorkerRuntimeSnapshot` with:

- `threadId`
- `workspace`
- `runtimeDir`
- `sourceFiles`
- `summary`
- `packs`
- `raw`

Use `summary` for most UI surfaces.
Use `packs` for installed-pack displays.
Use `raw` only for advanced inspectors or debugging.
Use `sourceFiles` to distinguish:

- `loaded`
- `missing`
- `invalid-json`
- `schema-error`

Do not collapse file-state errors into generic “runtime unavailable” unless the UI truly has no room for detail.

## Summary Fields That Matter Most

The highest-value runtime fields today are:

- `repo`
- `taskClass`
- `contextMode`
- `closeoutAuthority`
- `validationProfile`
- `selectedPacks`
- `allowedCapabilities`
- `forbiddenCapabilities`
- `auditStatus`
- `auditFindings`
- `packCount`

When building compact UI, prefer these before exposing raw path metadata.

## Default Workflow

### 1. Start from the selected worker thread

Do not derive runtime data from project rows, local store state, or free-form workspace guesses first.

Preferred path:

1. resolve the worker's owner-backed runtime target
2. call `server.getWorkerRuntimeSnapshot({ threadId, workspace })`
3. render the normalized result

### 2. Keep runtime reads owner-backed

Do not reimplement worker runtime authority in:

- orchestration projections
- browser store state
- local thread/worktree heuristics

For single-worker inspection and compact VX runtime display, the dedicated owner-backed RPC is the correct boundary.

### 3. Prefer the normalized result over ad hoc file parsing in UI code

Do not parse `.agents/runtime/*.json` directly in browser components.

If the UI needs a new presentation field:

1. check whether it already exists in `summary`, `packs`, or `raw`
2. if not, extend the worker-runtime contract module and normalization layer
3. keep the transformation centralized

### 4. Use fixtures for mock-heavy UI work

When building UI before wiring live selection flows, use the committed fixture snapshots under:

- `apps/web/src/lib/workerRuntime/__fixtures__/snapshots/`

If live runtimes have changed and the fixtures are stale, refresh them with:

```bash
bun run scripts/refresh-worker-runtime-fixtures.ts
```

The refresh script copies all currently discovered runtime directories from `~/worktrees/*/.agents/runtime`, redacts machine-local paths, and rewrites the fixture catalog.

### 5. Keep T3 as a reader, not a policy owner

Do not reimplement runtime capability policy, pack selection logic, or audit logic in T3.

T3 should:

- read the artifacts
- validate their shape
- surface their contents
- preserve error states

The runtime producer remains authoritative.

## Error Handling Rules

Treat these cases distinctly:

- thread not found
- thread is not a worker
- worker has no authoritative `workspace`
- runtime file missing
- invalid JSON
- schema decode failure
- owner-backed runtime authority is unavailable or contradictory

Missing or malformed individual files should not require the whole snapshot request to fail when the rest of the runtime can still be summarized.

## Good UI Placement Guidance

Good places for this data:

- selected worker inspector
- worker detail drawer
- advanced runtime panel
- debug/operator surface

Avoid defaulting this into:

- top-level sidebar rows
- global project lists
- orchestration projections

unless the feature specifically needs owner-backed compact runtime display or cross-worker aggregation.

## Tests To Prefer

Contracts and fixture decoding:

```bash
cd packages/contracts
bun run test src/workerRuntime.test.ts
```

Web query helper:

```bash
cd apps/web
bun run test src/lib/workerRuntimeReactQuery.test.ts
```

Server RPC integration:

```bash
cd apps/server
bun run test src/wsServer.test.ts
```

Final repo checks:

```bash
bun fmt
bun lint
bun run typecheck
```

## Footguns

- Do not read runtime files directly from the browser.
- Do not use `agentRuntimeSnapshot` for worker rows when `workerRuntimeSnapshot` is the correct owner surface.
- Do not derive runtime authority from `thread.worktreePath`, project cwd, or guessed workspaces.
- Do not add runtime fields to orchestration projections just because a single UI needs them.
- Do not assume every runtime file is present.
- Do not drop `sourceFiles` status detail when debugging ingestion failures.
- Do not treat T3 as the source of truth for runtime policy.
- Do not run `bun test`; use `bun run test`.
