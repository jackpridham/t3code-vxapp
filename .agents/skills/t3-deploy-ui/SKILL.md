---
name: t3-deploy-ui
description: Use when the user wants to deploy only T3 Code UI or web-client changes, especially phrases like "deploy ui changes", "deploy web changes", "ship frontend", "redeploy the browser UI", or "publish UI-only changes". This skill is specifically for the local `deploy-web.sh` wrapper and the `deploy.sh --ui-only` flow.
---

# T3 Deploy UI

Use this skill when the intent is to deploy browser/UI changes without restarting the live T3 server process.

## Primary Command

Use:

```bash
./deploy-web.sh
```

`deploy-web.sh` is a thin wrapper around:

```bash
./deploy.sh --ui-only
```

The current UI-only deploy flow does this:

1. `bun install`
2. build only the web workspace
3. refresh `apps/server/dist/client`
4. keep the current server process running

## When To Use It

Use this skill for changes that are limited to browser assets or UI behavior, such as:

- React component changes under `apps/web`
- styling and layout changes
- client-only UX fixes
- browser-side copy, rendering, and navigation updates
- chat UI and artifact UI changes that do not require a server restart

## When Not To Use It

Do not use `deploy-web.sh` blindly when the change also affects:

- `apps/server`
- `packages/contracts`
- `packages/shared`
- server-bundled runtime behavior
- any code path that requires a rebuilt or restarted Node server

If the changed files are not clearly UI-only, inspect the diff first. If the deploy needs server code or shared package changes to take effect, use `./deploy.sh` instead of the UI-only wrapper.

## Recommended Workflow

1. Check the changed files and confirm they are UI-only.
2. Read `deploy-web.sh` and `deploy.sh` if the deploy semantics matter for the task.
3. Run:

```bash
./deploy-web.sh
```

4. Report the result clearly, including whether the UI build succeeded and whether any restart was intentionally skipped.

## Validation

Before using this skill for a final deploy, run the repo completion gates unless the user explicitly asks for deploy-only action:

```bash
bun fmt
bun lint
bun typecheck
```

After deployment, if you need deployment status rather than a restart, inspect:

```bash
./deploy.sh --status
```

## Footguns

- `deploy-web.sh` does not restart the live server.
- `deploy-web.sh` is wrong for contracts/server/shared changes that the server must reload.
- Do not assume a successful UI build means backend-affecting changes are live.
- Do not bypass `deploy-web.sh` with ad hoc build commands unless the user explicitly wants a different deploy path.
