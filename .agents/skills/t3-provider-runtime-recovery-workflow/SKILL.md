---
name: t3-provider-runtime-recovery-workflow
description: Use this whenever adding, changing, debugging, or reviewing T3 Code provider runtime startup, resume, recovery, reconciliation, or ingestion behavior, especially Codex app-server session recovery, persisted resume cursors, provider session binding, runtime event ingestion, provider command reactors, agents-vxapp owner-mediated approval or user-input flow, vxapp-backed thread status sync, restart safety, or live integration tests around provider-backed orchestration flows. Trigger on provider resume, recovery, reconnect, restart, persisted runtime state, `ProviderRuntimeIngestion`, `ProviderCommandReactor`, `ProviderService`, `codexAppServerManager`, stuck session, duplicate session, pending approval, pending user-input, owner command, `agentsVxappOwnerClient`, or turn settlement after restart.
---

# T3 Provider Runtime Recovery Workflow

Use this skill for the provider-runtime side of orchestration: starting sessions, resuming them safely, ingesting runtime events back into orchestration, and recovering after restart or disconnect.

This is the right skill when the bug smells like "the orchestration state and the provider process/session got out of sync."

For deployed recovery, the browser/UI authority is the systemd-managed
`t3code.service` listening on `7421`. Repo-local dev ports such as `3773` and
`5733` are not deployed proof.

This is not the right skill for vxapp startup-authority cutovers in the
projection/bootstrap layers. Those now depend on dedicated startup-safe owner
surfaces outside the provider callback path.

Phase `11` changed an important boundary:

- T3 still owns provider process/session mechanics, callback routing, transport, and rendering plumbing.
- T3 no longer owns authoritative approval truth, user-input truth, or vxapp-backed thread operational truth.
- `apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts` is the only server file allowed to know the owner process path.
- `ProviderRuntimeIngestion.ts` and `ProviderCommandReactor.ts` must go through owner-client helpers before those vxapp-backed states become authoritative.

The startup-safe vxapp authority split is now also explicit:

- external project/thread authority for vxapp-backed startup and projection
  reads comes from `AgentsVxappExternalRoleAuthority.getSnapshot()`
- startup-safe owner Program rows for vxapp-backed projection reads come from
  `AgentsVxappControlPlane.getProgramsProjectionSnapshot()`
- Program/TODO/runtime inspection for vxapp-backed UI surfaces should use the
  dedicated owner contract reads behind `agentsVxappOwnerClient.ts`, not local
  projection joins
- `runtime-paths` stays on the separate role-session owner surface
- `getSnapshot()` on `AgentsVxappControlPlane` still means the stricter
  Program/TODO-scoped owner snapshot path and must not be reused as a generic
  startup-safe source
- worker runtime snapshots require authoritative `workspace` input; do not
  revive thread `worktreePath` heuristics when reconnect/recovery work touches
  runtime display or runtime callbacks

## Primary Files

Provider startup and persistence:

- `apps/server/src/codexAppServerManager.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderSessionDirectory.ts`
- `apps/server/src/persistence/Services/ProviderSessionRuntime.ts`

Runtime translation and orchestration coupling:

- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/providerHarnessBoundary.test.ts`
- `apps/server/src/serverLayers.ts`

Owner boundary:

- `apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts`
- `apps/server/src/extensions/vxapp/agentsVxappOwnerClient.test.ts`
- `apps/server/src/extensions/vxapp/Layers/AgentsVxappExternalRoleAuthority.ts`
- `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.ts`
- `apps/server/src/orchestration/Layers/ProjectionBootstrapSummaryQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`

Adapters:

- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`

High-value tests:

- `apps/server/src/provider/Layers/ProviderService.test.ts`
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
- `apps/server/integration/orchestrationEngine.integration.test.ts`
- `apps/server/integration/OrchestrationEngineHarness.integration.ts`

## Default Workflow

### 1. Separate the failure class first

Classify the issue before patching anything:

- session failed to start
- session failed to resume
- resume cursor/state was lost or stale
- runtime event was emitted but not ingested
- ingested event did not become orchestration state
- provider command reactor failed to turn orchestration intent into provider action
- owner command failed before a vxapp-backed approval, user-input, or thread-state transition could become truth
- owner startup-safe authority command failed before vxapp-backed projection/bootstrap reads could become truth
- restart/reconnect produced duplicate or missing session state

Different classes live in different files. Do not treat them as one layer.

### 2. Check persisted runtime state before blaming the adapter

Inspect whether the persisted binding/runtime state already contains:

- the expected thread binding
- provider name
- resume cursor
- last known session/runtime metadata

If that state is missing or stale, patching the adapter alone usually will not fix the system.

### 3. Trace both directions

Provider runtime bugs often require both of these traces:

1. orchestration command -> provider action
2. provider runtime event -> orchestration command/event/state
3. owner command -> authoritative vxapp truth for approvals, user-input, and vxapp-backed thread status
4. startup-safe owner authority -> authoritative vxapp project/thread/program truth for projection/bootstrap queries

Use:

- `ProviderCommandReactor.ts` for direction 1
- `ProviderRuntimeIngestion.ts` for direction 2
- `agentsVxappOwnerClient.ts` for direction 3 when the thread is vxapp-backed or the callback is approval/user-input related
- `AgentsVxappExternalRoleAuthority.ts` and `AgentsVxappControlPlane.ts` for
  direction 4 when the failure is in vxapp-backed startup/bootstrap/projection
  reads

Do not debug only one half of the loop.

Do not assume provider callback success alone is sufficient anymore. For vxapp-backed approval, user-input, and thread lifecycle paths, the owner command must succeed first.

Do not route startup-safe vxapp authority through
`fetchAgentsVxappControlPlaneSnapshot()` or
`fetchAgentsVxappProgramsTodosSnapshot()`. Those are not generic startup-safe
surfaces.

When the failure is about vxapp-backed Program/TODO/runtime truth rather than
bootstrap availability, prefer the dedicated owner command family:

- Program selection and TODO/runtime views
- Program runtime allocations
- current/watch thread authority
- agent runtime snapshots
- worker runtime snapshots

### 4. Preserve restart and resume semantics explicitly

When editing recovery logic, check behavior for:

- fresh session start
- resume using persisted cursor
- stopAll or server restart followed by resume
- adapter/provider mismatch
- stale session metadata after provider failure

A fix that works for fresh sessions but breaks restart recovery is not acceptable in this repo.

Also check whether the broken state is truly recoverable from provider runtime metadata alone. For vxapp-backed approval or user-input flows, T3 must not rebuild authority locally from provider runtime records after restart.

For vxapp-backed projection/bootstrap failures, T3 also must not:

- synthesize project rows from local projection data
- recover owner Program rows from local SQLite projections
- catch `program_authority_missing` and continue with local truth

### 5. Prefer harness and integration tests for lifecycle fixes

If the change affects resume/reconnect/restart semantics, do not rely only on unit tests.

Use the orchestration harness/integration layer when you need to prove:

- provider sessions recover with persisted state
- runtime ingestion after resume is still coherent
- session-set / turn-settlement state is correct after restart

### 6. Watch settlement semantics carefully

High-risk areas include:

- `thread.session.set`
- active turn transitions
- stop-session flows
- turn interrupt flows
- final turn completion after reconnect
- owner-mediated `request.opened`, `user-input.requested`, `thread.approval-response-requested`, and `thread.user-input-response-requested`

Owner failure handling is part of correctness now:

- owner failure should surface as visible provider failure activity
- owner failure must block the downstream provider response call for approval/user-input responses
- vxapp-backed lifecycle callbacks must not silently fall back to local provider runtime state as authoritative truth
- vxapp-backed startup/bootstrap/projection reads must fail closed if
  `external_role_authority_snapshot`,
  `programs_projection_snapshot`, or `runtime-paths` fails

These often appear "mostly fixed" while still leaving false-ready or stale-running state behind.

## Review Checklist

Before finishing a provider-runtime recovery change, answer:

1. Where is the persisted source of truth for the runtime state?
2. Which layer starts or resumes the provider session?
3. Which layer translates provider runtime events into orchestration state?
4. Which owner-client helper is supposed to mediate this approval, user-input, or vxapp-backed thread-state transition?
5. If the bug is in bootstrap/projection, which startup-safe owner surface is
   supposed to provide project/thread/program truth?
6. Which tests prove restart/resume safety, not just first-run behavior?
7. Did the change alter binding, resume-cursor, settlement semantics, startup
   authority wiring, or owner-command gating?

## Tests To Prefer

For provider service and binding behavior:

```bash
cd apps/server
bun run test src/provider/Layers/ProviderService.test.ts
bun run test src/provider/Layers/ProviderSessionDirectory.test.ts
```

For adapter-specific resume behavior:

```bash
cd apps/server
bun run test src/provider/Layers/CodexAdapter.test.ts
bun run test src/provider/Layers/ClaudeAdapter.test.ts
```

For orchestration/runtime coupling:

```bash
cd apps/server
bun run test src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
bun run test src/orchestration/Layers/ProviderCommandReactor.test.ts
bun run test src/orchestration/providerHarnessBoundary.test.ts
```

For restart/recovery proof:

```bash
cd apps/server
bun run test integration/orchestrationEngine.integration.test.ts
```

## Startup Critical Path

Treat "server never came up" as its own failure class. In this repo,
`wsServer.createServer()` starts orchestration/reactor layers before the HTTP
listener is considered ready, so slow or best-effort work inside a layer
`start()` can keep `:7421` from listening at all.

Rules:

- Do not block listener readiness on best-effort reconciliation.
- If startup work is advisory, background it with `Effect.forkScoped(...)` or an
  equivalent non-blocking path.
- Distinguish "server is not listening yet" from "server is listening but a
  runtime surface is unhealthy." They require different fixes.

Known example:

- `apps/server/src/extensions/vxapp/Layers/OrchestratorWakeReactor.ts` was
  running `_reconcileWakesOnStart` inline during `start()`. That reconciliation
  is best-effort and must not gate listener bind.

Useful diagnostics when `:7421` looks dead:

```bash
systemctl status t3code.service --no-pager
systemctl cat t3code.service
systemctl cat t3code.service | rg '30-agents-vxapp-repo-root.conf|T3_AGENTS_VXAPP_REPO_ROOT'
ss -ltnp '( sport = :7421 )'
curl -sf http://127.0.0.1:7421/ >/dev/null && echo LIVE_7421_OK || echo LIVE_7421_DOWN
tail -n 20 /home/gizmo/.t3/userdata/logs/server.log
lsof /home/gizmo/.t3/userdata/state.sqlite
```

Deployment notes:

- The live service depends on `T3_AGENTS_VXAPP_REPO_ROOT` coming from the
  surviving `30-agents-vxapp-repo-root.conf` systemd drop-in.
- Do not expect `20-jasper-autoresume.conf` or
  `t3code-autoresume.service`; both are retired and should not appear in
  recovery docs or deployment checklists.
- Live validation must include actual browser/HTML proof on `7421`, not only a
  process check or local-dev port check.

If the real home is locked or wedged, validate perf-sensitive client/server
logic on an isolated home and port first, then come back and fix the startup or
recovery blocker on the real home before calling the workflow complete.

## Footguns

- Do not patch `ChatView` or browser state first for provider runtime bugs that originate server-side.
- Do not document or depend on retired `20-jasper-autoresume.conf` or
  `t3code-autoresume.service` recovery steps.
- Do not assume resume cursor format is interchangeable across providers.
- Do not "fix" a resume bug by discarding persisted state unless that semantic loss is intentional.
- Do not validate only fresh-start behavior when the bug report is about restart/recovery.
- Do not forget `serverLayers.ts`; a new layer behavior can be correct locally but not actually wired into the running server.
- Do not add a second direct owner-process caller outside `agentsVxappOwnerClient.ts`.
- Do not let `ProviderSessionRuntime` or provider callback records become a fallback truth source for vxapp-backed approval, user-input, or thread status.
- Do not let projection/bootstrap layers reuse `control_plane_snapshot` or
  `programs_todos_snapshot` as a generic startup-safe owner source.
- Do not rebuild authoritative vxapp-backed project or Program rows from local
  projection tables when owner startup-safe authority is missing.
- Do not fix vxapp-backed runtime regressions by guessing worker workspaces from
  local thread rows; the owner runtime contract is workspace-authoritative.
- Do not put slow wake reconciliation, owner sync, or other best-effort startup
  work on the listener critical path unless the intended product behavior is to
  fail closed before bind.

## Companion Skills

- Use `t3-provider-runtime-ingestion-map` when the task is mainly about understanding event translation.
- Use `t3-orchestration-command-workflow` when recovery work also changes orchestration commands or bounded reads.
