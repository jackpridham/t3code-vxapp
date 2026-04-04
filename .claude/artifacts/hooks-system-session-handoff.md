## Per-Project Hooks System: Session Summary and Next Steps

**Context:** Designing and scaffolding a per-project hook system for the T3 Code fork that fires shell commands on lifecycle events (turn completed, session started/stopped) and intercepts/augments user prompts before dispatch.

**Summary:** A comprehensive 5-phase implementation plan was created, then refined by the user into a significantly different architecture. The bulk of the implementation has already been completed across contracts, server runtime, shared helpers, and web UI. The remaining work is Phase 5 (runtime integration tests and edge case coverage).

---

## What Was Completed This Session

### Phase 1: Contracts & Project Model (DONE)

- Created `packages/contracts/src/projectHooks.ts` — full schema: `BeforePromptProjectHook`, `TurnCompletedProjectHook`, `ProjectHook` union, selectors (provider/interaction/runtime/turnState), execution target, prompt output config (capture/placement/prefix/suffix), error modes
- Extended `packages/contracts/src/orchestration.ts` — added `hooks` to OrchestrationProject
- Extended `packages/contracts/src/index.ts` — re-exports projectHooks
- Created migration `019_ProjectionProjectHooks.ts` — adds `hooks_json` column
- Updated decider, projector, projection pipeline, snapshot query for hook persistence

### Phase 2: Server Hook Runtime (DONE)

- Created `apps/server/src/projectHooks/Services/ProjectHooksService.ts` — service interface with `prepareTurnStartCommand` and `handleTurnCompleted`
- Created `apps/server/src/projectHooks/Layers/ProjectHooks.ts` — full implementation with:
  - Shell command execution via `processRunner.ts` (platform-aware `sh -lc` / `cmd /c`)
  - Structured JSON stdin payloads for prompt and turn-completed contexts
  - Environment variables (`T3CODE_*` prefix) for hook context
  - Deduplicate cache for turn-completed hooks
  - `appendHookFailureActivity` for observable failures via thread activities
  - `onError: "fail"` vs `"continue"` handling for prompt hooks
  - Worktree resolution per `executionTarget` setting
- Registered `ProjectHooksLive` in `serverLayers.ts`
- Integrated `prepareTurnStartCommand` in `wsServer.normalizeDispatchCommand`
- Integrated `handleTurnCompleted` in `ProviderRuntimeIngestion`

### Phase 3: Shared Matching & Prompt Helpers (DONE)

- Created `packages/shared/src/projectHooks.ts` with:
  - `projectHookMatchesContext()` — selector matching (empty = wildcard)
  - `resolveProjectHookExecutionCwd()` — project-root / worktree / project-root-or-worktree
  - `selectPromptHookOutput()` — capture mode: stdout/stderr/combined/none
  - `applyPromptHookOutput()` — placement: before/after/ignore with prefix/suffix decoration
- Exposed via `@t3tools/shared/projectHooks` subpath export

### Phase 4: Web Persistence & Authoring UI (DONE)

- Created `apps/web/src/projectHooks.ts` — labels, ID generation, `NewProjectHookInput`, `describeProjectHook`
- Created `apps/web/src/components/ProjectHooksControl.tsx` — full CRUD dialog (add/edit/delete hooks, trigger-aware controls, selectors, prompt-only fields)
- Wired into `ChatHeader.tsx` alongside project scripts
- Persisted through `project.meta.update` in `ChatView.tsx`
- Updated `store.ts` and `types.ts` for hooks on project state

## Key Decisions

1. **Hooks are project metadata, NOT separate settings/JSON files** — persisted through existing `project.meta.update` orchestration flow, not a parallel CRUD system
2. **Prompt rewriting is server-side** — runs inside `wsServer.normalizeDispatchCommand()` after attachment normalization, before dispatch
3. **Turn-completed hooks fire from `ProviderRuntimeIngestion`** — reacts to authoritative runtime events, not browser UI state
4. **Sequential prompt hook execution** — each hook receives the output of the previous
5. **Structured JSON stdin** — hooks receive full project/thread/message context as JSON, not just the prompt text
6. **No new WS methods or channels** — everything routes through existing `project.meta.update` and orchestration dispatch

## Current State

- **Phases 1-4 are implemented** with code on disk in the working tree
- **Phase 5 (runtime integration tests) is NOT started** — test files are listed but not written
- **All changes are uncommitted** — large working tree diff on `main`
- The plan files at `@Docs/@TODO/t3code-vxapp/feat/feat-hooks-system/` have been updated by the user to reflect the revised architecture

### Key Modified Files (existing)

- `packages/contracts/src/orchestration.ts` — hooks field on projects
- `apps/server/src/orchestration/decider.ts` — hook persistence in project create/update
- `apps/server/src/orchestration/projector.ts` — hook projection
- `apps/server/src/wsServer.ts` — prompt hook integration point
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — turn-completed hook
- `apps/web/src/components/ChatView.tsx` — hook edit persistence
- `apps/web/src/components/chat/ChatHeader.tsx` — hook UI surface
- `apps/web/src/store.ts`, `apps/web/src/types.ts` — client state

### Key New Files

- `packages/contracts/src/projectHooks.ts`
- `packages/shared/src/projectHooks.ts`
- `apps/server/src/projectHooks/Services/ProjectHooksService.ts`
- `apps/server/src/projectHooks/Layers/ProjectHooks.ts`
- `apps/web/src/projectHooks.ts`
- `apps/web/src/components/ProjectHooksControl.tsx`
- `apps/server/src/persistence/Migrations/019_ProjectionProjectHooks.ts`

## Recommended Strategy Moving Forward

1. **Write Phase 5 tests** before committing — this validates the integrated system
2. **Run `bun fmt`, `bun lint`, `bun typecheck`** to verify the full working tree compiles
3. **Run `bun run test`** to check existing test suites pass with the new `hooks` field on project snapshots
4. **Update existing test fixtures** that construct project snapshots to include `hooks: []`

## Concrete Next Steps

1. Run `bun typecheck` to verify all changes compile
2. Create `apps/server/src/orchestration/decider.projectHooks.test.ts` — test hook persistence through orchestration commands
3. Create `apps/server/src/projectHooks/Layers/ProjectHooks.test.ts` — test prompt rewriting and turn-completed dedupe
4. Create `packages/shared/src/projectHooks.test.ts` — unit tests for selector matching, cwd resolution, prompt output helpers
5. Update existing test fixtures that construct `OrchestrationProject` objects to include `hooks: []`
6. Run full validation: `bun fmt && bun lint && bun typecheck && bun run test`

## Relevant Files and Artifacts

- **Plan:** `/home/gizmo/t3code-vxapp/@Docs/@TODO/t3code-vxapp/feat/feat-hooks-system/PLAN_feat-hooks-system.md`
- **Phase 5 spec:** `/home/gizmo/t3code-vxapp/@Docs/@TODO/t3code-vxapp/feat/feat-hooks-system/PHASE_05_prompt_hooks.md`
- **Contracts:** `/home/gizmo/t3code-vxapp/packages/contracts/src/projectHooks.ts`
- **Shared helpers:** `/home/gizmo/t3code-vxapp/packages/shared/src/projectHooks.ts`
- **Server service:** `/home/gizmo/t3code-vxapp/apps/server/src/projectHooks/Services/ProjectHooksService.ts`
- **Server impl:** `/home/gizmo/t3code-vxapp/apps/server/src/projectHooks/Layers/ProjectHooks.ts`
- **Web helpers:** `/home/gizmo/t3code-vxapp/apps/web/src/projectHooks.ts`
- **Web UI:** `/home/gizmo/t3code-vxapp/apps/web/src/components/ProjectHooksControl.tsx`
- **CLAUDE.md:** `/home/gizmo/t3code-vxapp/CLAUDE.md` (project rules: use `bun run test` not `bun test`)

## Gotchas

- **`bun run test` NOT `bun test`** — the CLAUDE.md is explicit about this
- The plan was **significantly revised** after initial creation — the master plan and all phase files on disk reflect the final architecture, not the original draft
- **No new WS methods were added** — hooks use `project.meta.update`, unlike the original plan which proposed hook-specific endpoints
- The `ProjectHooksLive` layer depends on `OrchestrationEngineService` — it's composed via `runtimeServicesBaseLayer` in `serverLayers.ts`
- Test fixtures for `OrchestrationProject` across many files need `hooks: []` added

## Next Session Goal

Complete Phase 5: write the integration and unit tests, update existing fixtures, and run full repository validation (`bun fmt && bun lint && bun typecheck && bun run test`).
