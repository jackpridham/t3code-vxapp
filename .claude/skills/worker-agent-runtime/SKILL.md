---
name: worker-agent-runtime
description: Use when adding, changing, debugging, reviewing, or displaying worker agent runtime contract data in T3 Code, especially `.agents/runtime/*.json`, selected worker runtime snapshots, installed packs, capabilities, context mode, closeout authority, audit findings, or the `server.getWorkerRuntimeSnapshot` flow. Trigger on worker runtime, agent runtime, runtime contract, selectedPacks, allowedCapabilities, forbiddenCapabilities, context-plan.json, dispatch-contract.json, installed-packs.json, instruction-stack-audit.json, or requests to surface worker runtime data in the web UI.
---

# Worker Agent Runtime

Use this skill when the task is about reading or surfacing the runtime contract artifacts that exist inside a worker worktree under `.agents/runtime/`.

T3 does not own runtime policy. `vortex-scripts` produces the runtime contract files. T3 only reads, normalizes, transports, and displays them for selected worker threads.

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
- `apps/server/src/wsServer.ts`
- `apps/server/src/serverLayers.ts`

Web:

- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/lib/workerRuntimeReactQuery.ts`

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
<thread.worktreePath>/.agents/runtime/
```

The current runtime file set is:

- `context-plan.json`
- `dispatch-contract.json`
- `installed-packs.json`
- `instruction-stack-audit.json`

Do not invent alternate file locations unless the upstream runtime producer changes.

## Current T3 Boundary

The current implementation is intentionally bounded:

- input is a selected `threadId`
- server resolves the thread from orchestration state
- only `spawnRole === "worker"` threads are allowed
- server reads runtime files from the worker `worktreePath`
- server returns a normalized snapshot through `server.getWorkerRuntimeSnapshot`
- browser consumes that through `workerRuntimeSnapshotQueryOptions`

This data is not part of the orchestration projection or sidebar snapshot model in v1.

Keep it feature-local unless there is a concrete need to promote it.

## Normalized Snapshot Shape

The RPC returns a `WorkerRuntimeSnapshot` with:

- `threadId`
- `worktreePath`
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

Do not try to resolve runtime data from project rows, program rows, or free-form workspace guesses first.

Preferred path:

1. identify the selected worker `threadId`
2. call `server.getWorkerRuntimeSnapshot({ threadId })`
3. render the normalized result

### 2. Keep runtime reads out of orchestration projections unless required

Do not add runtime contract fields to:

- orchestration snapshots
- sidebar thread models
- persistent projection tables

unless the feature explicitly needs orchestration-wide querying or indexing.

For single-worker inspection, the dedicated RPC is the correct boundary.

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
- worker has no `worktreePath`
- runtime file missing
- invalid JSON
- schema decode failure

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

unless the feature specifically needs cross-worker aggregation.

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
- Do not couple worker runtime data to sidebar rendering by default.
- Do not add runtime fields to orchestration projections just because a single UI needs them.
- Do not assume every runtime file is present.
- Do not drop `sourceFiles` status detail when debugging ingestion failures.
- Do not treat T3 as the source of truth for runtime policy.
- Do not run `bun test`; use `bun run test`.
