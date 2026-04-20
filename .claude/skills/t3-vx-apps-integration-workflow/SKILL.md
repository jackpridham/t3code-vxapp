---
name: t3-vx-apps-integration-workflow
description: Use when adding, changing, or debugging T3 Code integration with Vortex app wrappers, especially `vx apps --list --json`, `vx apps <target> --artifact ...`, app catalog data, app target IDs, app-scoped server RPCs, NativeApi methods, or UI features driven by configured Vortex apps. Triggers on vx apps, Vortex apps, app catalog, target_id, app wrappers, app-scoped artifacts, `server.listVortexApps`, `server.listVortexAppArtifacts`, or adding app data to navigation/artifacts pages.
---

# T3 Vortex Apps Integration Workflow

Use this skill whenever T3 Code needs to call or model `vx apps ...` output.

The integration boundary must stay server-side. Browser code must not shell out or assume local filesystem paths are readable directly.

## Current Integration Shape

Primary files:

- `packages/contracts/src/server.ts`
  - Owns app catalog, artifact list, and cache result schemas.
- `packages/contracts/src/ipc.ts`
  - Owns `NativeApi.server.*` method types.
- `packages/contracts/src/ws.ts`
  - Owns WebSocket method tags and request body schemas.
- `apps/server/src/vortexApps/Services/VortexApps.ts`
  - Owns service interface and typed errors.
- `apps/server/src/vortexApps/Layers/VortexApps.ts`
  - Runs `vx apps ...`, decodes JSON, handles pagination, and returns typed results.
- `apps/server/src/wsServer.ts`
  - Routes WebSocket RPC methods to the service.
- `apps/server/src/serverLayers.ts`
  - Provides the service layer.
- `apps/web/src/wsNativeApi.ts`
  - Maps browser NativeApi methods to WebSocket RPCs.
- `apps/web/src/lib/vortexAppsReactQuery.ts`
  - Owns browser query options and query keys.

## App Catalog Pattern

Configured apps come from:

```bash
vx apps --list --json
```

Do not hard-code the app list in UI code.

Expected key fields:

- `projects[].target_id`: stable selector for follow-up wrapper commands.
- `projects[].display_name`: user-facing label.
- `projects[].name`: repo directory name.
- `projects[].path`: workspace path.
- `projects[].installed`: whether the repo is present.

When the browser needs configured apps:

1. Add or reuse a server RPC.
2. Decode command output with Effect Schema in contracts/server-side code.
3. Cache server-side if repeated shelling is expensive.
4. Fetch in the browser through NativeApi + React Query.

## App-Scoped Artifact Pattern

Use app wrappers for artifact lists:

```bash
vx apps <target> --artifact list --json --limit 100 --page <n>
```

Include archived artifacts only when the UI explicitly requests them:

```bash
vx apps <target> --artifact list --json --limit 100 --page <n> --include-archived
```

The wrapper caps large limits, so page until backend pagination is complete.

Preferred result shape in T3:

- `target_id`
- `fetched_at`
- `total_results`
- `artifacts`

Artifact records are pass-through metadata objects. Known useful fields include:

- `title`
- `path`
- `preview`
- `repo`
- `createdAt`
- `kind`
- `status`
- `pinned`
- `archived`
- `archivedAt`
- `threadId`
- `planKey`
- `worker`
- `updatedAt` may be absent; use `createdAt` as the fallback for recently-updated ordering.

Do not over-normalize artifact records unless a consumer needs a stable field. Keep the raw record available so future UI can use new metadata without another server change.

For UI metadata helpers, normalize only the fields needed for stable display/routing and keep the original record alongside them. If `title` is absent, derive the display/routing fallback from the artifact path basename without a trailing `.md`.

## Adding a New Vx Apps RPC

Follow this order:

1. Add schemas/types in `packages/contracts/src/server.ts`.
2. Add NativeApi method type in `packages/contracts/src/ipc.ts`.
3. Add WS method tag and request schema in `packages/contracts/src/ws.ts`.
4. Add service method in `apps/server/src/vortexApps/Services/VortexApps.ts`.
5. Implement command execution and decoding in `apps/server/src/vortexApps/Layers/VortexApps.ts`.
6. Route the WS method in `apps/server/src/wsServer.ts`.
7. Add the browser transport mapping in `apps/web/src/wsNativeApi.ts`.
8. Add React Query options in `apps/web/src/lib/*ReactQuery.ts` if UI code will call it.

If a contracts type changes and the dev server is running, restart the managed dev server so contracts are rebuilt:

```bash
vx apps t3 --dev-server stop
vx apps t3 --dev-server start --daemon
```

For optional request flags such as `includeArchived`, keep the field optional in contracts and only send it from the browser when true unless the server requires an explicit false. This keeps the browser compatible during local restart windows.

## Command Execution Rules

Use `runProcess` from `apps/server/src/processRunner.ts`.

Set explicit safety bounds:

- `cwd`: use `ServerConfig.cwd`
- `timeoutMs`: command-specific, not infinite
- `maxBufferBytes`: large enough for expected JSON
- `allowNonZeroExit`: default false unless the wrapper documents non-zero as data

Never parse CLI JSON with ad hoc string slicing. Use `Schema.decodeEffect(Schema.fromJsonString(...))`.

Map errors into a tagged service error that includes:

- operation
- human-readable detail
- original cause

## UI Consumption Rules

- Use `ensureNativeApi()` in query functions.
- Use stable query keys.
- Include meaningful request options in query keys. For example, `listVortexAppArtifacts(targetId, includeArchived)` needs distinct keys for active-only and archived-inclusive lists.
- Do not call NativeApi directly from render.
- Do not duplicate app catalog state into component-local state unless it is transient UI state.
- Use display names for labels and target IDs for route/cache keys.

Artifact metadata can include absolute paths outside the target app workspace, commonly under a shared knowledge/artifact store. If a UI needs file content, first try the existing workspace read helper path. If it cannot safely read the absolute artifact path, add the smallest read-only server RPC rather than broadening unrelated write APIs.

Artifact detail routes may use preloaded artifact metadata for instant display, but should refetch `server.listVortexAppArtifacts` on mount and write the fresh response back through the artifact preload cache helper. This keeps localStorage current without waiting for the background 5 minute preloader.

## Footguns

- Do not call `vx apps ...` from the browser.
- Do not hard-code app targets in `SidebarBrandHeader.tsx` or artifacts UI.
- Do not forget to rebuild/restart after contracts changes.
- Do not add WS tags without updating `NativeApi` and `wsNativeApi`.
- Do not fetch only page 1 when pagination reports more pages.
- Do not use the active-only artifact preload cache as the source of truth for archived-inclusive views.
- Do not assume `title` is always present; path-derived fallback slugs must strip `.md`.
- Do not assume all repos expose every wrapper; check wrapper support if adding a new workflow.
- Do not use deprecated `vx projects ...` aliases.

## Validation

At minimum for RPC changes:

```bash
vx apps t3 --dev-server status
```

Then exercise the WebSocket RPC directly or through the UI.

For final repo completion, run:

```bash
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test` if tests are needed.
