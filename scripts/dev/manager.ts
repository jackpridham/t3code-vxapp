#!/usr/bin/env node

import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { resolveTurboExecutable, type DevMode } from "../dev-runner.ts";
import {
  currentBranch,
  clearState,
  clearStaleState,
  ensureStateDir,
  isPidRunning,
  linkedWorktrees,
  logFile,
  type DevServerState,
  workspaceKey,
  writeState,
} from "./runtime-state.ts";
import { resolveRunConfig, waitForModeReadiness } from "./runner-config.ts";

type CommandName = "start" | "stop" | "restart" | "status" | "list" | "logs" | "help";

interface CliOptions {
  command: CommandName;
  mode: DevMode;
  bindHost: string;
  publicHost: string;
  serverPort?: number | undefined;
  webPort?: number | undefined;
  foreground: boolean;
  follow: boolean;
  lines: number;
  json: boolean;
  t3Home?: string | undefined;
  authToken?: string | undefined;
  noBrowser?: boolean | undefined;
  autoBootstrapProjectFromCwd?: boolean | undefined;
  logWebSocketEvents?: boolean | undefined;
}

class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

const projectRoot = resolve(import.meta.dirname, "../..");
const scriptDir = resolve(projectRoot, "scripts/dev");

function usage(): string {
  return `Usage: scripts/dev/dev.sh <command> [options]

Manage the localized T3 development server lifecycle.

Commands:
  start              Start the managed dev server
  stop               Stop the managed dev server
  restart            Restart the managed dev server
  status             Show managed dev server status
  list               Show managed dev servers across linked worktrees
  logs               Show or follow the managed dev log
  help               Show this help

Options:
  --mode MODE        dev | dev:server | dev:web (default: dev)
  --host HOST        Bind host for the server/web processes (default: 0.0.0.0)
  --public-host HOST Public host used in emitted URLs
  --server-port N    Explicit server port
  --web-port N       Explicit web port
  --port N           Alias for --server-port
  --foreground       Run in foreground; valid with start
  --follow, -f       Follow logs; valid with logs
  --lines N          Number of log lines to show (default: 80)
  --json             Machine-readable output
  --home-dir PATH    Override T3CODE_HOME
  --auth-token TOKEN Override T3CODE_AUTH_TOKEN
  --no-browser       Set T3CODE_NO_BROWSER=1
  --auto-bootstrap-project-from-cwd
                    Set T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1
  --log-websocket-events
                    Set T3CODE_LOG_WS_EVENTS=1
  --help, -h         Show this help
`;
}

function resolveDefaultPublicHost(): string {
  const envHost = process.env.VX_PROJECTS_DEV_HOST?.trim();
  if (envHost) {
    return envHost;
  }
  return "127.0.0.1";
}

function parsePort(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new CliError("invalid_arguments", `${flag} must be an integer between 1 and 65535`, 2);
  }
  return parsed;
}

function parseCli(argv: string[]): CliOptions {
  const command = (argv[0] ?? "start") as CommandName;
  if (!["start", "stop", "restart", "status", "list", "logs", "help"].includes(command)) {
    throw new CliError("invalid_arguments", `Unknown command: ${command}`, 2);
  }

  const options: CliOptions = {
    command,
    mode: "dev",
    bindHost: process.env.T3CODE_HOST?.trim() || "0.0.0.0",
    publicHost: resolveDefaultPublicHost(),
    foreground: false,
    follow: false,
    lines: 80,
    json: false,
    t3Home: process.env.T3CODE_HOME?.trim() || resolve(homedir(), ".t3"),
    authToken: process.env.T3CODE_AUTH_TOKEN?.trim() || undefined,
    noBrowser: undefined,
    autoBootstrapProjectFromCwd: undefined,
    logWebSocketEvents: undefined,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = argv[index + 1];
    switch (arg) {
      case "--mode":
        if (!next) throw new CliError("invalid_arguments", "--mode requires a value", 2);
        if (next !== "dev" && next !== "dev:server" && next !== "dev:web") {
          throw new CliError("invalid_arguments", "--mode must be dev, dev:server, or dev:web", 2);
        }
        options.mode = next;
        index += 1;
        break;
      case "--host":
        if (!next) throw new CliError("invalid_arguments", "--host requires a value", 2);
        options.bindHost = next;
        index += 1;
        break;
      case "--public-host":
        if (!next) throw new CliError("invalid_arguments", "--public-host requires a value", 2);
        options.publicHost = next;
        index += 1;
        break;
      case "--server-port":
      case "--port":
        if (!next) throw new CliError("invalid_arguments", `${arg} requires a value`, 2);
        options.serverPort = parsePort(next, arg);
        index += 1;
        break;
      case "--web-port":
        if (!next) throw new CliError("invalid_arguments", "--web-port requires a value", 2);
        options.webPort = parsePort(next, "--web-port");
        index += 1;
        break;
      case "--foreground":
        options.foreground = true;
        break;
      case "--follow":
      case "-f":
        options.follow = true;
        break;
      case "--lines":
        if (!next) throw new CliError("invalid_arguments", "--lines requires a value", 2);
        options.lines = parsePort(next, "--lines");
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--home-dir":
        if (!next) throw new CliError("invalid_arguments", "--home-dir requires a value", 2);
        options.t3Home = next;
        index += 1;
        break;
      case "--auth-token":
        if (!next) throw new CliError("invalid_arguments", "--auth-token requires a value", 2);
        options.authToken = next;
        index += 1;
        break;
      case "--no-browser":
        options.noBrowser = true;
        break;
      case "--auto-bootstrap-project-from-cwd":
        options.autoBootstrapProjectFromCwd = true;
        break;
      case "--log-websocket-events":
      case "--log-ws-events":
        options.logWebSocketEvents = true;
        break;
      case "--help":
      case "-h":
        options.command = "help";
        break;
      default:
        throw new CliError("invalid_arguments", `Unknown option: ${arg}`, 2);
    }
  }

  if (options.command !== "start" && options.foreground) {
    throw new CliError("invalid_arguments", "--foreground is only valid with start", 2);
  }
  if (options.command !== "logs" && options.follow) {
    throw new CliError("invalid_arguments", "--follow is only valid with logs", 2);
  }
  if (options.command === "logs" && options.json && options.follow) {
    throw new CliError("invalid_arguments", "--follow is not valid with --json", 2);
  }

  return options;
}

function statusFromState(state: DevServerState | null): "running" | "stopped" {
  if (!state || !isPidRunning(state.pid)) {
    return "stopped";
  }
  return "running";
}

function statusEnvelope(command: string, state: DevServerState | null) {
  const running = statusFromState(state) === "running";
  return {
    ok: true,
    command,
    workspace: projectRoot,
    workspaceKey: workspaceKey(projectRoot),
    running,
    mode: state?.mode ?? null,
    pid: state?.pid ?? null,
    bindHost: state?.bindHost ?? null,
    publicHost: state?.publicHost ?? null,
    serverPort: state?.serverPort ?? null,
    webPort: state?.webPort ?? null,
    serverUrl: state?.serverUrl ?? null,
    serverHealthUrl: state?.serverHealthUrl ?? null,
    webUrl: state?.webUrl ?? null,
    primaryUrl: state?.primaryUrl ?? null,
    log: state?.log ?? logFile(projectRoot),
    branch: state?.branch ?? currentBranch(projectRoot),
    owner: state?.owner ?? process.env.VX_T3_DEV_OWNER ?? "manual",
    registry: state?.registry ?? ensureStateDir(projectRoot),
  };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeStdout(message: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readLogLines(path: string, lines: number): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(-lines);
}

async function stopManagedProcess(state: DevServerState | null): Promise<boolean> {
  if (!state || !isPidRunning(state.pid)) {
    clearState(projectRoot);
    return false;
  }

  try {
    process.kill(-state.pid, "SIGTERM");
  } catch {
    process.kill(state.pid, "SIGTERM");
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isPidRunning(state.pid)) {
      clearState(projectRoot);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try {
    process.kill(-state.pid, "SIGKILL");
  } catch {
    process.kill(state.pid, "SIGKILL");
  }
  clearState(projectRoot);
  return true;
}

function sameContract(state: DevServerState, options: CliOptions): boolean {
  return (
    state.mode === options.mode &&
    state.bindHost === options.bindHost &&
    state.publicHost === options.publicHost &&
    (options.serverPort === undefined || state.serverPort === options.serverPort) &&
    (options.webPort === undefined || state.webPort === options.webPort)
  );
}

async function startCommand(options: CliOptions): Promise<void> {
  const existing = clearStaleState(projectRoot);
  if (existing && sameContract(existing, options)) {
    const payload = statusEnvelope("start", existing);
    if (options.json) {
      await writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(0);
    }
    await writeStdout(
      `PASS: Dev server is already running\n  url: ${existing.primaryUrl}\n  log: ${existing.log}\n`,
    );
    process.exit(0);
  }

  if (existing) {
    await stopManagedProcess(existing);
  }

  const resolved = await resolveRunConfig({
    mode: options.mode,
    bindHost: options.bindHost,
    publicHost: options.publicHost,
    serverPort: options.serverPort,
    webPort: options.webPort,
    t3Home: options.t3Home,
    authToken: options.authToken,
    noBrowser: options.noBrowser,
    autoBootstrapProjectFromCwd: options.autoBootstrapProjectFromCwd,
    logWebSocketEvents: options.logWebSocketEvents,
  });

  if (options.foreground) {
    process.stdout.write(`==> Starting localized T3 dev server (${resolved.mode}) in foreground\n`);
    const child = spawn(resolveTurboExecutable(), [...resolved.turboArgs], {
      cwd: projectRoot,
      env: resolved.env,
      stdio: "inherit",
      detached: false,
      shell: process.platform === "win32",
    });
    await new Promise<void>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if ((code ?? 0) === 0) {
          resolvePromise();
          return;
        }
        reject(new CliError("execution_failure", `turbo exited with code ${String(code)}`));
      });
    });
    return;
  }

  const logPath = logFile(projectRoot);
  ensureStateDir(projectRoot);
  writeFileSync(logPath, "", "utf8");
  const logFd = openSync(logPath, "a");
  const child = spawn(resolveTurboExecutable(), [...resolved.turboArgs], {
    cwd: projectRoot,
    env: resolved.env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    shell: process.platform === "win32",
  });
  closeSync(logFd);
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", (error) => reject(new CliError("execution_failure", error.message, 1)));
  });
  child.unref();

  const ready = await Promise.race([waitForModeReadiness(resolved), spawnError]);
  if (!ready) {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      process.kill(child.pid!, "SIGTERM");
    }
    throw new CliError(
      "execution_failure",
      `Localized T3 dev server failed readiness checks. See ${logPath}`,
      1,
    );
  }

  const state: DevServerState = {
    schemaVersion: "1.0.0",
    workspace: projectRoot,
    workspaceKey: workspaceKey(projectRoot),
    mode: resolved.mode,
    pid: child.pid!,
    bindHost: resolved.bindHost,
    publicHost: resolved.publicHost,
    serverPort: resolved.serverPort,
    webPort: resolved.webPort,
    serverUrl: resolved.serverUrl,
    serverHealthUrl: resolved.serverHealthUrl,
    webUrl: resolved.webUrl,
    primaryUrl: resolved.mode === "dev:server" ? resolved.serverUrl : resolved.webUrl,
    log: logPath,
    branch: currentBranch(projectRoot),
    owner: process.env.VX_T3_DEV_OWNER ?? "manual",
    startedAt: new Date().toISOString(),
    registry: ensureStateDir(projectRoot),
  };
  writeState(state);

  const payload = statusEnvelope("start", state);
  if (options.json) {
    await writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
  }
  await writeStdout(`PASS: Dev server started\n  url: ${state.primaryUrl}\n  log: ${state.log}\n`);
  process.exit(0);
}

async function stopCommand(options: CliOptions): Promise<void> {
  const stopped = await stopManagedProcess(clearStaleState(projectRoot));
  const payload = {
    ok: true,
    command: "stop",
    workspace: projectRoot,
    workspaceKey: workspaceKey(projectRoot),
    stopped,
    running: false,
    registry: ensureStateDir(projectRoot),
  };
  if (options.json) {
    emitJson(payload);
    return;
  }
  process.stdout.write(
    stopped ? "PASS: Dev server stopped\n" : "PASS: No managed dev server is running\n",
  );
}

async function restartCommand(options: CliOptions): Promise<void> {
  await stopManagedProcess(clearStaleState(projectRoot));
  await startCommand({ ...options, command: "start" });
}

function statusCommand(options: CliOptions): void {
  const state = clearStaleState(projectRoot);
  const payload = statusEnvelope("status", state);
  if (options.json) {
    emitJson(payload);
    return;
  }
  if (!payload.running) {
    process.stderr.write(`FAIL: Dev server is not running\n  log: ${payload.log}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `PASS: Dev server is running\n  url: ${payload.primaryUrl}\n  log: ${payload.log}\n`,
  );
}

function listCommand(options: CliOptions): void {
  const servers = linkedWorktrees(projectRoot).map((workspace) => {
    const state = clearStaleState(workspace);
    return {
      workspace,
      workspaceKey: workspaceKey(workspace),
      running: statusFromState(state) === "running",
      mode: state?.mode ?? null,
      pid: state?.pid ?? null,
      branch: state?.branch ?? currentBranch(workspace),
      primaryUrl: state?.primaryUrl ?? null,
      log: state?.log ?? logFile(workspace),
      owner: state?.owner ?? null,
      registry: state?.registry ?? ensureStateDir(workspace),
    };
  });

  if (options.json) {
    emitJson({ count: servers.length, servers });
    return;
  }

  for (const server of servers) {
    process.stdout.write(
      `${server.workspace}\t${server.branch ?? "(detached)"}\t${server.running ? "running" : "stopped"}\t${server.primaryUrl ?? ""}\n`,
    );
  }
}

async function logsCommand(options: CliOptions): Promise<void> {
  const state = clearStaleState(projectRoot);
  const path = state?.log ?? logFile(projectRoot);
  if (!existsSync(path)) {
    throw new CliError("log_missing", `No log found at ${path}`);
  }
  if (options.json) {
    emitJson({
      ok: true,
      command: "logs",
      workspace: projectRoot,
      workspaceKey: workspaceKey(projectRoot),
      log: path,
      lines: readLogLines(path, options.lines),
    });
    return;
  }
  const content = readLogLines(path, options.lines).join("\n");
  if (content.length > 0) {
    process.stdout.write(`${content}\n`);
  }
  if (!options.follow) {
    return;
  }

  const fs = await import("node:fs");
  let lastSize = fs.statSync(path).size;
  fs.watch(path, { persistent: true }, () => {
    const currentSize = fs.statSync(path).size;
    if (currentSize <= lastSize) {
      lastSize = currentSize;
      return;
    }
    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(currentSize - lastSize);
    fs.readSync(fd, buffer, 0, buffer.length, lastSize);
    fs.closeSync(fd);
    lastSize = currentSize;
    process.stdout.write(buffer.toString("utf8"));
  });
}

async function main(): Promise<void> {
  if (resolve(import.meta.dirname) !== scriptDir) {
    throw new CliError(
      "execution_failure",
      "scripts/dev/manager.ts must run from the checkout that contains scripts/dev",
    );
  }

  const options = parseCli(process.argv.slice(2));
  switch (options.command) {
    case "help":
      process.stdout.write(usage());
      return;
    case "start":
      await startCommand(options);
      return;
    case "stop":
      await stopCommand(options);
      return;
    case "restart":
      await restartCommand(options);
      return;
    case "status":
      statusCommand(options);
      return;
    case "list":
      listCommand(options);
      return;
    case "logs":
      await logsCommand(options);
      return;
  }
}

main().catch((error: unknown) => {
  const cliError =
    error instanceof CliError
      ? error
      : new CliError("execution_failure", error instanceof Error ? error.message : String(error));
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json");
  const command = argv[0] ?? "start";
  if (jsonMode) {
    emitJson({
      ok: false,
      command,
      code: cliError.code,
      message: cliError.message,
    });
  } else {
    process.stderr.write(`FAIL: ${cliError.message}\n`);
  }
  process.exit(cliError.exitCode);
});
