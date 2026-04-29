---
name: t3-react-query-rpc-workflow
description: Use when adding, changing, or debugging browser-to-server RPC data flow in T3 Code, especially NativeApi methods, WebSocket method tags, contracts schemas, wsNativeApi mappings, React Query options/query keys, optional RPC request flags, or stale/refetch behavior. Trigger on React Query, queryOptions, NativeApi, WS_METHODS, server RPC, WebSocket RPC, query key, staleTime, enabled query, or contracts-to-web data flow.
---

# T3 React Query RPC Workflow

Use this skill when browser UI data crosses the NativeApi/WebSocket boundary.

The shape is: contracts define schemas and NativeApi types; the server routes WebSocket methods; the web app calls NativeApi from React Query query functions.

## Primary Files

Contracts:

- `packages/contracts/src/server.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`

Server:

- `apps/server/src/wsServer.ts`
- feature service files under `apps/server/src/**/Services`
- feature layer files under `apps/server/src/**/Layers`

Web:

- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/nativeApi.ts`
- `apps/web/src/lib/*ReactQuery.ts`
- consuming components under `apps/web/src/components`

## Normal RPC Wiring Order

When adding a new RPC:

1. Add input/result schemas in the relevant contracts file.
2. Add the method type to `NativeApi` in `packages/contracts/src/ipc.ts`.
3. Add the WS method tag in `packages/contracts/src/ws.ts`.
4. Add the request body schema to `WebSocketRequestBody`.
5. Implement or extend the server service/layer.
6. Route the method in `apps/server/src/wsServer.ts`.
7. Add the browser mapping in `apps/web/src/wsNativeApi.ts`.
8. Add React Query query options in `apps/web/src/lib/*ReactQuery.ts`.
9. Use those query options from components.

Do not call transport methods directly from components.

## React Query Rules

Use `queryOptions()` helpers for shared queries.

Query helper pattern:

```ts
export const featureQueryKeys = {
  all: ["feature"] as const,
  detail: (id: string, mode: string) => ["feature", id, mode] as const,
};

export function featureDetailQueryOptions(input: { id: string; mode?: string }) {
  const mode = input.mode ?? "default";
  return queryOptions({
    queryKey: featureQueryKeys.detail(input.id, mode),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.someMethod({ id: input.id, mode });
    },
    staleTime: 60_000,
  });
}
```

Rules:

- Query functions should call `ensureNativeApi()`.
- Query keys must include every option that changes returned data.
- Use `enabled` for data dependencies, not as a substitute for correct cache keys.
- Set `staleTime` to match the expected freshness of the data.
- Do not put durable preference state in React Query.

For detail pages backed by files or mutable server-side command output, prefer an immediate revalidation pattern:

```ts
const result = useQuery({
  ...featureDetailQueryOptions(input),
  staleTime: 0,
  refetchOnMount: "always",
});
```

This is appropriate when the page can show cached/preloaded metadata instantly but must verify the backing resource on every open. Expose `dataUpdatedAt` or server-provided `fetched_at` when users need to see whether the refresh has completed.

## Optional Request Flags

When adding optional flags, keep compatibility in mind during local dev.

Good pattern:

```ts
return api.server.listSomething(
  includeArchived ? { target_id: targetId, includeArchived: true } : { target_id: targetId },
);
```

Avoid sending `{ includeArchived: false }` unless the server schema explicitly requires it. This reduces breakage when the browser refreshes before the server has restarted with the new optional field.

Use distinct query keys:

```ts
["artifacts", targetId, includeArchived ? "withArchived" : "active"];
```

## Cache Boundary Rules

- Server command output shared across clients belongs in server-side TTL cache if expensive.
- Browser preload state that should survive reload can use localStorage TTL.
- React Query handles in-flight dedupe and component lifecycle.
- Component state is for transient controls like filter text, sort selection, and checkboxes.

When the same endpoint can return active-only and archived-inclusive data, keep those caches separate unless the data model explicitly merges them.

## Component Consumption

- Call `useQuery(queryOptionsHelper(input))`.
- Do not call NativeApi directly during render.
- Keep transient UI state local unless it is a real setting.
- Fall back from preloaded/local data to RPC data when possible.
- Render clear loading, empty, and error states.

For direct detail URLs, do not depend only on preloaded list data. If the cache misses, fetch the server list before showing not-found.

When a fresh detail/list RPC response supersedes a browser preload cache, update the durable cache from the query success path or a guarded effect. Keep the write centralized in the cache helper; do not duplicate localStorage merge logic in the component.

## Validation

At minimum:

```bash
bun fmt
bun lint
bun typecheck
```

For route/UI features, also hit a real dev URL or run focused tests where available.

If tests are relevant, use `bun run test`, never `bun test`.

## Footguns

- Do not forget `packages/contracts/src/ws.ts`; method types alone are not enough.
- Do not forget `apps/web/src/wsNativeApi.ts`; server routing alone is not enough.
- Do not reuse query keys for different result shapes.
- Do not use display names as stable query/cache IDs.
- Do not send optional false flags through a still-running older server unless compatibility is known.
- Do not shell out from browser query functions.
- Do not cache server command output only in React Query when the command should be server-authoritative and shared.
- Do not rely on default query freshness for disk-backed detail content that users expect to update instantly after a file changes.
