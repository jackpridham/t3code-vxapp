---
name: t3-nav-sidebar-workflow
description: Build on or modify the T3 Code hamburger navigation sidebar. Use this whenever the user mentions the nav sidebar, hamburger menu, app navigation menu, grouped settings navigation, sidebar logo/header actions, or asks to add, remove, reorder, style, indent, or route items in the new navigation sheet. This skill keeps agents from dumping route links flat, duplicating project/thread sidebar logic, or bypassing the shared sidebar primitives.
---

# T3 Navigation Sidebar Workflow

Use this skill for changes to the hamburger navigation menu opened from the logo row inside the app sidebar.

The navigation menu is separate from project/thread navigation. Keep it as a small, explicit app navigation tree rather than deriving it from all routes.

## Current Shape

Primary files:

- `apps/web/src/components/sidebar/SidebarBrandHeader.tsx`
  - Owns the logo/header row, hamburger trigger, navigation sheet, nav item tree, grouping, indentation, and open/closed state.
- `apps/web/src/components/sidebar/SidebarShared.tsx`
  - Owns `T3Wordmark`.
- `apps/web/src/components/ProjectSidebar.tsx`
  - Normal project/thread sidebar. It should render `SidebarBrandHeader` and keep project/thread behavior mode-specific.
- `apps/web/src/components/OrchestrationSidebar.tsx`
  - Orchestration project/thread sidebar. It should render `SidebarBrandHeader` and keep orchestration behavior mode-specific.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx`
  - Existing settings-section definitions. Prefer reusing `SETTINGS_NAV_ITEMS` for settings children so labels/icons/routes stay consistent.
- `apps/web/src/components/ui/sidebar.tsx`
  - Shared sidebar primitives: `Sidebar`, `SidebarProvider`, `SidebarHeader`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuSub`, `SidebarMenuSubButton`, etc.
- `apps/web/src/components/ui/sheet.tsx`
  - Portal-backed sheet overlay used for the nav drawer.

## Navigation Model

Use a hardcoded tree like:

```text
Chat
Artifacts
  <configured app display names>
Settings
  General
  Threads
  Orchestration
  Archive
  Notifications
```

Why:

- Settings is not a useful top-level route in the app mental model.
- The settings sections should be visually subordinate to `Settings`.
- Artifacts is a useful top-level route, but its children come from the configured Vortex app catalog, not from route scanning.
- A hardcoded tree gives better control over grouping, ordering, icons, indentation, labels, and future hiding/showing rules.
- Do not dynamically dump every route into this menu.

When adding new top-level destinations, add them as explicit top-level nodes.

When adding new settings sections, update `SETTINGS_NAV_ITEMS` first, then let the nav sidebar reuse it as settings children.

When adding or changing artifact navigation:

- Use `server.listVortexApps` through `vortexAppsListQueryOptions()`.
- Use `project.display_name` for labels.
- Use `project.target_id` for routes and matching.
- Link children to `/artifacts/:targetId`, not to the blank `/artifacts` root.
- Mark an artifact app child active for both `/artifacts/:targetId` and `/artifacts/:targetId/*`.
- Keep the `Artifacts` parent active for `/artifacts` and every nested artifacts route.

## Layout Rules

The hamburger icon belongs on the same line as the logo, aligned right.

Keep this structure in `SidebarBrandHeader`:

```tsx
<SidebarHeader ...>
  <div className="flex w-full min-w-0 items-center gap-2">
    {!isStandaloneWindow ? <SidebarTrigger className="shrink-0 md:hidden" /> : null}
    <SidebarBrandMark />
    <SidebarNavigationMenu />
  </div>
</SidebarHeader>
```

Important details:

- `SidebarBrandMark` should flex and truncate.
- `SidebarNavigationMenu` should stay `shrink-0`, so it remains pinned to the right of the logo row.
- Keep the Electron `drag-region` header variant, but ensure buttons remain clickable through existing no-drag button CSS.
- Preserve the mobile sidebar trigger for non-standalone windows.

## Overlay Rules

The hamburger menu should open a `Sheet`, not inline content inside the project/thread sidebar.

Use:

- `Sheet`, `SheetTrigger`, `SheetPopup` from `../ui/sheet`
- `SidebarProvider` + `Sidebar collapsible="none"` inside the sheet
- `showCloseButton={false}` unless the user explicitly asks for a visible close button
- local React state for `open`

State placement:

- Menu open/closed is browser-only transient UI state. Keep it in `SidebarNavigationMenu` with `useState`.
- Do not add settings, server projection state, or project metadata for the menu open state.

## Styling Rules

Use the existing sidebar primitives for visual consistency:

- Top-level items: `SidebarMenuButton size="sm"` with `text-xs`
- Child items: `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton`
- Child item font should be smaller than parent items, currently `text-[11px]`
- Child items should be indented by `SidebarMenuSub`, which provides a left border and offset
- Active parent and active child should use foreground text; inactive entries should use muted text

Do not use cards inside the nav sheet.

Do not put project/thread data, orchestration session data, or worker rows in this nav menu.

## Implementation Pattern

Prefer these types:

```tsx
type AppNavigationItem = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  match: (pathname: string) => boolean;
  to: string;
};

type AppNavigationGroup = {
  children: readonly AppNavigationItem[];
  icon: ComponentType<{ className?: string }>;
  label: string;
  match: (pathname: string) => boolean;
  to: "/artifacts" | SettingsSectionPath;
};
```

Use a type guard such as:

```tsx
function hasNavigationChildren(item: AppNavigationNode): item is AppNavigationGroup {
  return "children" in item;
}
```

For settings children, prefer:

```tsx
const SETTINGS_NAVIGATION_CHILDREN: readonly AppNavigationItem[] = SETTINGS_NAV_ITEMS.map(
  (item) => ({
    ...item,
    match: (pathname) => pathname === item.to,
  }),
);
```

This keeps settings labels/icons/routes centralized while letting the app nav control hierarchy and styling.

## Routing Rules

Use TanStack Router `useNavigate` for internal navigation:

```tsx
void navigate({ to, replace: false });
```

Close the sheet before navigating:

```tsx
const navigateTo = (to: AppNavigationNode["to"]) => {
  setOpen(false);
  void navigate({ to, replace: false });
};
```

Active matching guidance:

- `Settings` parent should be active for `/settings` and `/settings/*`.
- Settings children should be active only for their exact route.
- `Artifacts` parent should be active for `/artifacts` and `/artifacts/*`.
- Artifact app children should be active for exact target routes and nested detail routes.
- `Chat` should be active for regular chat/thread routes, but not utility windows like `/artifact`, `/artifacts`, `/changes/*`, or `/sidebar`.

## What To Avoid

- Do not add nav links directly to `ProjectSidebar.tsx` or `OrchestrationSidebar.tsx`.
- Do not duplicate the logo/header JSX in both sidebars.
- Do not derive nav items by scanning route files.
- Do not flatten settings children into top-level rows.
- Do not flatten artifact app children into unrelated top-level rows.
- Do not use project/thread/orchestration row components for global app navigation.
- Do not persist open/closed state unless the user asks for durable behavior.
- Do not introduce another overlay primitive when `Sheet` already fits.

## Validation

For implementation work in this repo, the final task-completion checks are:

```bash
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test` if tests are needed.

If the user explicitly asks to skip checks until later, honor that for the current turn and say what was not run.
