---
name: t3-cache-ttl-workflow
description: Use when adding, changing, or debugging caching in T3 Code, especially SQLite TTL cache rows, `runtime_ttl_cache`, React Query stale/refetch intervals, localStorage preload caches, 5 minute refresh policies, cache invalidation, changed-only refreshes, or deciding whether data should live in SQL, React Query, localStorage, or component state.
---

# T3 Cache And TTL Workflow

Use this skill before changing cache behavior in T3 Code.

The main rule: put the cache at the layer that owns the cost and sharing boundary.

## Cache Placement

Use this decision table:

| Data | Preferred cache | Why |
| --- | --- | --- |
| Expensive server command output shared by all clients | SQLite TTL cache | Avoid repeated shelling and keep server-authoritative freshness. |
| Browser display data that should survive refresh and be immediately available | localStorage TTL cache | Warm UX without blocking on server calls. |
| In-flight browser RPC result | React Query | De-dupe requests and handle component lifecycle. |
| Open/closed UI state | React state | Transient and local to component. |
| Durable user preference | Settings workflow | Use `t3-settings-workflow`, not ad hoc cache. |

If the value is derived from `vx apps ...`, the command must run server-side. Browser caches may store the result after it has crossed NativeApi.

## Server SQLite TTL Pattern

Use the generic table:

```sql
runtime_ttl_cache (
  cache_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

Migration:

- Lives in `apps/server/src/persistence/Migrations/NNN_*.ts`.
- Must be statically imported and added to `migrationEntries` in `apps/server/src/persistence/Migrations.ts`.
- Use `CREATE TABLE IF NOT EXISTS`.
- Add indexes for lookup/expiry patterns if useful.

Service pattern:

1. Read row by key.
2. If row exists and `expires_at > Date.now()`, decode `value_json`.
3. If decode fails, treat as stale and refresh.
4. If missing/expired, recompute.
5. Store strict JSON with new `refreshed_at`, `expires_at`, and `updated_at`.
6. Return cache metadata (`hit`, `refreshed_at`, `expires_at`) if useful for diagnostics.

Do not store non-JSON text blobs in `value_json`.

## Browser LocalStorage TTL Pattern

Use localStorage when the browser should have data ready after reload and before the user opens a surface.

Required fields for localStorage cache envelopes:

- `schemaVersion`
- stable owner key, for example `targetId`
- `fetchedAt`
- `expiresAt`
- payload

On invalid schema or mismatched owner key, remove the localStorage row.

On expired but parseable data, do not immediately remove it if you need changed-only comparison. Keep it long enough to diff against the refreshed payload, then overwrite.

## Changed-Only Refresh Pattern

When the user asks to avoid hard-reloading unchanged cached data:

1. Define a stable record key.
   - Prefer `path` for artifacts.
   - Fall back to stable `title`.
   - Use index only as a last resort.
2. Build a deterministic fingerprint for each record.
   - Sort object keys before stringifying.
   - Include the fields that affect display and behavior.
3. When fresh data arrives:
   - New key: insert new record.
   - Existing key with same fingerprint: reuse the existing cached object.
   - Existing key with changed fingerprint: replace that record only.
   - Missing key: omit it unless the UI needs tombstones.
4. Refresh the envelope TTL after the merge.

This avoids unnecessary localStorage churn and preserves object identity for unchanged records.

## React Query Rules

Use React Query for request de-dupe, not as the only durable cache.

For background refresh:

- `staleTime` should match expected freshness.
- `refetchInterval` can drive periodic checks while the app is open.
- Keep query keys stable and narrow.
- Query functions should call `ensureNativeApi()`, not shell commands.

Do not set a query to `enabled: open` if the data must be preloaded before the user opens a drawer or route.

## Concurrency And Load Rules

- Avoid fan-out from every component. Mount one background preloader near the root if data should always be warm.
- Use a `running` guard inside interval effects to avoid overlapping refreshes.
- Keep per-target requests sequential or low-concurrency unless the wrapper is known to tolerate load.
- Always catch per-target failures so one bad repo does not stop the whole preload pass.

## Footguns

- Do not cache by display label when a stable ID exists.
- Do not delete expired localStorage entries before comparing changed records if changed-only refresh is needed.
- Do not put server command TTL only in React Query; that still re-runs commands per server process/client pattern.
- Do not put user preferences in TTL caches.
- Do not introduce a second SQL cache table when `runtime_ttl_cache` fits.
- Do not mutate cached payloads in place; write a new envelope.
- Do not forget schema versioning for localStorage.

## Validation

For server cache:

- Verify first call is a miss and second call is a hit when metadata exists.
- Verify decode failure refreshes rather than crashing permanently.

For browser cache:

- Verify missing localStorage fetches.
- Verify fresh localStorage skips.
- Verify expired localStorage refreshes and only replaces changed records.

Final repo checks:

```bash
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test` if needed.
