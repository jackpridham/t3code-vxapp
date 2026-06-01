---
name: t3-orchestration-sidebar-modeling
description: "Model or refactor the T3 Code sidebar when the task involves orchestration mode, project bucketing, worker visibility, session selection, worktree collapsing, or splitting project-vs-orchestration navigation. Use this whenever the user asks to change sidebar structure, simplify orchestration rows, collapse worktrees under parent repos, keep custom threads visible beside workers, persist current session selection, explain how session switching works, explain what happens to worktrees when switching sessions, explain how previous orchestration state is recovered, or reduce sidebar code smell without rebuilding a mega-sidebar. Triggers on: 'sidebar is messy', 'orchestration mode sidebar', 'collapse worktrees', 'group workers under parent repo', 'current orchestrator workers only', 'session selector', 'switch sessions', 'previous state', 'what happens to worktrees', 'split sidebar', 'sidebar refactor', 'project bucket', 'orchestrator row'."
allowed-tools: Read, Grep, Bash
---

# Orchestration Sidebar Modeling

Use this skill to reason about sidebar structure in `t3code-vxapp` without rediscovering the product rules every time.

## Core Product Model

Treat the sidebar as two different navigation systems:

- `ProjectSidebar.tsx`: normal project/thread navigation
- `OrchestrationSidebar.tsx`: orchestration-focused navigation

Do not merge them back into one configurable mega-sidebar. Shared hooks and row primitives are good. Shared top-level behavior is not.

## Default Orchestration Rules

When the user is in orchestration mode, prefer these rules unless they explicitly override them:

- Orchestrators are control rows, not thread trees.
- Clicking an orchestrator row should open the current session.
- The session selector belongs on the orchestrator row.
- Worker threads should appear under project buckets, not under orchestrator rows.
- Custom user threads should remain visible alongside orchestration workers in the same project bucket.
- Only workers tied to the currently selected orchestration session should render.
- Worktree/sub-project mess should be hidden behind parent-project bucketing.

The intended mental model is:

```text
ORCHESTRATORS
  Jasper [session selector]

PROJECTS
  repo
    worker
    worker
    custom thread
    worker
```

## Bucket Rules

Prefer bucket resolution in this order:

1. Explicit project metadata override such as `sidebarParentProjectId`
2. Git-aware parent/worktree relationship when resolvable
3. Naming fallback heuristics only when explicit metadata is absent

Important:

- Never synthesize fake parent projects that the user did not configure.
- If no configured parent exists, keep the configured child bucket.
- Missing/deleted worktrees are an availability problem, not a sidebar identity problem.

## State Placement Rules

For sidebar behavior, classify state before editing:

- Browser-only UI state:
  - expanded/collapsed rows
  - hover/filter chip visibility
  - temporary drag interaction state
- Persisted project metadata:
  - project-parent override
  - current orchestration session root for a project
  - durable project navigation identity
- Server projection/query state:
  - session catalogs
  - orchestration thread families
  - cross-refresh read models needed by bootstrap or queries

Do not store durable navigation identity in browser-only state.

## Session Switching Trace

When the task touches the orchestration session selector, do not stop at the JSX. Trace the full read/write path before proposing changes.

Questions you must answer:

1. How are selector options built?
2. How is the current session root chosen?
3. Where is the current session persisted?
4. How is a historical session family reconstructed?
5. Does switching sessions mutate git/worktree state, or only thread/project projection state?

Default trace path:

```bash
sed -n '1,260p' apps/web/src/components/sidebar/OrchestrationSessionSelector.tsx
sed -n '520,900p' apps/web/src/components/OrchestrationSidebar.tsx
sed -n '1,320p' apps/web/src/components/sidebar/orchestrationModeActions.ts
sed -n '490,560p' apps/web/src/components/Sidebar.logic.ts
sed -n '410,520p' apps/web/src/lib/orchestrationMode.ts
sed -n '100,190p' apps/server/src/orchestration/decider.ts
sed -n '380,440p' apps/server/src/orchestration/Layers/ProjectionPipeline.ts
sed -n '340,650p' apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts
```

Default conclusions to verify instead of assuming:

- The selector is a thread-session reactivation control, not a git/worktree switcher.
- Session options come from persisted project threads, including archived roots.
- The current root is resolved by route thread first, then persisted project metadata, then latest active root.
- Historical session families are recovered by recursive lineage/workflow queries, not browser memory.
- `currentSessionRootThreadId` belongs in persisted project metadata, not browser-only UI state.
- Session switching archives/unarchives thread families and stops provider sessions, but does not create/remove/switch worktrees.

If any of those stop being true, the skill consumer should call that out explicitly.

## Files To Inspect First

Start here:

```bash
rg -n "sidebarOrchestrationModeEnabled|sidebarParentProjectId|currentSessionRootThreadId" apps/web packages/contracts apps/server/src/orchestration
rg -n "resolveConfiguredProjectBuckets|buildOrchestrationSessionCatalog|buildOrchestrationModeRowDescriptor" apps/web/src/lib/orchestrationMode.ts apps/web/src/components
rg -n "Sidebar|ProjectSidebar|OrchestrationSidebar|useSidebarProjectController" apps/web/src/components
```

Usually relevant files:

- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ProjectSidebar.tsx`
- `apps/web/src/components/OrchestrationSidebar.tsx`
- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/sidebar/useSidebarProjectController.ts`
- `apps/web/src/components/sidebar/OrchestrationSessionSelector.tsx`
- `apps/web/src/components/sidebar/orchestrationModeActions.ts`
- `apps/web/src/lib/orchestrationMode.ts`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`

## Refactor Order

When cleaning up sidebar code smell, work in this order:

1. Split mode-specific behavior first
2. Extract shared controller/actions next
3. Extract shared row/header primitives after behavior stabilizes
4. Move pure bucketing/session logic into `*.logic.ts` or `lib/`
5. Leave orchestration-specific shaping inside the orchestration path

This prevents "shared abstraction" from turning back into hidden coupling.

## Common Footguns

- Do not make orchestrator rows render worker trees again unless the user explicitly asks.
- Do not let worktree path layout become the source of truth for parent grouping.
- Do not keep the selected orchestration session only in browser-local state if the user expects it to survive refresh or be shared.
- Do not describe session switching as changing worktrees unless you verified actual git/worktree calls in that path.
- Do not assume the persisted `currentSessionRootThreadId` is always the same thing as the currently active unarchived root.
- Do not explain “previous state” as a cached UI list if the real source is `listSessionThreads(...)` over persisted thread lineage.
- Do not remove imports/helpers during extraction until all inline derivations are moved.
- Do not refactor both sidebars at once without stabilizing runtime after each seam.

## Response Pattern

When advising or implementing, structure the answer in this order:

1. Which sidebar mode is being changed
2. What the visible navigation model should be
3. Where the state should live
4. Which shared abstractions are safe to extract
5. What should remain mode-specific

## Escalate

- Use `t3-thread-lineage-decoder` when the confusion is about orchestrator/worker ancestry
- Use `t3-orchestration-trace` when a sidebar field needs full write/read tracing
- Use `t3-settings-workflow` when the change is driven by a new user setting
- Use `t3-ui-state-and-projection-boundaries` when the main question is where a value should live
