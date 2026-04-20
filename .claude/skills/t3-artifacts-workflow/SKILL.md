---
name: t3-artifacts-workflow
description: Use when building, changing, or debugging the T3 Code `/artifacts` page, artifact routes, app-scoped artifact lists, chat links to `@Scratch` artifacts, artifact preloading, artifact detail markdown rendering, localStorage artifact caches, artifact slug/title routing, or navigation from the Artifacts group in the hamburger nav sidebar.
---

# T3 Artifacts Workflow

Use this skill for any work around `/artifacts` and Vortex app artifacts.

Artifacts are app-scoped records from Vortex wrappers. The browser should use preloaded metadata where possible, then fetch/read content only for the artifact being displayed.

## Current Files

Core route/UI:

- `apps/web/src/routes/artifacts.tsx`
- `apps/web/src/routes/artifacts.index.tsx`
- `apps/web/src/routes/artifacts.$targetId.tsx`
- `apps/web/src/routes/artifacts.$targetId.index.tsx`
- `apps/web/src/routes/artifacts.$targetId.$artifactTitle.tsx`
- `apps/web/src/components/artifacts/ArtifactsPage.tsx`
- `apps/web/src/components/artifacts/ArtifactTargetPage.tsx`
- `apps/web/src/components/artifacts/ArtifactDetailPage.tsx`
- `apps/web/src/components/artifacts/ArtifactsPreloader.tsx`
- `apps/web/src/lib/artifactPreloadCache.ts`
- `apps/web/src/lib/artifactsRoute.ts`
- `apps/web/src/lib/scratchArtifactLinks.ts`
- `apps/web/src/markdown-links.ts`

Navigation:

- `apps/web/src/components/sidebar/SidebarBrandHeader.tsx`
- `.claude/skills/t3-nav-sidebar-workflow/SKILL.md`

Server/app data:

- `packages/contracts/src/server.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`
- `apps/server/src/vortexApps/Services/VortexApps.ts`
- `apps/server/src/vortexApps/Layers/VortexApps.ts`
- `apps/server/src/wsServer.ts`
- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/lib/vortexAppsReactQuery.ts`

Markdown/content rendering references:

- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/ArtifactPanel.tsx`
- `apps/web/src/components/CodeFileViewer.tsx`

## Existing Behavior

- `/artifacts` is a standalone route and should not show the global app/sidebar layout.
- `/artifacts/:targetId` is an app-level artifact list.
- `/artifacts/:targetId/:artifactTitle` is a markdown detail view for one artifact.
- The hamburger nav has an `Artifacts` parent with app children.
- App list comes from `server.listVortexApps`.
- Artifact lists come from `server.listVortexAppArtifacts`.
- `ArtifactsPreloader` warms artifact metadata in localStorage every 5 minutes.
- `artifactPreloadCache.ts` owns localStorage TTL and changed-only merge logic.
- Chat markdown file links that point inside an exact `@Scratch` path segment are artifact links, not editor-open links. They should navigate to `/artifacts/:targetId/:artifactTitle`.

Do not move app/artifact list fetching into the route component unless the route needs an explicit fallback. Preloading belongs near root.

## Artifact List Command

Use:

```bash
vx apps <target> --artifact list --json --limit 100 --page <n>
```

For archived artifacts, pass:

```bash
vx apps <target> --artifact list --json --limit 100 --page <n> --include-archived
```

Fetch every page. Page 1 is not enough.

Known record fields:

- `title`
- `path`
- `preview`
- `repo`
- `createdAt`
- `kind`
- `status`
- `pinned`
- `archived`
- `threadId`
- `planKey`
- `worker`

Use `target_id` for app identity and route/cache keys. Use `display_name` only for labels.

## Route Pattern

Preferred user-facing detail route:

```text
/artifacts/:targetId/:artifactTitle
```

Examples:

```text
/artifacts/api/microsoft-oauth-filemanager-attachments-review
/artifacts/t3/some-artifact-title
/artifacts/slave/mediawiki-knowledge-base-feature-design
```

Route implementation rules:

- Keep `/artifacts` itself valid.
- Use TanStack file-route conventions already present in `apps/web/src/routes`.
- When a target route has both an app-level list and a detail child, make the target route a pure parent that renders `<Outlet />`.
- Put the app-level list in `artifacts.$targetId.index.tsx`, not directly in `artifacts.$targetId.tsx`; otherwise `/artifacts/:targetId/:artifactTitle` can render the list page instead of the detail page.
- Let the router plugin update `routeTree.gen.ts` when possible.
- If editing generated route tree manually, follow existing generated style exactly.
- Update standalone route matching in `apps/web/src/routes/__root.tsx` if a new nested path would otherwise show the global sidebar.
- Update `resolveRouteThreadId()` in `apps/web/src/routes/__root.tsx` so `/artifacts/...` is never interpreted as a chat thread id.

Expected file-route shape:

```text
artifacts.tsx                         -> /artifacts parent, renders <Outlet />
artifacts.index.tsx                   -> /artifacts
artifacts.$targetId.tsx               -> /artifacts/:targetId parent, renders <Outlet />
artifacts.$targetId.index.tsx         -> /artifacts/:targetId
artifacts.$targetId.$artifactTitle.tsx -> /artifacts/:targetId/:artifactTitle
```

## Slug And Matching Rules

Artifact title routing must be predictable.

Use one shared slug helper for:

- links in nav/list UI
- route matching
- tests

Slug guidance:

- normalize to lower-case
- trim whitespace
- replace whitespace and punctuation runs with `-`
- strip leading/trailing `-`
- keep the original artifact `title` for display

Matching priority:

1. Exact title match after URL decoding.
2. Slug match using the shared helper.
3. Path basename match when the artifact has no reliable title.

When deriving a slug from an artifact path, use the basename without a trailing `.md`. For example, `mediawiki-knowledge-base-feature-design.md` should route as `/artifacts/slave/mediawiki-knowledge-base-feature-design`, not `/artifacts/slave/mediawiki-knowledge-base-feature-design-md`.

If multiple artifacts collide on slug, prefer exact decoded-title match; otherwise show an ambiguity/error state rather than picking silently.

## Chat Link Rules

Artifact links in chat are ordinary markdown/file links until proven otherwise. Keep the behavior in the markdown link path rather than reintroducing the old artifact side panel callback.

Recognition rules:

- Use `apps/web/src/lib/scratchArtifactLinks.ts` as the shared detector/resolver.
- Require an exact `@Scratch` path segment. Do not match `Scratch`, `@Scratchpad`, or a display label.
- Treat the segment after `@Scratch` as the app target ID.
- Require a markdown filename ending in `.md`.
- Strip line/column suffixes, query strings, and hash fragments before matching.
- Accept path separators from either platform by normalizing `\` to `/`.
- Let `apps/web/src/markdown-links.ts` accept `@` in relative path segments so links like `@Docs/@Scratch/slave/report.md` resolve against `cwd`.

Resolution rules:

1. Read the target's artifact preload cache.
2. Match cached artifacts by normalized full path or by the `@Scratch/<target>/<filename>.md` suffix.
3. If a cached artifact matches, use its normalized metadata slug.
4. If no cached artifact matches, fall back to the linked filename without `.md`.
5. Build the href through `buildArtifactDetailHref()`.

Non-scratch file links should keep the existing preferred-editor open behavior.

## Content Fetching Rules

Artifact list metadata includes `path`. Use that path to read markdown content.

Before adding a new API, inspect existing read paths:

- `NativeApi.projects.readFile`
- workspace file read services
- `ArtifactPanel`
- `CodeFileViewer`

If existing APIs cannot safely read absolute artifact paths, add the smallest server RPC needed. Keep it read-only and schema-validated.

Do not fetch all markdown bodies during preload unless explicitly requested. Preload metadata only. Read full content when opening a detail route.

Artifact detail routes should render cached metadata immediately when available, then refresh from server/disk on mount:

- Refetch the artifact catalog with `staleTime: 0` and `refetchOnMount: "always"`.
- When fresh catalog data arrives, call `refreshArtifactPreloadCache()` so the localStorage cache is updated without waiting for the 5 minute preloader.
- Read the markdown body through `readWorkspaceFileContent()` with a query key that includes the resolved absolute artifact path.
- Set the content query to `staleTime: 0` and `refetchOnMount: "always"` so opening or revisiting the route reads disk again.

If a direct detail URL cannot find the artifact in the active preloaded cache, refetch the artifact list with archived artifacts included before showing a not-found state. Direct links to archived artifacts should still resolve when possible.

## Markdown Display Rules

The detail view should be readable and simple:

- header with artifact title
- app/repo metadata when available
- created date and status/pinned/archived badges if useful
- updated date and known pass-through metadata such as kind, worker, plan key, and thread id
- visible catalog/content refresh timestamps so users can tell whether the detail page has reloaded recently
- markdown body below

Reuse existing markdown rendering where possible:

- Prefer `ChatMarkdown` for markdown consistency.
- Reuse code highlighting utilities if rendering code blocks directly.
- Avoid cards inside cards.
- Do not make the main markdown body look like an embedded preview.

Handle states:

- loading artifact cache/list
- artifact not found
- content read failure
- empty markdown

The main markdown surface should be a document, not a preview card. Prefer a metadata header above the markdown and render `ChatMarkdown variant="document"` directly below it.

For refreshed-at display, distinguish catalog metadata from file content:

- Catalog refreshed time should come from fresh query data (`fetched_at`) when available, falling back to cached preload metadata.
- Content refreshed time should come from the file content query's `dataUpdatedAt`.
- Show a fetching indicator while either query is fetching, but keep the previously available content visible.

## List UI Rules

The app-level artifact list should support enough browser-side navigation to handle large repos:

- Full-height layout with explicit scroll container: use `h-dvh`, `min-h-0`, and `overflow-y-auto` on the scrolling region.
- Text filter over title, path, kind, preview, repo, and date metadata.
- Sort by most recent, recently updated, created date, pinned first, and title.
- Show pinned artifacts with a pin icon or equivalent marker.
- Hide archived artifacts by default.
- Provide a "Show archived" control that refetches through `server.listVortexAppArtifacts` with `includeArchived: true`.
- Provide a pinned-only filter.

Do not rely on document/body scrolling for `/artifacts`; the app shell uses clipped root overflow.

## Nav Sidebar Rules

When changing artifact links in the hamburger nav, also use `t3-nav-sidebar-workflow`.

Artifacts should remain a top-level parent:

```text
Chat
Artifacts
  <app or artifact children>
Settings
  General
  Threads
  Orchestration
  Archive
  Notifications
```

Use existing sidebar primitives:

- parent: `SidebarMenuButton size="sm"` with `text-xs`
- child: `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton`
- child text: `text-[11px]`

Do not put project/thread/orchestration rows in the artifact nav.

## Preload Rules

The artifact preloader must:

- mount near root, not only inside `/artifacts`
- start before the nav opens
- refresh every 5 minutes
- skip fresh localStorage entries
- fetch missing or expired entries
- use changed-only merge so unchanged artifacts are reused
- catch per-target failures and continue

Do not remove expired localStorage rows before diffing against the refreshed payload.

Preload the default active list only. Archived-inclusive lists are user-requested and should use a separate React Query key so they do not overwrite or confuse the active preload cache.

Do not treat preload cache freshness as enough for a detail view. Preload is for instant metadata and navigation; detail routes still need an immediate catalog/content refresh so the user does not read stale artifact data.

## Footguns

- Do not overwrite in-progress artifacts/cache/nav changes; inspect `git status --short` and relevant diffs first.
- Do not shell out from web code.
- Do not hard-code app targets.
- Do not fetch only first artifact page.
- Do not use display names as cache keys.
- Do not duplicate cache logic inside route components.
- Do not put markdown content into the artifact list preloader unless explicitly asked.
- Do not break `/artifact` singular; it is a different existing artifact window route.
- Do not put target list content directly in a parent route that has child routes; render an outlet and create an index route.
- Do not forget that `/artifacts/...` must be excluded from chat thread route resolution.
- Do not pass `includeArchived: false` unnecessarily if older servers may not yet understand the optional field during a rolling dev session.
- Do not route `@Scratch` chat links by display name; the app target ID is the segment after `@Scratch`.
- Do not leave `.md` in a filename-derived artifact slug.
- Do not use only React Query freshness defaults for detail content; force a disk read on mount.

## Validation

Light checks:

```bash
vx apps t3 --dev-server status
curl -I http://192.168.100.42:5733/artifacts
```

For detail routes, verify at least one real target/title:

```text
/artifacts/api/microsoft-oauth-filemanager-attachments-review
/artifacts/api/ai-workspace-live-recurring-quotes-api-audit
```

For final repo completion:

```bash
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test` if tests are needed.
