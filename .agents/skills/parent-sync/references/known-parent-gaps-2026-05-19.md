# Known Parent Gaps As Of 2026-05-19

This file records the parent-sync findings established during the initial review.

Use commit ids as lookup anchors when reviewing parent history.

## Ported Into This Fork During 2026-05-19 Review

### 1. Restart provider session when effective `cwd` changes

Parent commit:

- `188df6da` `Fix Claude session cwd resume drift`

Why it matters here:

- the fork's `ProviderCommandReactor` computes `effectiveCwd` and uses it for new sessions
- but an existing running session is currently reused unless runtime mode or model semantics change
- that can leave a live provider session pointed at the wrong workspace after a worktree or cwd transition

Local fork indicators:

- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`

Status:

- ported into the fork by adding `cwdChanged` restart handling in `ProviderCommandReactor`

### 2. Increase Codex auth/status probe timeout

Parent commit:

- `6ab8f93a` `fix(codex): use longer and shared auth probe timeout for provider status check`

Why it matters here:

- the fork still uses `DEFAULT_TIMEOUT_MS = 4_000`
- Codex provider status checks use that short timeout for `--version` and `login status`
- short probes create false-negative provider health/auth states

Local fork indicators:

- `apps/server/src/provider/providerSnapshot.ts`
- `apps/server/src/provider/Layers/CodexProvider.ts`

Status:

- ported into the fork by introducing `AUTH_PROBE_TIMEOUT_MS = 10_000` and using it for Codex auth/capability probes

### 3. Add forced child-process kill timeout for `codex app-server`

Parent commit:

- `8fc31793` `Preserve Codex probe results across scoped teardown`

Relevant part for the fork:

- parent added `forceKillAfter: "2 seconds"` when spawning `codex app-server`

Why it matters here:

- the fork still closes the runtime scope directly
- without a forced kill timeout, stuck provider subprocess teardown remains a risk

Local fork indicator:

- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`

Status:

- partially ported into the fork by adding `forceKillAfter: "2 seconds"` to the spawned `codex app-server` process
- parent's broader scoped-teardown reshaping was not ported because the fork runtime structure differs

### 4. Replace temp-file naming with safer atomic writes where still applicable

Parent commit:

- `e25db3a5` `Fix provider cache atomic write temp path collisions`

Why it mattered here:

- the fork still used `process.pid + Date.now()` temp names in:
  - `apps/server/src/serverSettings.ts`
  - `apps/server/src/keybindings.ts`

Status:

- ported into the fork with a shared `apps/server/src/atomicWrite.ts` helper

## Must-Port Or High Priority

### 5. Refresh `packages/effect-codex-app-server` protocol bindings

Parent state observed during review:

- parent `UPSTREAM_REF`: `07b695190f30a450e4921f71f77473e564395c59`

Fork state observed during review:

- fork `UPSTREAM_REF`: `be75785504ff152fa6333e380a2d50642f42fba0`

Why it matters here:

- protocol drift at the Codex app-server boundary is high-risk
- even when generated types compile, stale bindings can mis-map runtime events or request/response shapes

Local fork indicators:

- `packages/effect-codex-app-server/scripts/generate.ts`
- `packages/effect-codex-app-server/src/_generated/*`

## Security Gaps To Review Explicitly

### 6. Parent added a real server auth and pairing model; the fork does not have it

Parent commits:

- `b7559c46` `Implement server auth bootstrap and pairing flow`
- `e3004ae8` `Harden secret store and resolve catalog overrides`
- `4ae9de31` `Stabilize auth session cookies per server mode`
- `e0f3abd1` `Fix remote pairing CORS responses`

Fork risk observed during review:

- `apps/server/src/main.ts` defaults web mode host to `undefined`
- `apps/server/src/wsServer.ts` listens with `{ port }` when host is undefined
- Node listen-without-host typically binds all interfaces, not loopback only
- WebSocket auth is only enforced when `authToken` is explicitly configured

Implication:

- in the current fork, web mode plus no explicit host plus no `authToken` is an exposure case that must be reviewed as a real security gap, not a theoretical one
- parent solved this with a broader auth/pairing architecture, but that is not a safe blind backport

This is a security review item even if it is not handled in the same patch series as runtime sync.

## Already Effectively Present In The Fork

### 7. Fatal Codex stderr mapping

Parent commit:

- `aa5521dc` `Map fatal Codex stderr to runtime errors`

Fork review found equivalent logic already present in:

- `apps/server/src/provider/Layers/CodexAdapter.ts`

### 8. `CODEX_HOME` tilde expansion

Parent commit:

- `aa2d385a` `restore CODEX_HOME tilde expansion`

Fork review found equivalent behavior already present in:

- `apps/server/src/provider/Layers/CodexProvider.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`

### 9. Persisted `cwd` recovery in provider service

Parent commit:

- `188df6da`

Fork review found persisted cwd recovery logic already present in:

- `apps/server/src/provider/Layers/ProviderService.ts`

The missing part is restart-on-cwd-change in the command reactor, not persisted cwd recovery itself.

## Parent Changes That Need Case-By-Case Review

### 10. Harness and VCS performance work

Parent commits include:

- `5165b8c3` `Optimize VCS diff loading to be up to 98% faster`
- `2aa73985` `Refresh local git status on turn completion`

These are useful, but they touch surrounding VCS/runtime architecture and should be evaluated against the fork's current git/orchestration layers before porting.

As of the 2026-05-19 sync, these were not ported. The fork does not currently expose parent's `GitStatusBroadcaster` layer shape, so these are compatibility-review items, not clean cherry-picks.

### 11. Parent auth CORS fixes

Parent `e0f3abd1` matters only if the fork adopts the parent auth HTTP routes. By itself it is not a direct patch candidate for the current fork transport.

## Validation Trap Observed During This Review

### 12. Required typecheck can fail in unrelated web code

Observed during 2026-05-19 validation:

- `bun fmt` passed
- `bun lint` passed
- `bun typecheck` failed in `apps/web/src/components/vx/OrchestrationSidebar.tsx`

Failure shape:

- `programs` entries were missing fields expected by the current sidebar typing, including `metadata`, `baseStatus`, `currentStatus`, and `closeout`

Implication:

- when a parent-sync task touches only server/runtime code, this existing web type failure can still block formal closeout
- record the exact file and error instead of misattributing the failure to the sync patch

## Practical Conclusion

The review that produced this file also found that a dry-run merge from `parent/main` caused very high conflict volume. Treat that as confirmation that:

- the sync path is selective backporting
- the first wins should be correctness and security deltas
- parent architecture changes should be reviewed intentionally, not imported wholesale
