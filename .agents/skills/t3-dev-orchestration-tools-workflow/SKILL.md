---
name: t3-dev-orchestration-tools-workflow
description: Use this whenever adding, changing, debugging, or reviewing T3 Code developer-only orchestration controls, debug menus, manual command launchers, local test helpers, or UI surfaces that intentionally send real orchestration commands for dev/test flows. Trigger on `DevOrchestrationMenu`, dev orchestration menu, debug command UI, local-only orchestration tools, developer controls, manual wake/program notification actions, or requests to expose orchestration test/debug actions in the web app.
---

# T3 Dev Orchestration Tools Workflow

Use this skill for developer-facing orchestration controls in the web app.

This is not the skill for normal product UX. It is for deliberate debug or manual test surfaces that send real orchestration commands and need strong guardrails.

## Primary Files

Web UI:

- `apps/web/src/components/chat/DevOrchestrationMenu.tsx`
- `apps/web/src/components/chat/devOrchestrationMenu.test.ts`
- `apps/web/src/components/ChatView.tsx`

Shared browser state and types:

- `apps/web/src/agentsVxappStore.ts`
- `apps/web/src/lib/agentsVxappStoreBridge.ts`
- `apps/web/src/types.ts`
- `apps/web/src/store.ts`
- `apps/web/src/routes/__root.tsx`

Command transport:

- `apps/web/src/wsNativeApi.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`
- `apps/server/src/wsServer.ts`

## Default Workflow

### 1. Confirm the surface is intentionally dev-only

Before editing, make sure the control is supposed to exist for:

- local/manual testing
- orchestration debugging
- controlled developer workflows

Do not quietly turn a dev-only surface into general product UI.

### 2. Treat the UI as a command builder, not business logic

Keep the menu/control responsible for:

- selecting valid targets
- building explicit command payloads
- showing success/failure feedback

Do not move orchestration rules into the React component when they belong in contracts, server validation, or command invariants.

### 3. Resolve targets from real orchestration state

For dev orchestration controls, target selection usually depends on:

- active thread
- active project
- visible programs
- visible thread lineage

Prefer deriving targets from existing thread/project/program state helpers rather than hand-building ids in event handlers.

For vxapp-backed Program, TODO, notification, attention, wake, or runtime
controls, prefer the centralized `agentsVxappStore` selectors over deprecated
local semantic arrays such as `store.programs`, `programNotifications`,
`ctoAttentionItems`, or `orchestratorWakeItems`.

### 4. Keep real command semantics visible

If a dev tool sends a real orchestration command:

- name the action clearly
- preserve the actual command shape
- make the evidence/debug metadata explicit when useful

Avoid "magic" buttons that obscure which command or ids are being sent.

### 5. Test target resolution separately from UI chrome

The highest-value tests usually cover:

- target resolution
- command construction
- guard behavior when lineage/program context is missing

Keep those tests in logic helpers where possible rather than depending on full component rendering for everything.

### 6. Reuse orchestration workflows instead of bypassing them

If the dev tool exposes a command that already has special workflow rules:

- use `t3-orchestration-command-workflow` for end-to-end command correctness
- use `t3-orchestration-dry-run-workflow` if the tool should preview rather than mutate

Do not create a dev-only shortcut that bypasses the real orchestration contract unless that is explicitly intended.

## Review Checklist

Before finishing a dev orchestration tools change, answer:

1. Is this still clearly dev-only?
2. Does it build a real typed orchestration command rather than ad hoc JSON?
3. Are target ids resolved from real thread/project/program state?
4. Are success/error toasts or feedback accurate?
5. Are there logic tests for target resolution and command construction?

## Tests To Prefer

For dev orchestration menu logic:

```bash
cd apps/web
bun run test src/components/chat/devOrchestrationMenu.test.ts
```

If transport wiring changes too:

```bash
cd apps/web
bun run test src/wsNativeApi.test.ts
```

If the server command path changes:

```bash
cd apps/server
bun run test src/wsServer.test.ts
```

## Footguns

- Do not hide real mutations behind harmless-looking labels.
- Do not duplicate orchestration validation rules in the component.
- Do not invent local target-resolution heuristics when the state model already exposes enough information.
- Do not bypass websocket/native API wiring with component-local fetch logic.
- Do not let dev-only controls leak into normal user workflows unintentionally.

## Companion Skills

- Use `t3-orchestration-command-workflow` when the dev tool introduces or changes a command path.
- Use `t3-orchestration-dry-run-workflow` when the dev tool should exercise non-mutating previews.
- Use `t3-composer-suggestions-workflow` only if the change is actually about composer/menu interaction patterns rather than orchestration command semantics.
