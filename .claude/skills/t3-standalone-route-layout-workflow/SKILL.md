---
name: t3-standalone-route-layout-workflow
description: Use when adding, changing, or debugging T3 Code routes that should bypass the global app sidebar, use full-window layouts, need fixed-height scroll containers, or interact with root route standalone matching. Trigger on standalone route, global sidebar hidden, AppSidebarLayout, h-dvh, cannot scroll, utility window route, /artifact, /artifacts, /changes, or root route layout bugs.
---

# T3 Standalone Route Layout Workflow

Use this skill when a route should render outside the normal chat/project shell.

The app root clips body overflow, so standalone pages need their own explicit height and scroll containers. Do not assume document scrolling works.

## Primary Files

- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/__root.test.tsx`
- route files under `apps/web/src/routes`
- feature page components under `apps/web/src/components`
- route helper files under `apps/web/src/lib/*Route.ts` or `apps/web/src/lib/*Window.ts`

## Root Layout Model

`RootRouteView` decides whether a path renders:

- inside `AppSidebarLayout`
- as a sidebar window route
- as a standalone route

Standalone routes render just `<Outlet />`, without the global app sidebar or `ArtifactPanel`.

When adding a standalone route:

1. Add a helper such as `isFeaturePath(pathname)` if the route family needs reuse.
2. Include it in `isStandaloneRootRoutePath(pathname)`.
3. Add route-thread exclusion in `resolveRouteThreadId(pathname)` if the top-level path is not a chat thread id.
4. Add or update focused root-route tests.

## Known Standalone Families

- `/artifact` singular: existing artifact pop-out/window route.
- `/artifacts` plural: Vortex app artifact browser/detail routes.
- `/changes/*`: standalone changes route.
- `/sidebar/*`: separate sidebar window route, handled separately from normal standalone routes.

Do not conflate `/artifact` and `/artifacts`; they have different responsibilities.

## Scroll Container Rules

Because the app shell uses clipped root overflow, standalone pages should own scrolling explicitly.

Good patterns:

```tsx
<main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background text-foreground">
  ...
</main>
```

For a fixed header plus scrollable list:

```tsx
<main className="flex h-dvh min-h-0 flex-col overflow-hidden">
  <header className="shrink-0">...</header>
  <section className="min-h-0 flex-1 overflow-y-auto">...</section>
</main>
```

Use `min-h-0` on flex children that need to shrink and scroll.

## Layout Rules

- Keep standalone pages full-height and readable.
- Do not put the primary content in an embedded-preview-looking frame.
- A metadata header can be bordered; the main document/list surface should have a clear scroll region.
- Preserve the hamburger nav in the app header where relevant, but do not render the global project/thread sidebar on standalone routes.
- Text should truncate or wrap predictably; paths need `min-w-0` and `truncate` when shown in tight rows.

## Route Classification Checklist

When a new standalone route is added:

- Does `/new-route` hide the global app sidebar?
- Does `/new-route/nested` also hide it?
- Does `resolveRouteThreadId("/new-route/...")` return `null`?
- Does the route still work on refresh or direct URL entry?
- Does the page scroll when content exceeds viewport height?

## Validation

Use a real local URL when a dev server is running:

```bash
curl -I http://192.168.100.42:5733/<route>
```

For final repo completion:

```bash
bun fmt
bun lint
bun typecheck
```

If tests are relevant, use `bun run test`, never `bun test`.

## Footguns

- Do not rely on `body` scrolling in this app.
- Do not forget nested paths when matching standalone route families.
- Do not classify utility routes as chat thread ids.
- Do not hide the hamburger nav sidebar by confusing it with the global project/thread sidebar.
- Do not add another root layout switch if `isStandaloneRootRoutePath()` already fits.
