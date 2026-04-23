---
name: t3-tanstack-router-workflow
description: Use when adding, changing, debugging, or reviewing TanStack Router file routes in T3 Code, especially nested routes, index routes, route params, routeTree.gen.ts regeneration, standalone route matching, or bugs where a child URL renders the parent page. Trigger on TanStack route, file route, routeTree.gen.ts, Outlet, index route, nested route, route params, or /artifacts-style route work.
---

# T3 TanStack Router Workflow

Use this skill whenever a task touches `apps/web/src/routes`.

T3 Code uses TanStack Router file-route conventions. Parent routes with children must render an `<Outlet />`; the page content for the parent URL belongs in an index route.

## Primary Files

- `apps/web/src/routes/*.tsx`
- `apps/web/src/routeTree.gen.ts`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/__root.test.tsx`

Related feature route helpers often live under:

- `apps/web/src/lib/*Route.ts`
- `apps/web/src/lib/*Window.ts`

## Route Shape Rules

Use file-route conventions already present in the repo.

For a route that has both a parent URL and detail child URLs, use this shape:

```text
feature.tsx                  -> /feature parent, renders <Outlet />
feature.index.tsx            -> /feature page
feature.$id.tsx              -> /feature/:id parent, renders <Outlet />
feature.$id.index.tsx        -> /feature/:id page
feature.$id.$childSlug.tsx   -> /feature/:id/:childSlug page
```

Do not render page content directly in a route file that also has child routes. If you do, child URLs can render the parent page and hide the child page.

## Parent Route Pattern

Use:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

function FeatureParentRoute() {
  return <Outlet />;
}

export const Route = createFileRoute("/feature/$id")({
  component: FeatureParentRoute,
});
```

Use `Route.useParams()` inside the page/index/detail route that actually needs params.

## Generated Route Tree

Prefer regenerating `routeTree.gen.ts` instead of manual edits:

```bash
cd apps/web
bunx @tanstack/router-cli generate .
```

The generator may warn that `__root.test.tsx` does not export a route. That warning is expected unless route ignore config changes.

If the dev server is running, the TanStack plugin may regenerate automatically. Still inspect `routeTree.gen.ts` when route shape changes are central to the task.

## Links And Params

- Use route helper functions for repeated href construction.
- Encode dynamic route segments with `encodeURIComponent`.
- Decode and normalize route params where matching user-facing names or slugs.
- Keep display labels separate from route/cache IDs.

For slug routes, share the slug creation helper between:

- list links
- navigation links
- route matching
- tests

## Root Route Interactions

When adding a non-chat top-level route, check `apps/web/src/routes/__root.tsx`.

Update:

- standalone route matching if the route should bypass `AppSidebarLayout`
- `resolveRouteThreadId()` exclusions if the route starts with a segment that could be mistaken for a chat thread id

Example: `/artifacts/...` must be excluded from chat thread resolution.

Add or update focused tests in `apps/web/src/routes/__root.test.tsx` when route classification changes.

## Validation

For route structure:

```bash
cd apps/web
bunx @tanstack/router-cli generate .
```

For repo completion:

```bash
bun fmt
bun lint
bun typecheck
```

If tests are relevant, use `bun run test`, never `bun test`.

## Footguns

- Do not put index-page content in a parent route that has children.
- Do not hand-edit `routeTree.gen.ts` unless generation is unavailable.
- Do not forget that generated `FileRoutesByTo` may map `/feature/:id` to the index child.
- Do not let utility routes like `/artifact`, `/artifacts`, `/changes`, `/settings`, or `/sidebar` become chat thread IDs.
- Do not use display names as route params when stable IDs exist.
