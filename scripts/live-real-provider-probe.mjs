#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import { access, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function resolveAgentsRootFromRepoLinks() {
  const repoLinksRaw = await readFile(resolve(repoRoot, ".vx/repo-links.yaml"), "utf8");
  const aliases = [...repoLinksRaw.matchAll(/^\s{6}-\s+([A-Z0-9_]+)\s*$/gm)].map(
    (match) => match[1],
  );
  const configured = aliases
    .map((alias) => ({ alias, root: process.env[alias]?.trim() }))
    .filter((entry) => entry.root);
  if (configured.length === 0) {
    throw new Error(
      `agents-vxapp repo root is not configured. Set one of ${aliases.join(", ")} from .vx/repo-links.yaml.`,
    );
  }
  const roots = new Set(configured.map((entry) => resolve(entry.root)));
  if (roots.size !== 1) {
    throw new Error(
      `agents-vxapp repo-root env aliases disagree: ${configured
        .map((entry) => `${entry.alias}=${entry.root}`)
        .join(", ")}`,
    );
  }
  return [...roots][0];
}

const agentsRoot = await resolveAgentsRootFromRepoLinks();
const outDir = resolve(
  process.env.T3CODE_REAL_PROVIDER_PROBE_OUT_DIR ??
    resolve(repoRoot, ".vx/live-probes/t3code-real-provider-live"),
);
const t3Home = resolve(outDir, "t3-home");
const t3UserData = resolve(t3Home, "userdata");
const proofKind = "real-provider";
const provider = "codex";
const model = process.env.T3CODE_REAL_PROVIDER_MODEL ?? "gpt-5.3-codex";
const promptText =
  process.env.T3CODE_REAL_PROVIDER_PROMPT ??
  "Reply with one short sentence confirming the live T3Code real-provider probe completed. Do not edit files or run tools.";
const lifecycleTimeoutMs = Math.min(
  Number.parseInt(process.env.T3CODE_REAL_PROVIDER_TIMEOUT_MS ?? "180000", 10),
  180_000,
);
const serverRequire = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { WebSocket } = serverRequire("ws");

function nowIso() {
  return new Date().toISOString();
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function blocker(code, message, detail, hint, phase, retryable = true) {
  return { code, message, detail, hint, phase, retryable };
}

function proofMetadata(realProvider) {
  return { proof_kind: proofKind, real_provider: realProvider };
}

function proofKindMetadata() {
  return { proof_kind: proofKind };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSummary(status, block, extra = {}) {
  const summary = {
    ok: status === "passed",
    status,
    ...proofMetadata(status === "passed"),
    ...(block ? { blocker: block } : {}),
    ...extra,
    finishedAt: nowIso(),
  };
  await writeJson(resolve(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function findFreePort() {
  const server = http.createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to allocate probe TCP port");
  }
  return address.port;
}

async function waitFor(predicate, label, timeoutMs = 45_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function runCommandCapture(command, args, options = {}) {
  const startedAt = nowIso();
  const started = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolveRun({
        command,
        args,
        exitCode: null,
        signal: null,
        error: error.message,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - started,
      });
    });
    child.on("exit", (exitCode, signal) => {
      resolveRun({
        command,
        args,
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - started,
      });
    });
  });
}

async function executable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveOnPath(command) {
  if (command.includes("/") || isAbsolute(command)) {
    return command;
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const candidate = resolve(dir, command);
    if (await executable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function fakePathReason(configuredBinaryPath, resolvedBinaryPath, realBinaryPath) {
  const retiredEvidenceRootFragment = ["orchestration", "platform", "migration"].join("-");
  const disallowedFragments = [
    "/plans/evidence/",
    `/${retiredEvidenceRootFragment}/`,
    "/fixtures/",
    "/mock",
    "/fake",
    "/shim",
    "/tmp/",
  ];
  if (basename(resolvedBinaryPath) !== "codex") {
    return `resolved binary basename is not codex: ${basename(resolvedBinaryPath)}`;
  }
  if (basename(realBinaryPath) !== "codex" && basename(realBinaryPath) !== "codex.js") {
    return `real binary basename is not codex or codex.js: ${basename(realBinaryPath)}`;
  }
  for (const candidate of [configuredBinaryPath, resolvedBinaryPath, realBinaryPath]) {
    const lower = String(candidate).toLowerCase();
    const matched = disallowedFragments.find((fragment) => lower.includes(fragment));
    if (matched) {
      return `binary path '${candidate}' matches forbidden fake/shim fragment '${matched}'`;
    }
  }
  return null;
}

function fakeVersionReason(output) {
  const lower = output.toLowerCase();
  for (const marker of ["99.0.0", "fake", "mock", "shim"]) {
    if (lower.includes(marker)) {
      return `version output contains fake-provider marker '${marker}'`;
    }
  }
  return null;
}

function authUnavailableReason(result) {
  const lower = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (result.exitCode !== 0) {
    return `codex login status exited ${result.exitCode}`;
  }
  if (
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("authentication required") ||
    lower.includes("run `codex login`") ||
    lower.includes("run codex login")
  ) {
    return "codex login status reports unauthenticated";
  }
  if (result.stdout.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(result.stdout);
      const auth = parsed.authenticated ?? parsed.auth ?? parsed.account?.authenticated;
      if (auth === false) {
        return "codex login status JSON reports unauthenticated";
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function loadOwnerAuthorityStatus() {
  const vxPath = resolve(agentsRoot, "scripts/tools/vx");
  const result = await runCommandCapture(vxPath, ["t3", "cto", "status", "--json"], {
    cwd: agentsRoot,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `failed to load active CTO status from ${vxPath}: ${result.stderr || result.stdout}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`failed to parse active CTO status JSON: ${error.message}`, { cause: error });
  }
  const payload = parsed?.result?.payload;
  const activeProgram = payload?.activeProgram ?? null;
  const cto = payload?.cto ?? null;
  const jasper = payload?.jasper ?? null;
  const activeProgramId = activeProgram?.id ?? activeProgram?.programId ?? null;
  const ctoThreadId =
    cto?.currentThreadId ?? cto?.currentThread?.id ?? activeProgram?.executiveThreadId ?? null;
  const jasperThreadId =
    jasper?.currentThreadId ??
    jasper?.currentThread?.id ??
    activeProgram?.currentOrchestratorThreadId ??
    null;
  if (!activeProgramId || !ctoThreadId || !jasperThreadId) {
    throw new Error(
      "active CTO status is missing active Program, CTO thread, or Jasper thread authority",
    );
  }
  return {
    raw: parsed,
    activeProgramId,
    activeProgramTitle: activeProgram?.title ?? null,
    ctoThreadId,
    ctoWorkspaceRoot: cto?.workspaceRoot ?? cto?.currentThread?.workspaceRoot ?? null,
    jasperThreadId,
    jasperWorkspaceRoot: jasper?.workspaceRoot ?? jasper?.currentThread?.workspaceRoot ?? null,
    legacyFallbackUsed:
      payload?.legacyFallbackUsed === true ||
      cto?.legacyFallbackUsed === true ||
      jasper?.legacyFallbackUsed === true,
  };
}

async function preflight() {
  const configuredBinary =
    process.env.T3CODE_REAL_PROVIDER_CODEX_BINARY ?? process.env.CODEX_BINARY_PATH ?? "codex";
  const sourceEnvKey = process.env.T3CODE_REAL_PROVIDER_CODEX_BINARY
    ? "T3CODE_REAL_PROVIDER_CODEX_BINARY"
    : process.env.CODEX_BINARY_PATH
      ? "CODEX_BINARY_PATH"
      : "PATH";
  const resolvedBinary = await resolveOnPath(configuredBinary);
  if (!resolvedBinary) {
    return {
      ok: false,
      result: {
        configuredBinary,
        sourceEnvKey,
        resolvedBinary: null,
      },
      blocker: blocker(
        "codex_cli_missing",
        "Codex CLI is not available.",
        `Could not resolve '${configuredBinary}' to an executable.`,
        "Install Codex CLI or set T3CODE_REAL_PROVIDER_CODEX_BINARY, then run codex login.",
        "preflight",
      ),
    };
  }

  const realBinaryPath = await realpath(resolvedBinary);
  const pathReason = fakePathReason(configuredBinary, resolvedBinary, realBinaryPath);
  if (pathReason) {
    return {
      ok: false,
      result: { configuredBinary, sourceEnvKey, resolvedBinary, realpath: realBinaryPath },
      blocker: blocker(
        "codex_binary_not_real",
        "Resolved Codex binary is not accepted as real-provider proof.",
        pathReason,
        "Use an installed Codex CLI outside evidence, temp shim, fixture, fake, and mock paths.",
        "preflight",
        false,
      ),
    };
  }

  const codexHome =
    process.env.T3CODE_REAL_PROVIDER_CODEX_HOME ?? process.env.CODEX_HOME ?? undefined;
  const env = { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}) };
  const version = await runCommandCapture(realBinaryPath, ["--version"], { env });
  const versionReason = fakeVersionReason(`${version.stdout}\n${version.stderr}`);
  if (version.exitCode !== 0) {
    return {
      ok: false,
      result: { configuredBinary, sourceEnvKey, resolvedBinary, realpath: realBinaryPath, version },
      blocker: blocker(
        "codex_version_failed",
        "Codex CLI version check failed.",
        `codex --version exited ${version.exitCode ?? "without exit code"}.`,
        "Verify the Codex CLI installation, then rerun the real-provider probe.",
        "preflight",
      ),
    };
  }
  if (versionReason) {
    return {
      ok: false,
      result: { configuredBinary, sourceEnvKey, resolvedBinary, realpath: realBinaryPath, version },
      blocker: blocker(
        "codex_binary_not_real",
        "Codex CLI version output indicates a fake or shim binary.",
        versionReason,
        "Use the real authenticated Codex CLI.",
        "preflight",
        false,
      ),
    };
  }

  const login = await runCommandCapture(realBinaryPath, ["login", "status"], { env });
  const authReason = authUnavailableReason(login);
  const configPath = resolve(codexHome ?? resolve(process.env.HOME ?? "", ".codex"), "config.toml");
  const accepted = {
    configuredBinary,
    sourceEnvKey,
    resolvedBinary,
    realpath: realBinaryPath,
    codexHome: codexHome ?? null,
    codexConfigPath: configPath,
    version,
    login,
  };
  if (authReason) {
    return {
      ok: false,
      result: accepted,
      blocker: blocker(
        "codex_auth_unavailable",
        "Codex CLI authentication is unavailable.",
        authReason,
        "Run codex login, then rerun bun run scripts/live-real-provider-probe.mjs from the t3code-vxapp repo root.",
        "preflight",
      ),
    };
  }
  return { ok: true, result: accepted };
}

function wsRequest(ws, method, body = {}, timeoutMs = 45_000) {
  const id = `real-provider-${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = JSON.stringify({ id, body: { _tag: method, ...body } });
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      rejectRequest(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "push") return;
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      if (message.error) {
        rejectRequest(Object.assign(new Error(message.error.message), { response: message }));
        return;
      }
      resolveRequest(message.result);
    };
    ws.on("message", onMessage);
    ws.send(payload);
  });
}

function waitForPush(ws, channel, predicate, timeoutMs = 45_000) {
  return new Promise((resolvePush, rejectPush) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      rejectPush(new Error(`Timed out waiting for push ${channel}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type !== "push" || message.channel !== channel) return;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolvePush(message);
    };
    ws.on("message", onMessage);
  });
}

async function connectWs(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.once("open", resolveOpen);
    ws.once("error", rejectOpen);
  });
  await waitForPush(ws, "server.welcome", () => true, 10_000);
  return ws;
}

function collectPushes(ws, sink) {
  const onMessage = (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type !== "push") return;
    sink.push({ channel: message.channel, data: message.data, receivedAt: nowIso() });
  };
  ws.on("message", onMessage);
  return () => ws.off("message", onMessage);
}

function spawnProcess(command, args, options) {
  const child = spawn(command, args, options);
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  return { child, stdout, stderr, startedAt: nowIso() };
}

async function stopProcess(server) {
  const cleanup = {
    attempted: true,
    startedAt: nowIso(),
    serverExit: null,
    killed: false,
    errors: [],
  };
  try {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      cleanup.serverExit = { exitCode: server.child.exitCode, signalCode: server.child.signalCode };
      return cleanup;
    }
    server.child.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise((resolveExit) => server.child.once("exit", resolveExit)),
      wait(5_000).then(() => "timeout"),
    ]);
    if (exited === "timeout") {
      cleanup.killed = true;
      server.child.kill("SIGKILL");
      await new Promise((resolveExit) => server.child.once("exit", resolveExit));
    }
    cleanup.serverExit = { exitCode: server.child.exitCode, signalCode: server.child.signalCode };
  } catch (error) {
    cleanup.errors.push(error.message);
  } finally {
    cleanup.finishedAt = nowIso();
  }
  return cleanup;
}

async function writeServerLogs(server) {
  const stdout = Buffer.concat(server.stdout).toString("utf8");
  const stderr = Buffer.concat(server.stderr).toString("utf8");
  await writeFile(resolve(outDir, "server.stdout"), stdout);
  await writeFile(resolve(outDir, "server.stderr"), stderr);
  return { stdout, stderr };
}

function providerRuntimeError(event) {
  const payload = event?.data?.payload;
  if (!payload) return null;
  if (payload.hasActiveError || payload.activeError || payload.historicalError) {
    return payload.activeError ?? payload.historicalError ?? payload;
  }
  const session = payload.session;
  if (session?.lastError) return session.lastError;
  return null;
}

function eventCommandText(event) {
  return `${event?.data?.commandId ?? ""} ${event?.data?.correlationId ?? ""}`;
}

function isAssistantStreamingEvent(push, threadId) {
  const payload = push.data?.payload;
  const commandText = eventCommandText(push);
  return (
    push.data?.type === "thread.message-sent" &&
    payload?.threadId === threadId &&
    payload?.role === "assistant" &&
    payload?.streaming === true &&
    typeof payload?.turnId === "string" &&
    String(payload?.text ?? "").trim().length > 0 &&
    (commandText.includes("assistant-delta") || commandText.includes("assistant-delta-finalize"))
  );
}

function isAssistantFinalEvent(push, threadId, messageId) {
  const payload = push.data?.payload;
  const commandText = eventCommandText(push);
  return (
    push.data?.type === "thread.message-sent" &&
    payload?.threadId === threadId &&
    payload?.messageId === messageId &&
    payload?.role === "assistant" &&
    payload?.streaming === false &&
    commandText.includes("assistant-complete")
  );
}

function serverLogViolation(stdout, stderr) {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  const forbidden = [
    "OwnerCommandFailure",
    "failed to process input",
    "Traceback",
    "auth failure",
    "authentication failed",
    "provider failure",
    "runtime failure",
  ];
  for (const line of lines) {
    if (!line.trim()) continue;
    const lower = line.toLowerCase();
    const marker = forbidden.find((entry) => lower.includes(entry.toLowerCase()));
    if (marker) {
      return `server log contains '${marker}': ${line}`;
    }
    if (/\bWARN\b/.test(line) || /\bERROR\b/.test(line)) {
      return `server log contains unclassified warning/error: ${line}`;
    }
  }
  return null;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    rm(resolve(outDir, "summary.json"), { force: true }),
    rm(resolve(outDir, "run-metadata.json"), { force: true }),
    rm(resolve(outDir, "preflight.json"), { force: true }),
    rm(resolve(outDir, "lifecycle.json"), { force: true }),
    rm(resolve(outDir, "cleanup.json"), { force: true }),
    rm(resolve(outDir, "server.stdout"), { force: true }),
    rm(resolve(outDir, "server.stderr"), { force: true }),
    rm(resolve(outDir, "observed-pushes.json"), { force: true }),
    rm(resolve(outDir, "server-config.json"), { force: true }),
  ]);
  await rm(t3Home, { recursive: true, force: true });
  await mkdir(t3UserData, { recursive: true });
  const ownerAuthority = await loadOwnerAuthorityStatus();
  await writeJson(resolve(outDir, "owner-cto-status.json"), ownerAuthority.raw);

  const preflightResult = await preflight();
  await writeJson(resolve(outDir, "preflight.json"), {
    ok: preflightResult.ok,
    ...proofKindMetadata(),
    acceptedRealProviderCandidate: preflightResult.ok,
    checkedAt: nowIso(),
    ...preflightResult.result,
    ...(preflightResult.blocker ? { blocker: preflightResult.blocker } : {}),
  });
  if (!preflightResult.ok) {
    await writeJson(resolve(outDir, "run-metadata.json"), {
      ...proofKindMetadata(),
      acceptedRealProviderCandidate: false,
      startedAt: nowIso(),
      outDir,
      t3Home,
      activeProgramId: ownerAuthority.activeProgramId,
      ctoThreadId: ownerAuthority.ctoThreadId,
      jasperThreadId: ownerAuthority.jasperThreadId,
      status: "blocked",
    });
    await writeJson(resolve(outDir, "lifecycle.json"), { events: [] });
    await writeJson(resolve(outDir, "cleanup.json"), {
      attempted: false,
      reason: "preflight_blocked",
    });
    await writeSummary("blocked", preflightResult.blocker, { preflight: preflightResult.result });
    return;
  }

  const acceptedBinary = preflightResult.result.realpath;
  const codexHome = preflightResult.result.codexHome;
  await writeJson(resolve(t3UserData, "settings.json"), {
    enableAssistantStreaming: true,
    providers: {
      codex: {
        binaryPath: acceptedBinary,
        ...(codexHome ? { homePath: codexHome } : {}),
      },
    },
  });

  const port = await findFreePort();
  const env = {
    ...process.env,
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
    T3CODE_HOME: t3Home,
    T3CODE_HOST: "127.0.0.1",
    T3CODE_LOG_WS_EVENTS: "1",
    T3CODE_NO_BROWSER: "1",
    T3CODE_PORT: String(port),
    VX_AGENTS_OWNER_REVISION: "t3code-real-provider-live-proof",
    VX_AGENTS_REPO_ROOT: agentsRoot,
  };
  const metadata = {
    ...proofKindMetadata(),
    acceptedRealProviderCandidate: true,
    startedAt: nowIso(),
    port,
    outDir,
    t3Home,
    codexBinary: acceptedBinary,
    codexHome: codexHome ?? null,
    activeProgramId: ownerAuthority.activeProgramId,
    ctoThreadId: ownerAuthority.ctoThreadId,
    jasperThreadId: ownerAuthority.jasperThreadId,
    model,
    prompt: promptText,
  };
  await writeJson(resolve(outDir, "run-metadata.json"), metadata);

  const server = spawnProcess(
    "bun",
    [
      "run",
      "apps/server/src/index.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-browser",
    ],
    { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let ws = null;
  let stopCollectingPushes = null;
  const observedPushes = [];
  const lifecycle = { events: [], assertions: [], startedAt: nowIso() };
  let cleanup = { attempted: false };

  const failWith = async (
    status,
    code,
    message,
    detail,
    hint,
    phase,
    retryable = true,
    extra = {},
  ) => {
    const block = blocker(code, message, detail, hint, phase, retryable);
    await writeJson(resolve(outDir, "lifecycle.json"), lifecycle);
    cleanup = await stopProcess(server);
    await writeJson(resolve(outDir, "cleanup.json"), cleanup);
    await writeJson(resolve(outDir, "observed-pushes.json"), observedPushes);
    await writeServerLogs(server);
    await writeSummary(status, block, {
      preflight: preflightResult.result,
      cleanup,
      lifecycle,
      ...extra,
    });
  };

  try {
    server.child.once("exit", (exitCode, signalCode) => {
      lifecycle.events.push({
        type: "server.process-exit",
        exitCode,
        signalCode,
        receivedAt: nowIso(),
      });
    });

    await waitFor(
      async () => {
        if (server.child.exitCode !== null || server.child.signalCode !== null) {
          throw new Error(`server exited ${server.child.exitCode ?? server.child.signalCode}`);
        }
        const response = await fetch(`http://127.0.0.1:${port}/health/live`).catch(() => null);
        return response?.status === 200;
      },
      "T3 server live health",
      45_000,
    ).catch((error) =>
      Promise.reject(
        Object.assign(error, {
          proofCode:
            server.child.exitCode !== null || server.child.signalCode !== null
              ? "provider_startup_failed"
              : "server_live_timeout",
        }),
      ),
    );

    await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${port}/health/ready`).catch(() => null);
        return response?.status === 200;
      },
      "T3 server ready health",
      60_000,
    ).catch((error) => Promise.reject(Object.assign(error, { proofCode: "server_ready_timeout" })));

    ws = await connectWs(port).catch((error) =>
      Promise.reject(Object.assign(error, { proofCode: "websocket_ready_timeout" })),
    );
    stopCollectingPushes = collectPushes(ws, observedPushes);
    const config = await wsRequest(ws, "server.getConfig");
    await writeJson(resolve(outDir, "server-config.json"), config);
    const codexProvider = Array.isArray(config.providers)
      ? config.providers.find((row) => row.provider === "codex")
      : null;
    const serverSettings = JSON.parse(await readFile(resolve(t3UserData, "settings.json"), "utf8"));
    const serverSettingsBinary = serverSettings?.providers?.codex?.binaryPath ?? null;
    if (serverSettingsBinary !== acceptedBinary) {
      await failWith(
        "failed",
        "server_config_binary_mismatch",
        "T3Code server settings do not contain the accepted Codex binary.",
        `accepted=${acceptedBinary} settings=${serverSettingsBinary}`,
        "Inspect T3CODE_HOME/userdata/settings.json and rerun the real-provider probe.",
        "server_config",
        true,
        { serverConfig: config, serverSettings },
      );
      return;
    }
    if (codexProvider?.status !== "ready" || codexProvider?.auth?.status !== "authenticated") {
      await failWith(
        "blocked",
        "provider_not_ready",
        "T3Code Codex provider is not ready and authenticated.",
        JSON.stringify(codexProvider ?? null),
        "Run codex login and verify server.getConfig reports the Codex provider ready.",
        "provider_preflight",
        true,
        { serverConfig: config },
      );
      return;
    }

    const createdAt = nowIso();
    const projectId = "project-real-provider-live-probe";
    const threadId = "thread-real-provider-live-probe";
    const projectRoot = resolve(outDir, "provider-project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(resolve(projectRoot, "README.md"), "# real provider probe\n");

    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "project.create",
        commandId: "cmd-real-provider-project",
        projectId,
        title: "Real Provider Probe",
        workspaceRoot: projectRoot,
        defaultModelSelection: { provider, model },
        createdAt,
      },
    }).catch((error) => Promise.reject(Object.assign(error, { proofCode: "dispatch_failed" })));
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.create",
        commandId: "cmd-real-provider-thread",
        threadId,
        projectId,
        title: "Real provider thread",
        modelSelection: { provider, model },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      },
    }).catch((error) => Promise.reject(Object.assign(error, { proofCode: "dispatch_failed" })));

    let turnsStarted = 0;
    const runningPromise = waitForPush(
      ws,
      "orchestration.domainEvent",
      (push) =>
        push.data?.type === "thread.session-set" &&
        push.data?.payload?.threadId === threadId &&
        push.data?.payload?.session?.status === "running",
      lifecycleTimeoutMs,
    );
    const assistantStreamPromise = waitForPush(
      ws,
      "orchestration.domainEvent",
      (push) => isAssistantStreamingEvent(push, threadId),
      lifecycleTimeoutMs,
    );

    turnsStarted += 1;
    if (turnsStarted !== 1) {
      throw Object.assign(new Error("probe attempted more than one turn"), {
        proofCode: "dispatch_failed",
      });
    }
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.turn.start",
        commandId: "cmd-real-provider-turn",
        threadId,
        message: {
          messageId: "msg-real-provider-turn",
          role: "user",
          text: promptText,
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: nowIso(),
      },
    }).catch((error) => Promise.reject(Object.assign(error, { proofCode: "dispatch_failed" })));

    const running = await runningPromise.catch((error) =>
      Promise.reject(Object.assign(error, { proofCode: "assistant_stream_timeout" })),
    );
    lifecycle.events.push({
      assertion: "session-running",
      receivedAt: nowIso(),
      event: running.data,
    });
    const assistantStream = await assistantStreamPromise.catch((error) =>
      Promise.reject(Object.assign(error, { proofCode: "assistant_stream_timeout" })),
    );
    lifecycle.events.push({
      assertion: "assistant-streaming-message",
      receivedAt: nowIso(),
      event: assistantStream.data,
    });
    const assistantMessageId = assistantStream.data?.payload?.messageId ?? null;
    const assistantFinal = await waitForPush(
      ws,
      "orchestration.domainEvent",
      (push) => isAssistantFinalEvent(push, threadId, assistantMessageId),
      lifecycleTimeoutMs,
    ).catch((error) =>
      Promise.reject(Object.assign(error, { proofCode: "assistant_finalize_timeout" })),
    );
    lifecycle.events.push({
      assertion: "assistant-finalized",
      receivedAt: nowIso(),
      event: assistantFinal.data,
    });
    const ready = await waitForPush(
      ws,
      "orchestration.domainEvent",
      (push) =>
        push.data?.type === "thread.session-set" &&
        push.data?.payload?.threadId === threadId &&
        push.data?.payload?.session?.status === "ready" &&
        push.data?.payload?.session?.activeTurnId === null &&
        Number(push.data?.sequence ?? 0) > Number(assistantFinal.data?.sequence ?? 0),
      lifecycleTimeoutMs,
    ).catch((error) =>
      Promise.reject(Object.assign(error, { proofCode: "lifecycle_ready_timeout" })),
    );
    lifecycle.events.push({ assertion: "session-ready", receivedAt: nowIso(), event: ready.data });
    const runtimeError = providerRuntimeError(running) ?? providerRuntimeError(ready);
    if (runtimeError) {
      await failWith(
        "failed",
        "provider_runtime_error",
        "Provider session reported an auth, provider, or runtime error.",
        JSON.stringify(runtimeError),
        "Inspect lifecycle.json, server.stderr, and Codex authentication before rerunning.",
        "lifecycle",
        true,
        { serverConfig: config },
      );
      return;
    }

    lifecycle.finishedAt = nowIso();
    lifecycle.assertions = [
      "server/provider ready",
      "request accepted/running",
      "assistant streaming event observed",
      "assistant finalization event observed",
      "session returned ready",
      "no provider/auth/runtime error",
    ];
    await writeJson(resolve(outDir, "lifecycle.json"), lifecycle);
    if (stopCollectingPushes) stopCollectingPushes();
    if (ws) ws.close();
    cleanup = await stopProcess(server);
    await writeJson(resolve(outDir, "cleanup.json"), cleanup);
    await writeJson(resolve(outDir, "observed-pushes.json"), observedPushes);
    const serverLogs = await writeServerLogs(server);
    if (cleanup.errors.length > 0) {
      await writeSummary(
        "failed",
        blocker(
          "cleanup_failed",
          "Probe cleanup failed.",
          cleanup.errors.join("; "),
          "Inspect cleanup.json and stop remaining T3Code server processes for this port.",
          "cleanup",
          true,
        ),
        { preflight: preflightResult.result, cleanup, lifecycle },
      );
      process.exitCode = 1;
      return;
    }
    const logViolation = serverLogViolation(serverLogs.stdout, serverLogs.stderr);
    if (logViolation) {
      await writeSummary(
        "failed",
        blocker(
          "server_log_violation",
          "Probe server logs contain an unclassified warning or runtime failure.",
          logViolation,
          "Inspect server.stdout and server.stderr, fix or classify the log line, then rerun.",
          "server_logs",
          true,
        ),
        { preflight: preflightResult.result, cleanup, lifecycle },
      );
      process.exitCode = 1;
      return;
    }
    await writeSummary("passed", null, {
      codexBinary: acceptedBinary,
      preflight: preflightResult.result,
      server: {
        baseUrl: `http://127.0.0.1:${port}`,
        settingsBinaryPath: serverSettingsBinary,
        configProviderStatus: codexProvider,
      },
      provider: { provider, model },
      boundedTurn: {
        prompt: promptText,
        turnsStarted,
        assistantMessageId,
        assistantTextLength: String(assistantStream.data?.payload?.text ?? "").length,
        streamingEventSequence: assistantStream.data?.sequence ?? null,
        finalEventSequence: assistantFinal.data?.sequence ?? null,
      },
      lifecycle,
      cleanup,
    });
  } catch (error) {
    const code = error.proofCode ?? "provider_startup_failed";
    const phaseByCode = {
      provider_startup_failed: "server_startup",
      server_live_timeout: "server_readiness",
      server_ready_timeout: "server_readiness",
      websocket_ready_timeout: "server_readiness",
      dispatch_failed: "dispatch",
      assistant_stream_timeout: "stream",
      assistant_finalize_timeout: "stream",
      lifecycle_ready_timeout: "lifecycle",
    };
    await failWith(
      "failed",
      code,
      "Real-provider probe failed.",
      error.message,
      "Inspect preflight.json, lifecycle.json, server.stdout, and server.stderr, then rerun the probe.",
      phaseByCode[code] ?? "runtime",
      true,
    );
    process.exitCode = 1;
  } finally {
    if (stopCollectingPushes) stopCollectingPushes();
    if (ws) ws.close();
  }
}

main().catch(async (error) => {
  await mkdir(outDir, { recursive: true });
  await writeSummary(
    "failed",
    blocker(
      "probe_unhandled_error",
      "Real-provider probe crashed.",
      error.stack ?? error.message,
      "Inspect stderr and rerun after fixing the probe crash.",
      "runtime",
      true,
    ),
  );
  process.exitCode = 1;
});
