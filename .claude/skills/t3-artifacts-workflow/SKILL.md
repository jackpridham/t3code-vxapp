---
name: t3-artifacts-workflow
description: Use when building, changing, or debugging the T3 Code `/artifacts` page, artifact routes, app-scoped artifact lists, artifact preloading, artifact detail markdown rendering, localStorage artifact caches, artifact slug/title routing, or navigation from the Artifacts group in the hamburger nav sidebar.
---

# T3 Artifacts Workflow

Use this skill for any work around `/artifacts` and Vortex app artifacts.

Artifacts are app-scoped records from Vortex wrappers. The browser should use preloaded metadata where possible, then fetch/read content only for the artifact being displayed.

## Current Files

Core route/UI:

- `apps/web/src/routes/artifacts.tsx`
- `apps/web/src/components/artifacts/ArtifactsPage.tsx`
- `apps/web/src/components/artifacts/ArtifactsPreloader.tsx`
- `apps/web/src/lib/artifactPreloadCache.ts`

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
- `apps/web/src/components/ArtifactPanel.tsx`
- `apps/web/src/components/CodeFileViewer.tsx`

## Existing Behavior

- `/artifacts` is a standalone route and should not show the global app/sidebar layout.
- The hamburger nav has an `Artifacts` parent with app children.
- App list comes from `server.listVortexApps`.
- Artifact lists come from `server.listVortexAppArtifacts`.
- `ArtifactsPreloader` warms artifact metadata in localStorage every 5 minutes.
- `artifactPreloadCache.ts` owns localStorage TTL and changed-only merge logic.

Do not move app/artifact list fetching into the route component unless the route needs an explicit fallback. Preloading belongs near root.

## Artifact List Command

Use:

```bash
vx apps <target> --artifact list --json --limit 100 --page <n>
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
```

Route implementation rules:

- Keep `/artifacts` itself valid.
- Use TanStack file-route conventions already present in `apps/web/src/routes`.
- Let the router plugin update `routeTree.gen.ts` when possible.
- If editing generated route tree manually, follow existing generated style exactly.
- Update standalone route matching in `apps/web/src/routes/__root.tsx` if a new nested path would otherwise show the global sidebar.

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
3. Optional path basename match if needed.

If multiple artifacts collide on slug, prefer exact decoded-title match; otherwise show an ambiguity/error state rather than picking silently.

## Content Fetching Rules

Artifact list metadata includes `path`. Use that path to read markdown content.

Before adding a new API, inspect existing read paths:

- `NativeApi.projects.readFile`
- workspace file read services
- `ArtifactPanel`
- `CodeFileViewer`

If existing APIs cannot safely read absolute artifact paths, add the smallest server RPC needed. Keep it read-only and schema-validated.

Do not fetch all markdown bodies during preload unless explicitly requested. Preload metadata only. Read full content when opening a detail route.

## Markdown Display Rules

The detail view should be readable and simple:

- header with artifact title
- app/repo metadata when available
- created date and status/pinned/archived badges if useful
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

## Footguns

- Do not overwrite in-progress artifacts/cache/nav changes; inspect `git status --short` and relevant diffs first.
- Do not shell out from web code.
- Do not hard-code app targets.
- Do not fetch only first artifact page.
- Do not use display names as cache keys.
- Do not duplicate cache logic inside route components.
- Do not put markdown content into the artifact list preloader unless explicitly asked.
- Do not break `/artifact` singular; it is a different existing artifact window route.

## Validation

Light checks:

```bash
vx apps t3 --dev-server status
curl -I http://192.168.100.42:5733/artifacts
```

For detail routes, verify at least one real target/title:

```text
/artifacts/api/microsoft-oauth-filemanager-attachments-review
```

For final repo completion:

```bash
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test` if tests are needed.
