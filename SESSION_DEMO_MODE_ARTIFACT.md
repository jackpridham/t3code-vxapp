# Demo Orchestration Sidebar Session Artifact

Date: 2026-06-05
Repo: `/home/gizmo/t3code-vxapp`

## Objective

Add a durable demo mode for the orchestration sidebar that reuses the existing VX orchestration sidebar and swaps its data source from live owner-backed state to a fully populated fake/demo dataset. The goal was to showcase the sidebar itself, not the chat view.

## Implemented

- Added a new client setting: `sidebarOrchestrationDataMode: "live" | "demo"`.
- Exposed the setting in `Settings > Orchestration` as `Sidebar Data Source`.
- Kept the existing orchestration sidebar component and routed it through a shared data-source layer instead of duplicating sidebar UI.
- Added a typed demo dataset with:
  - multiple executives
  - multiple programs
  - multiple orchestrator lanes
  - multiple workers
  - TODOs
  - notifications
  - CTO attention items
  - wake states
  - runtime states
  - historical/no-active-lane program coverage
- Kept demo mode read-only for worker mutations.
- Reused the existing dialogs and runtime surfaces with demo-backed data.

## Main Files Changed

- `packages/contracts/src/settings.ts`
- `apps/web/src/hooks/useSettings.ts`
- `apps/web/src/hooks/useSettings.test.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/features/vxapp/components/OrchestrationSidebar.tsx`
- `apps/web/src/features/vxapp/components/ProgramInfoDialog.tsx`
- `apps/web/src/features/vxapp/components/ProgramTodosDialog.tsx`
- `apps/web/src/features/vxapp/components/orchestrationSidebarData.ts`
- `apps/web/src/features/vxapp/components/orchestrationSidebarDemoData.ts`
- `apps/web/src/features/vxapp/components/orchestrationSidebarDemoData.test.ts`

## Behavior Added

- When orchestration mode is enabled and `Sidebar Data Source` is set to `Demo showcase`, the orchestration sidebar renders fake curated data instead of live owner-backed sidebar data.
- Demo mode preserves:
  - sidebar layout
  - program expansion/collapse
  - lane expansion/collapse
  - local selection highlighting
  - Program info dialog
  - Program TODO dialog
  - runtime popovers/details
- Demo mode blocks worker mutation actions and shows:
  - `Demo mode is read-only`

## Validation Completed

### Static Checks

- `bun fmt` passed
- `bun lint` passed
- `bun typecheck` passed

### Live Browser Validation

Validated in Chromium against the running dev app:

1. Opened `Settings > Orchestration`
2. Confirmed `Sidebar Data Source` exists
3. Switched it to `Demo showcase`
4. Loaded the main app with orchestration sidebar enabled
5. Verified the sidebar shows:
   - multiple executives
   - multiple programs
   - multiple workers
   - active and historical orchestration states
6. Verified:
   - worker selection stays local in demo mode
   - Program info opens
   - Program TODOs open
   - worker runtime details open
   - historical no-active-lane content renders
   - worker mutation attempts are blocked with read-only feedback

## Dev Server Notes

The dev server required the local `agents-vxapp` checkout to be provided explicitly:

```bash
T3CODE_NO_BROWSER=1 T3_AGENTS_VXAPP_REPO_ROOT=/home/gizmo/agents-vxapp bun dev
```

The app was validated at:

- web: `http://localhost:5733/`
- server: `http://localhost:3773/`

The dev server was later stopped successfully.

## Important Notes

- This demo mode is sidebar-focused and intentionally does not try to make the main chat area fake/demo-backed.
- The implementation favors reuse of the real sidebar and real sidebar dialogs over duplicate demo-only UI.
- The fake data is curated to maximize sidebar feature coverage rather than mimic one exact real workspace.

## Outcome

The repo now contains a reusable, settings-driven orchestration sidebar demo mode suitable for demos, screenshots, UI walkthroughs, and local validation of populated sidebar behavior without depending on live orchestration state.
