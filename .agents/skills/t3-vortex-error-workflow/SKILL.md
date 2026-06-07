---
name: t3-vortex-error-workflow
description: Use when adding, changing, debugging, reviewing, or displaying vxapp/vortex error handling in T3 Code, especially owner-backed `agents-vxapp` authority failures, websocket RPC error payloads, centralized error enums, sanitized error banners, runtime authority failures, or requests to replace raw stack traces and file paths with stable error codes like `Error 69`. Trigger on vortex error, agents-vxapp error, owner data unavailable, sidebar authority error, error code, centralized error handler, websocket error payload, runtime authority unavailable, wrong role workspace, or graceful error handling for vxapp-backed UI.
---

# T3 Vortex Error Workflow

Use this skill when the task is about how T3 surfaces vxapp or vortex failures.

The goal is:

- stable error codes
- short user-facing summaries
- no raw stack traces or local file paths in normal UI
- one shared mapping from owner/runtime failures to T3 display errors

## Primary Files

Contracts:

- `packages/contracts/src/agentsVxappAuthority.ts`
- `packages/contracts/src/ws.ts`

Shared runtime mapping:

- `packages/shared/src/vortexErrors.ts`

Server:

- `apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts`
- `apps/server/src/extensions/vxapp/Services/AgentsVxappSidebar.ts`
- `apps/server/src/extensions/vxapp/Services/AgentsVxappControlPlane.ts`
- `apps/server/src/extensions/vxapp/vortexErrorResponse.ts`
- `apps/server/src/wsServer.ts`

Web:

- `apps/web/src/wsTransport.ts`
- `apps/web/src/lib/agentsVxappStoreBridge.ts`
- `apps/web/src/agentsVxappStore.ts`
- `apps/web/src/components/vx/VortexErrorBanner.tsx`
- owner-backed consumers under `apps/web/src/components/vx/**`

## Default Workflow

### 1. Start from the centralized error code catalog

Do not invent component-local strings for vxapp owner failures.

Add or update codes in:

- `packages/contracts/src/agentsVxappAuthority.ts`

Then keep the display mapping centralized in:

- `packages/shared/src/vortexErrors.ts`

### 2. Preserve structure across the websocket boundary

If the server already knows the failure is a vxapp/vortex owner failure:

- send a structured websocket error payload
- include stable `code`
- include short `title`
- include sanitized `message`
- include `ownerErrorCode` when it helps agents-vxapp debugging

Do not send `Cause.pretty(...)` or raw stacks to normal UI surfaces.

### 3. Sanitize before rendering

Normal VX UI should not display:

- local file paths
- `file:///...`
- `node:internal/...`
- long `at ...` stack suffixes

Keep raw detail only for explicit debug surfaces if needed.

### 4. Keep owner authority errors distinct

Differentiate:

- owner transport failure
- owner decode failure
- missing required owner field
- owner contract or surface failure
- runtime authority unavailable
- role/workspace binding mismatch

If a failure deserves a new code, add it centrally instead of using a component-local string.

### 5. Reuse the shared presenter

For owner-backed VX screens:

- prefer a shared error presenter like `VortexErrorBanner`
- do not duplicate ad hoc “Owner data unavailable” blocks in many components

## Footguns

- Do not leak stack traces into websocket `error.message`.
- Do not make the browser infer codes from raw stack text when the server can classify the failure.
- Do not patch owner failures by falling back to stale sidebar graph or browser-store state.
- Do not create multiple code catalogs in server and web.

## Validation

At minimum:

```bash
bun fmt
bun lint
bun typecheck
```

For live proof, use the `e2e-test` skill and verify the rendered VX banner shows:

- a stable `Error <code>`
- a short title
- a sanitized message
- no raw local file paths or stack traces
