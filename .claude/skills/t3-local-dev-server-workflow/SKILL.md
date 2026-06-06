---
name: t3-local-dev-server-workflow
description: Use when starting, stopping, restarting, inspecting, or documenting the repo-local T3 Code development server, especially `scripts/dev/dev.sh`, localized dev lifecycle commands, JSON status/log payloads, workspace-scoped runtime state, automatic port selection, root `bun run dev*` scripts, or debugging why local dev startup did not come up on the expected port. Trigger on dev server, local dev server, scripts/dev/dev.sh, start dev, stop dev, restart dev, status --json, list --json, logs --json, dev:web, dev:server, or package.json dev scripts.
---

# T3 Local Dev Server Workflow

Use this skill whenever the task is about the authoritative repo-local T3 dev
server surface.

The public owner is:

```bash
bash scripts/dev/dev.sh <command>
```

Do not treat `vx apps t3 dev-server` as the owner surface in this repo.
Do not treat `scripts/dev-runner.ts` as the public entrypoint; it is reused as
lower-level env/port logic behind the localized manager.

## Public Commands

Supported commands:

```text
start
stop
restart
status
list
logs
help
```

Shared flags:

- `--json`
- `--mode dev|dev:server|dev:web`
- `--host`
- `--public-host`
- `--server-port`
- `--web-port`
- `--port` as alias for `--server-port`

Logs-only flags:

- `--lines`
- `--follow`

Start-only flag:

- `--foreground`

## Modes

- `dev`: starts both server and web
- `dev:server`: starts server only
- `dev:web`: starts web only

Root package scripts route through this surface:

```bash
bun run dev
bun run dev:server
bun run dev:web
```

These are foreground workflows. Use `scripts/dev/dev.sh ... --json` when a task
needs machine-readable lifecycle state.

## JSON Contract

For `status --json` and `start --json`, expect fields such as:

- `running`
- `mode`
- `serverPort`
- `webPort`
- `serverUrl`
- `serverHealthUrl`
- `webUrl`
- `primaryUrl`
- `log`
- `workspace`
- `workspaceKey`
- `registry`

T3 status payloads intentionally expose both the web URL and the server/WS URL.

`list --json` returns:

- `count`
- `servers[]`

Each server row is workspace-scoped and reports whether that worktree is
running.

`logs --json` returns log metadata plus the requested trailing lines.

## Runtime State Model

Runtime process state is ephemeral and workspace-scoped.

- Live config stays in `.vx/dev-state.yaml`
- Live runtime state does not live in the repo
- The manager writes tmp state under:

```text
/tmp/t3code-vxapp-dev-server/<workspaceKey>/
```

Typical files there:

- `server.json`
- `server.log`

Use `status --json` or `list --json` instead of reading tmp state directly
unless the task is explicitly about the manager internals.

## Port Selection

Default bases are:

- server: `3773`
- web: `5733`

Do not assume those exact ports are free. The localized manager probes for the
next available port and now checks both IPv4 and IPv6 loopback occupancy.

If another process already owns `5733`, `dev:web` or `dev` may come up on
`5734`, `5735`, and so on. Always discover the live URL from:

```bash
bash scripts/dev/dev.sh status --json
```

or from the foreground `bun run dev*` output.

## Repo-Link And Startup Environment

The localized manager resolves required repo-link env for `agents-vxapp`
startup from `.vx/repo-links.yaml`.

It will:

- honor configured env aliases when they agree
- validate required owner entrypoints
- fall back to the sibling `../agents-vxapp` checkout for local-dev startup

Do not hard-code `~/agents-vxapp` inside feature work. If local startup fails,
check the repo-link/env contract first.

## Normal Workflows

Start the managed server in the background with JSON output:

```bash
bash scripts/dev/dev.sh start --json --mode dev
```

Inspect the current workspace:

```bash
bash scripts/dev/dev.sh status --json
```

Inspect all linked worktrees:

```bash
bash scripts/dev/dev.sh list --json
```

Get recent logs:

```bash
bash scripts/dev/dev.sh logs --json --lines 40
```

Restart after contracts or server wiring changes:

```bash
bash scripts/dev/dev.sh restart --json --mode dev
```

Stop the managed server:

```bash
bash scripts/dev/dev.sh stop --json
```

## When To Restart

Restart the localized dev server when:

- contracts changes must be rebuilt into server or web runtime
- server startup env or repo-link behavior changed
- port/runtime state looks stale
- the task explicitly needs a clean startup proof

For pure browser route/layout work, a foreground `bun run dev:web` or
`bun run dev` flow may already be enough.

## Validation

At minimum for localized dev-server work:

```bash
cd scripts
bun run test
bun run typecheck
```

Then verify the repo-local lifecycle in the repo root:

```bash
bash scripts/dev/dev.sh start --json --mode dev:server
bash scripts/dev/dev.sh status --json
bash scripts/dev/dev.sh list --json
bash scripts/dev/dev.sh logs --json --lines 20
bash scripts/dev/dev.sh stop --json
```

For final repo completion:

```bash
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test`.

## Footguns

- Do not use `vx apps t3 dev-server` as the owner contract here.
- Do not assume the web URL is always `http://127.0.0.1:5733/`.
- Do not use `scripts/dev-runner.ts` as the public command surface.
- Do not treat `.vx/dev-state.yaml` as live runtime state.
- Do not scrape logs for URLs before checking `status --json`.
- Do not forget that `list --json` is cross-worktree and `status --json` is
  current-workspace only.
- Do not report startup broken just because `5733` is occupied; verify which
  port the manager selected.
