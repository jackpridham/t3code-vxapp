# Tech Debt

This note captures follow-up debt identified while reviewing commit `e766636a` (`clean uncommitted agent mess`), especially the work that moves authority out of T3 Code and into `agents-vxapp`.

## Confirmed Issues

### 1. Jasper runtime inspection can read the wrong session

- File: [apps/server/src/agentRuntime/Layers/AgentRuntime.ts](/home/gizmo/t3code-vxapp/apps/server/src/agentRuntime/Layers/AgentRuntime.ts:496)
- Problem:
  `getAgentRuntimeSnapshot(threadId, "orchestrator")` resolves Jasper runtime state from the latest role-session workspace before it considers the thread's own `worktreePath`.
- Risk:
  Inspecting an older Jasper thread can show packs, skills, and profile data from a newer Jasper session instead of the runtime that thread actually used.
- Why this is debt:
  A per-thread runtime API should not silently drift to a different session's runtime bundle.
- Refactor direction:
  Prefer the authoritative thread-linked workspace first, then fall back to the latest role-session workspace only when the thread has no usable runtime path.

### 2. Program closeout UI is inferring missing work from scope declarations

- File: [apps/web/src/components/vx/programDisplay.ts](/home/gizmo/t3code-vxapp/apps/web/src/components/vx/programDisplay.ts:113)
- Problem:
  `summarizeProgramCloseout` turns required scope fields like `requiredLocalSuites`, `requiredExternalE2ESuites`, and `requireDevelopmentDeploy` into `missingItems` even when there is no evidence that those items are actually missing.
- Risk:
  The UI can over-report blockers and show required work as missing by default, which weakens the goal of making `agents-vxapp` the source of truth for delivery state.
- Why this is debt:
  Requirements and evidence are different truths. This helper currently mixes them.
- Refactor direction:
  Treat scope as requirements only. Derive missing work from authoritative closeout evidence or explicit `lastMissing` fields, and honor flags like `requireCleanPostFlight`.

### 3. Latest role-session selection trusts stale session records

- File: [apps/server/src/agentRuntime/Layers/AgentRuntime.ts](/home/gizmo/t3code-vxapp/apps/server/src/agentRuntime/Layers/AgentRuntime.ts:559)
- Problem:
  `findLatestRoleSessionWorkspaceRoot` returns the newest recorded `workspace_path` without verifying that the workspace and `.agents/runtime` still exist.
- Risk:
  A cleaned-up or stale role-session record can cause runtime inspection to target a dead workspace and return an all-missing snapshot, even when a valid fallback root exists.
- Why this is debt:
  The runtime resolver is still partly driven by stale filesystem metadata instead of a validated authority chain.
- Refactor direction:
  Validate candidate workspaces before selecting them, and continue down the fallback chain when the recorded workspace no longer exists.

## Remaining Duplicate Truths

### 4. `agents-vxapp` paths are still duplicated inside T3 Code

- File: [apps/server/src/extensions/vxapp/agentsVxappSqlite.ts](/home/gizmo/t3code-vxapp/apps/server/src/extensions/vxapp/agentsVxappSqlite.ts:1)
- Problem:
  The repo root, sqlite path, and todo root for `agents-vxapp` are hardcoded in T3 Code.
- Risk:
  Repo layout changes still require synchronized edits across repos.
- Refactor direction:
  Move path discovery behind one authoritative config or discovery surface.

### 5. Program state still has two web authorities

- Files:
  [apps/web/src/store.ts](/home/gizmo/t3code-vxapp/apps/web/src/store.ts:38)
  [apps/web/src/components/vx/OrchestrationSidebar.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/vx/OrchestrationSidebar.tsx:1177)
- Problem:
  Legacy UI paths still consume `store.programs` and related store state, while vx surfaces now read from the control-plane React Query snapshot.
- Risk:
  Different screens can render different program truth depending on which data path they use.
- Refactor direction:
  Consolidate program reads behind one query-backed source and downgrade the store copy to a cache only if still needed.

### 6. Thread error state is still duplicated in the web model

- Files:
  [apps/web/src/types.ts](/home/gizmo/t3code-vxapp/apps/web/src/types.ts:124)
  [apps/web/src/lib/threadRuntimePresentation.ts](/home/gizmo/t3code-vxapp/apps/web/src/lib/threadRuntimePresentation.ts:1)
- Problem:
  The app now stores both authoritative structured fields (`hasActiveError`, `activeError`, `historicalError`, `errorPresentationSource`) and the derived `thread.error` string.
- Risk:
  The derived field can drift from the structured authority and reintroduce presentation bugs.
- Refactor direction:
  Remove `thread.error` as stored state and derive display-only error text from the structured fields everywhere.

## Suggested Order

1. Fix Jasper runtime workspace resolution first, because it can return the wrong runtime bundle for a thread.
2. Remove closeout inference from UI helpers next, because it distorts the source-of-truth migration in user-visible ways.
3. Centralize `agents-vxapp` path discovery and program/query authority after that, because those are the largest remaining multi-source-of-truth seams.
