---
name: e2e-test
description: Use when debugging or verifying live user-facing behavior in T3 Code or related vxapp-backed flows, especially blank sidebars, missing threads or projects, broken bootstrap hydration, websocket RPC failures, stale built assets, deploy regressions, or cases where passing unit tests do not prove the real browser outcome. Trigger on Playwright, end-to-end, live route, browser proof, websocket inspection, sidebar blank, bootstrap summary, current state, hydration, deploy verification, or outcome-based troubleshooting.
---

# E2E Test

Use this skill when the success criterion is the real running application, not just unit coverage.

Default mindset:

1. Prove the live failure on the real route first.
2. Trace the exact failing boundary.
3. Patch the smallest authoritative layer that fixes the live path.
4. Re-prove the live outcome.
5. Add only the focused tests that directly guard the proven failure.

Do not lead with synthetic tests when the user is asking whether the actual app works.

## Best Fit

Use this for:

- blank or partially blank sidebar, thread list, project list, or route shell
- websocket RPCs that succeed in tests but fail in the browser
- startup-safe vs strict authority mismatches
- stale `apps/web/dist` or `apps/server/dist/client` bundles
- deploy or restart flows that report misleading failures
- live owner-command verification across `t3code-vxapp`, `agents-vxapp`, and `vortex-scripts`

Prefer other skills for pure route authoring, TanStack Router structure, or isolated React Query wiring unless the user specifically needs live proof.

## Primary Surfaces

In `t3code-vxapp`:

- `apps/web/src/routes/__root.tsx`
- `apps/web/src/store.ts`
- `apps/web/src/components/vx/OrchestrationSidebar.tsx`
- `apps/web/src/components/vx/orchestrationSidebarModel.ts`
- `apps/web/src/wsNativeApi.ts`
- `apps/server/src/wsServer.ts`
- `apps/server/src/orchestration/Layers/ProjectionBootstrapSummaryQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`
- `apps/server/src/extensions/vxapp/**`
- `apps/server/scripts/cli.ts`
- `deploy.sh`

In sibling repos when vxapp authority is involved:

- `/home/gizmo/agents-vxapp/scripts/tools/t3-control-plane-owner`
- `/home/gizmo/agents-vxapp/src/vx_agents/t3/services/**`
- `/home/gizmo/vortex-scripts/Scripts/Controllers/T3Controller.sh`

## Outcome-First Workflow

### 1. Reproduce on the real page

Use Playwright against the actual served route, not only component tests.

Minimal proof pattern:

```bash
bun --cwd apps/web - <<'BUN'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto('http://127.0.0.1:7421/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(8000);
const sidebar = page.locator('[data-testid="vx-orchestration-sidebar"]');
const text = await sidebar.innerText();
console.log(JSON.stringify({
  chars: text.length,
  preview: text.slice(0, 800),
}, null, 2));
await browser.close();
BUN
```

Capture the actual DOM outcome:

- empty text
- empty list container
- partial content
- error banner

Do not infer success from server startup alone.

### 2. Prove whether the browser is requesting the expected data

Intercept websocket traffic inside the page.

Useful pattern:

```bash
bun --cwd apps/web - <<'BUN'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.addInitScript(() => {
  const OriginalWebSocket = window.WebSocket;
  const log = [];
  window.__vxWsLog = log;
  class LoggedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener('message', (event) => {
        log.push({ dir: 'in', raw: String(event.data) });
      });
    }
    send(data) {
      log.push({ dir: 'out', raw: String(data) });
      return super.send(data);
    }
  }
  window.WebSocket = LoggedWebSocket;
});
await page.goto('http://127.0.0.1:7421/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(9000);
const frames = await page.evaluate(() => window.__vxWsLog ?? []);
console.log(JSON.stringify(frames, null, 2));
await browser.close();
BUN
```

Look for:

- `orchestration.getBootstrapSummary`
- `orchestration.getCurrentState`
- `server.getAgentsVxappControlPlaneSnapshot`
- `server.getAgentsVxappSidebarGraph`

Then determine:

- request never sent
- request sent but response is an error
- response is valid but client ignores it

### 3. Check the real server path directly

When browser results are ambiguous, hit the live websocket yourself.

Useful pattern:

```bash
bun - <<'BUN'
const ws = new WebSocket('ws://127.0.0.1:7421/');
const requests = [
  { id: 'bootstrap', body: { _tag: 'orchestration.getBootstrapSummary' } },
  { id: 'state', body: { _tag: 'orchestration.getCurrentState' } },
];
ws.onopen = () => {
  for (const req of requests) ws.send(JSON.stringify(req));
};
ws.onmessage = (event) => console.log(String(event.data));
setTimeout(() => ws.close(), 8000);
BUN
```

Use this to separate:

- server-side route failures
- browser hydration failures
- stale client bundle problems

### 4. Prove owner-side truth when vxapp authority is involved

For startup-safe or strict owner surfaces, run the owner command directly.

Examples:

```bash
/home/gizmo/agents-vxapp/scripts/tools/t3-control-plane-owner t3code-projects-list --json
/home/gizmo/agents-vxapp/scripts/tools/t3-control-plane-owner t3code-external-role-authority-snapshot --json
```

When the live UI depends on owner-backed data:

- do not assume the query layer is correct if the owner command is failing
- do not broaden strict surfaces into startup-safe truth
- do not route strict reads through startup-safe snapshots

### 5. Check whether the app is serving stale assets

In this repo, `apps/server` build copies the existing `apps/web/dist` into `apps/server/dist/client`.

That means server rebuild alone does not guarantee fresh web assets.

Prove the served asset:

```bash
curl -sf http://127.0.0.1:7421/ | rg 'assets/index-'
```

If the source file is fixed but the page still behaves like the old code:

1. rebuild `apps/web`
2. rebuild `apps/server`
3. restart the actual live service
4. rerun the Playwright proof

### 6. Restart the real service carefully

Prefer the actual service manager if available. If systemd restart is blocked in the shell, confirm whether the running process is supervised before killing it.

Always prove the restarted state with:

- `ps -ef | rg 'apps/server/dist/index.mjs'`
- a fresh route load
- a websocket proof call

Do not leave an extra isolated proof server running on a second port unless the user asked for that.

## Triage Ladder

Use this order:

1. Route DOM proof
2. Browser websocket request proof
3. Live websocket response proof
4. Server route/layer inspection
5. Owner command proof
6. Build artifact proof
7. Restart/deploy proof

This avoids wasting time patching tests for the wrong boundary.

## Common Failure Patterns

### Blank sidebar with healthy server startup

Possible causes:

- `getBootstrapSummary` or `getCurrentState` failing
- sidebar model built from a stricter failing query instead of already-hydrated read-model state
- startup-safe owner snapshot throwing hard contradiction
- stale built client assets

### Direct layer tests pass but live browser is blank

Suspect:

- route does not call the layer you tested
- browser request is gated by settings or an `enabled` query condition
- websocket schema/tag mismatch
- old bundle still served

### Strict owner command empty while UI has local rows

Suspect:

- missing live mirror into `agents-vxapp`
- production code wired only to local projection, not strict owner materialization

Do not “fix” this by weakening the strict contract.

### Deploy says restart failed but service is actually up

Check whether:

- readiness polling only saw startup connection refusals
- a post-restart wake step failed and was misreported as restart failure

## Test Strategy After Live Proof

Add only the tests that pin the exact proven break:

- a server/ws test for the real failing RPC
- a web route/bootstrap test for the real hydration path
- a focused owner/service test if the owner command was the failing boundary

Avoid adding indirect tests that only restate already-passing helpers.

## Validation

For repo changes, finish with:

```bash
bun fmt -- --check
bun lint
bun run --filter t3 typecheck
```

If you changed `agents-vxapp`, run the smallest focused validation that covers the touched owner surface and report the exact selected pytest hook if supplemental validation extends the run.

## Footguns

- Do not treat passing unit tests as proof of live behavior.
- Do not skip Playwright or direct websocket proof when the user asked for actual outcome.
- Do not rebuild `apps/server` and assume the browser bundle changed.
- Do not leave background proof services running.
- Do not broaden strict authority surfaces to make the UI look healthy.
- Do not stop at browser proof if the underlying owner command is still broken.
