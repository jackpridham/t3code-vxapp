---
name: t3-performance
description: Use when adding, changing, reviewing, or debugging T3 Code performance, especially first-load latency, hard refresh behavior, ChatView/sidebar loading, hydration, bootstrap summary, current-state reads, websocket RPC volume, owner-command coalescing, React Query cache keys, fan-out, or runtime/sidebar authority boundaries.
---

# T3 Performance

Use this skill before changing code that can affect first load, route hydration,
sidebar rendering, ChatView rendering, websocket RPC volume, or background
owner/runtime reads.

Performance work in T3 must preserve correctness. Do not make the UI faster by
inventing a second truth source, weakening archive/delete semantics, or
reconstructing owner-backed runtime state from local projections.

## Default Workflow

1. Prove the live symptom.
2. Capture browser websocket frames and timings.
3. Identify the authoritative data owner for every slow read.
4. Replace broad reads with targeted reads only when the target contract is
   complete.
5. Add focused unit tests for edge cases and browser/websocket proof for the
   real route.
6. Run `bun fmt`, `bun lint`, and `bun typecheck`.

Do not stop at the first expensive call. Check route loaders, root bootstrap,
sidebar effects, React Query hooks, event recovery paths, and mutation
invalidation paths.

## Published Performance Probes

T3 publishes machine-readable performance probes through `.vx` metadata. Use
these when validating deterministic budgets or when a caller such as `vx` or
`agents-vxapp` needs the repo-owned JSON contract.

Reference doc:

- `@Docs/@TechnicalDocs/t3code-vxapp/performance-probes.md`

Source files:

- `.vx/performance-budgets.yaml`
- `.vx/performance-error-contract.yaml`
- `.vx/commands/command-manifest.yaml`
- `.vx/commands/public-probes.yaml`
- `scripts/perf/*`

Published command examples:

```bash
bun --cwd=scripts run --silent perf:validate -- --budget t3.direct_thread_hard_refresh --base-url http://127.0.0.1:7421 --thread-id <threadId> --json
```

```bash
bun --cwd=scripts run --silent perf:validate -- --budget agents.sidebar_authority_snapshot --base-url http://127.0.0.1:7421 --json
```

```bash
bun --cwd=scripts run --silent perf:watch-turn -- --budget t3.live_turn_pipeline --base-url http://127.0.0.1:7421 --thread-id <ctoThreadId> --message abc123 --json
```

The scripts emit stable JSON envelopes and exit with:

- `0` for pass
- `2` for invalid args, unavailable targets, missing config, or contract errors
- `3` for budget gate failures

For budgets with `max_subprocess_count`, provide `T3_PERF_TRACE_PATH`; missing
trace setup is a hard contract error.

## Validation Footguns

Real perf validation in this repo has a few easy-to-miss failure modes:

- Build `apps/web` before `apps/server` when validating served UI behavior.
  `apps/server` serves the bundled web assets, so rebuilding only the server can
  leave the runtime serving stale client code and produce false regressions.
- If the real home on `:7421` is wedged by startup or recovery issues, prove the
  UI-path fix on an isolated home first, then return to the real home to fix
  the runtime blocker and rerun the published probes on `:7421`.
- A `t3.live_turn_pipeline` failure on `final_to_settled` is not automatically a
  real settlement regression. Check whether the probe correlated the wrong
  assistant message before changing production code.

Observed probe-specific issue:

- Some real turns emit multiple non-streaming assistant `thread.message-sent`
  events on the same turn. `scripts/perf/playwrightTurnWatcher.ts` must use the
  latest correlated assistant message as the final-assistant milestone, not the
  first one.

## Red Flags

Investigate immediately when you see:

- `orchestration.getCurrentState` during normal hard refresh, root load,
  sidebar selection, or mode action paths.
- Multiple components independently fetching the same expensive owner/runtime
  data during boot.
- "Targeted" hydration still causing repeated owner-process shell-outs because
  the owner-client read path is missing short-TTL in-flight coalescing.
- Root route and child route both hydrating the same thread without in-flight
  dedupe.
- Route detail pages depending only on preloaded list data.
- Cache keys that omit behavior-changing inputs like `threadId`, `mode`,
  `workspace`, archive flags, or snapshot identity.
- Summary records being inserted where full records are required.
- Browser state being used as a fallback authority for vxapp Program, TODO,
  notification, attention, wake, thread-selection, or runtime truth.
- Mutations sharing the same coalescing path as reads.
- Debug/recovery fallbacks silently becoming normal-path behavior.

## Live Proof First

For load latency, use Playwright against the served app and inspect websocket
frames. Unit tests cannot prove the browser is not sending a broad RPC.

Minimal websocket capture pattern:

```bash
bun --cwd apps/web - <<'BUN'
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:7421/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.addInitScript(() => {
  const OriginalWebSocket = window.WebSocket;
  const log = [];
  window.__vxWsLog = log;
  class LoggedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener('message', (event) => {
        log.push({ dir: 'in', t: performance.now(), raw: String(event.data).slice(0, 500) });
      });
    }
    send(data) {
      log.push({ dir: 'out', t: performance.now(), raw: String(data) });
      return super.send(data);
    }
  }
  window.WebSocket = LoggedWebSocket;
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(30000);

const frames = await page.evaluate(() => window.__vxWsLog ?? []);
const outboundTags = frames
  .filter((frame) => frame.dir === 'out')
  .map((frame) => {
    try {
      return JSON.parse(frame.raw).body?._tag;
    } catch {
      return 'parse-error';
    }
  });

console.log(JSON.stringify({
  url: page.url(),
  getCurrentStateCount: outboundTags.filter((tag) => tag === 'orchestration.getCurrentState').length,
  outboundTags,
  preview: (await page.locator('body').innerText()).slice(0, 1000),
}, null, 2));

await browser.close();
BUN
```

For targeted hydration work, prove these browser paths separately:

- direct thread hard refresh
- root-to-active-thread load
- sidebar selection
- orchestration-mode switch/create, when a mounted UI control exists

If the UI control does not exist in the mounted route tree, document that
boundary and cover the function-level path with focused tests.

## Hydration Contract

Normal UI paths must not call `orchestration.getCurrentState` just to render a
thread. Prefer bootstrap summary plus targeted active-thread hydration.

High-risk files:

- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/_chat.$threadId.tsx`
- `apps/web/src/lib/orchestrationCurrentStateHydration.ts`
- `apps/web/src/lib/routeThreadHistoryHydration.ts`
- `apps/web/src/components/sidebar/useSidebarProjectController.ts`
- `apps/web/src/components/sidebar/orchestrationModeActions.ts`
- `apps/web/src/wsNativeApi.ts`
- `apps/server/src/wsServer.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`

Allowed `getCurrentState` usage must be explicit fallback or debug/recovery
only. Examples:

- bootstrap summary failed and no targeted base can be trusted
- replay recovery with no selected/current thread
- explicit debug/export recovery surfaces

Disallowed normal paths:

- hard refresh of a direct thread route
- root load that resolves to the active thread
- sidebar thread/program selection
- orchestration-mode session switch/create/reactivate actions

When removing a broad read, search all call sites first:

```bash
rg -n "getCurrentState|loadCurrentStateWith|hydrateMissingRouteThread|orchestrationModeActions" apps packages
```

## Read Model Rules

Do not synthesize invalid `OrchestrationReadModel` records.

An active-thread partial read model must preserve:

- `snapshotSequence`
- `snapshotProfile`
- `updatedAt`
- full `projects`
- `threads`
- `orchestratorWakeItems`
- `programs`
- `programNotifications`
- `ctoAttentionItems`
- `snapshotCoverage`

Project summaries are not full projects. If `OrchestrationReadModel.projects`
requires scripts/hooks, use a full-project endpoint such as
`orchestration.getProjectFullById`, merge with an existing full project from the
current base read model, or do not sync the hydrated thread.

Never add `getProjectById` summary data to a full-project array.

For `updatedAt`, prefer the base read model timestamp when available. If there
is no timestamp, use the current timestamp. Do not use `new Date(0)`; it causes
ordering and debug confusion.

## Targeted Thread Hydration

Targeted thread hydration should fetch only what the route needs:

- readiness for the target/root
- thread summaries that include archived threads but exclude deleted threads
- full project records for synced threads
- root messages, activities, sessions, and orchestrator wakes
- orchestrator worker checkpoints when required

Do not fan out to every worker message/activity history while hydrating an
orchestrator route. Preserve worker checkpoint behavior without loading all
worker timelines.

Deleted and archived semantics are correctness boundaries:

- direct archived-thread URLs must still hydrate when `includeArchived: true`
- deleted threads must resolve as not found and navigate home
- if `getThreadById` cannot express `includeDeleted: false`, keep using
  `listSessionThreads({ includeArchived: true, includeDeleted: false })` or add
  a targeted endpoint that can express it
- if a non-deleted fallback thread is found but no full project record can be
  resolved, do not sync that thread into the store

## Dedupe Rules

In-flight dedupe is only safe when the key covers every input that changes the
returned data, or when the deduped value is a fragment that is merged into the
caller's current base at resolution time.

For route/thread hydration, dedupe thread-detail fragments, not whole read
models. A whole read model can accidentally capture stale or missing projects,
programs, or authority data from another caller's base snapshot.

Good fragment key inputs include:

- `threadId`
- `mode`
- `historyMode`
- `includeOrchestratorWakes`

Do not include `baseReadModel` in the fragment itself. Merge the resolved
fragment with the caller's current base read model after the promise resolves.

If you dedupe a full read model anyway, the key must include
`baseReadModel?.snapshotSequence`, and tests must prove different bases do not
receive stale merged state.

Apply the same skepticism to owner-backed reads. If a route change replaced a
broad RPC with "targeted" owner reads but perf is still bad, inspect
`apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts` and confirm the
expensive read goes through the short-TTL/in-flight `coalesceRead` path.

Known example:

- `external_role_authority_snapshot` needed `coalesceRead: true`. Without it,
  `ProjectionOperationalQuery.getExternalSnapshot()` could reshell
  `agents-vxapp` repeatedly during direct-thread refresh and live-turn
  hydration, even though the browser-side RPC pattern looked correct.

## Runtime And Sidebar Authority

`~/agents-vxapp` is authoritative for vxapp-backed Program, TODO,
notification, attention, wake, thread-selection, and runtime truth.

Do not reconstruct these surfaces from partial orchestration read models:

- `fetchAgentsVxappSidebarAuthoritySnapshotFromOwner`
- `refreshSidebarAuthority`
- `agentsVxappSidebarGraphQueryOptions`
- `agentRuntimeSnapshotQueryOptions`
- `workerRuntimeSnapshotQueryOptions`

Worker runtime remains keyed by authoritative `threadId + workspace`. Do not
introduce new `worktreePath`-keyed runtime authority.

If owner data disagrees with local orchestration projections, fix the owner
contract or wiring. Do not add a browser-store fallback truth source to make the
UI appear healthy.

## Owner Command Coalescing

Coalesce read-only owner commands only.

Rules:

- Use stable canonical key serialization, not raw `JSON.stringify` on arbitrary
  input objects.
- Scope coalescing to owner reads where repeat callers truly want the same
  value.
- Never coalesce mutations, thread lifecycle commands, wake commands, provider
  commands, or any command whose idempotency is not proven.
- Clear coalesced read promises on every Program/TODO mutation completion and
  failure.
- Guard against stale in-flight reads resolving after mutation invalidation and
  overwriting newer state.

Mutation boundaries that should invalidate coalesced owner reads include:

- create/update/delete Program
- Program lifecycle mutations
- create/update/delete TODO
- TODO lifecycle/status mutations

Tests must include a stale in-flight owner read resolving after invalidation and
prove it cannot overwrite the newer generation.

## React Query And Cache Keys

Use React Query for in-flight browser RPC lifecycle, not as a substitute for
server-side caching or authority boundaries.

Rules:

- Put every behavior-changing input in the query key.
- Include archive/deleted flags when they change the result.
- Include runtime authority identity such as `threadId` and `workspace`.
- Use `enabled` for data dependencies, not to hide incorrect keys.
- Prefer query option helpers over direct component transport calls.
- Use `staleTime` intentionally; do not leave expensive reads hot by default.

When data should survive reload and show instantly, use a versioned
localStorage TTL cache. When expensive command output is shared across clients,
prefer server-side TTL cache.

## Component Performance

Rendering fixes should reduce work without changing truth sources.

Check for:

- expensive derived arrays or sorting inside Zustand selectors
- repeated object/array allocation that defeats memoization
- direct NativeApi calls from components
- effects that run on every render due to unstable dependencies
- duplicate preloaders mounted in multiple route branches
- visible loading overlays or pills that obstruct useful content after the data
  path is already in progress

For ChatView and sidebar work, preserve user workflows while removing blocking
or obstructing UI. Do not hide real errors; remove only redundant progress
chrome that blocks reading or composing.

## Testing Requirements

Add focused tests around the exact regression boundary. Useful files include:

- `apps/web/src/lib/routeThreadHistoryHydration.test.ts`
- `apps/web/src/lib/orchestrationCurrentStateHydration.test.ts`
- `apps/web/src/routes/__root.test.tsx`
- `apps/web/src/components/sidebar/orchestrationModeActions.test.ts`
- `apps/web/src/features/vxapp/agentsVxappStore.test.ts`
- `apps/web/src/wsNativeApi.test.ts`
- `packages/contracts/src/ws.test.ts`

For targeted hydration regressions, assert:

- no normal-path `getCurrentState`
- archived direct route found
- deleted direct route not found
- `{ threadId, mode }` or fragment-level in-flight dedupe
- runtime/sidebar authority preservation
- mutation invalidation clears or generations stale owner reads
- full-project requirement is respected before syncing hydrated threads

Never run `bun test`. Use `bun run test` for Vitest:

```bash
bun run test -- path/to/focused.test.ts
```

Final checks:

```bash
bun fmt
bun lint
bun typecheck
```

## Performance Review Checklist

Before finishing, answer these:

- Which live route proved the issue and the fix?
- Which websocket method tags were removed from the normal path?
- Which fallback paths may still call broad reads?
- Which authority surfaces remain owner/runtime-backed?
- What prevents duplicate route/root requests?
- What prevents stale in-flight reads from overwriting newer mutation state?
- What archive/delete edge cases are covered?
- What full-record requirements were preserved?
- Which tests and browser proofs protect the regression?
