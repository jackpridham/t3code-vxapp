#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
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
  process.env.T3CODE_APP_SERVER_PROBE_OUT_DIR ??
    resolve(repoRoot, ".vx/live-probes/t3code-app-server-live"),
);
const serverRequire = createRequire(new URL("../apps/server/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { WebSocket } = serverRequire("ws");
const { chromium } = webRequire("playwright");

const proofKind = "harness/shim";
const realProvider = false;
const realProviderProofBlocker =
  "This probe installs a deterministic fake Codex app-server shim; real provider proof requires running against an authenticated real Codex CLI/app-server without the shimmed binary.";

function proofMetadata() {
  return {
    proof_kind: proofKind,
    real_provider: realProvider,
    real_provider_proof_blocker: realProviderProofBlocker,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function servedAssetNames(indexHtml) {
  return [...indexHtml.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .toSorted();
}

function activeOwnerThreadFromSidebarAuthority(sidebarAuthority, ownerAuthority) {
  const activeProgramCard =
    sidebarAuthority.programs.find(
      (row) =>
        row.program?.id === ownerAuthority.activeProgramId ||
        row.executive?.threadId === ownerAuthority.ctoThreadId ||
        (row.executive?.threadId && row.program?.status !== "completed"),
    ) ??
    sidebarAuthority.programs.find((row) => row.executive?.threadId) ??
    null;
  return {
    programCard: activeProgramCard,
    threadId: activeProgramCard?.executive?.threadId ?? null,
  };
}

function activeOwnerThreadFromBootstrapSummary(bootstrapSummary, ownerAuthority) {
  const activeProgram =
    bootstrapSummary.programs?.find(
      (program) =>
        program.id === ownerAuthority.activeProgramId ||
        program.executiveThreadId === ownerAuthority.ctoThreadId ||
        (program.executiveThreadId && program.status !== "completed"),
    ) ??
    bootstrapSummary.programs?.find((program) => program.executiveThreadId) ??
    null;
  return {
    program: activeProgram,
    threadId: activeProgram?.executiveThreadId ?? null,
  };
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
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
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function writeFakeCodex(binDir) {
  const fakeCodexPath = resolve(binDir, "codex");
  // Deterministic harness shim: this is intentional app-server protocol proof,
  // not evidence that a real external Codex provider completed a turn.
  const source = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("codex-cli 99.0.0");
  process.exit(0);
}
if (args.length === 2 && args[0] === "login" && args[1] === "status") {
  console.log(JSON.stringify({ authenticated: true }));
  process.exit(0);
}
if (args.length !== 1 || args[0] !== "app-server") {
  console.error("Unsupported fake Codex command: " + args.join(" "));
  process.exit(2);
}
let remainder = "";
let providerThreadId = "provider-thread-live-probe";
let turnCounter = 0;
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const respond = (id, result) => write({ id, result });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const thread = (cwd) => ({
  cliVersion: "probe",
  createdAt: nowSeconds(),
  cwd,
  ephemeral: false,
  id: providerThreadId,
  modelProvider: "openai",
  name: "T3Code app-server live probe",
  path: null,
  preview: "T3Code app-server live probe",
  source: "appServer",
  status: { type: "idle" },
  turns: [],
  updatedAt: nowSeconds(),
});
const turn = (id, status) => ({
  completedAt: status === "completed" ? nowSeconds() : null,
  durationMs: status === "completed" ? 25 : null,
  error: null,
  id,
  items: [],
  startedAt: nowSeconds(),
  status,
});
const handle = (message) => {
  if (message.method === "initialize") {
    respond(message.id, {
      userAgent: "t3code-live-probe-codex-app-server",
      codexHome: process.cwd(),
      platformFamily: process.platform === "win32" ? "windows" : "unix",
      platformOs: process.platform === "darwin" ? "macos" : process.platform,
    });
    return;
  }
  if (message.method === "initialized") {
    return;
  }
  if (message.method === "thread/start" || message.method === "thread/resume") {
    if (message.params && typeof message.params.threadId === "string") {
      providerThreadId = message.params.threadId;
    }
    const payload = {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      cwd: process.cwd(),
      instructionSources: [],
      model: message.params?.model || "gpt-5-codex",
      modelProvider: "openai",
      reasoningEffort: null,
      sandbox: { type: "dangerFullAccess" },
      serviceTier: null,
      thread: thread(process.cwd()),
    };
    respond(message.id, payload);
    write({ method: "thread/started", params: { thread: payload.thread } });
    return;
  }
  if (message.method === "turn/start") {
    turnCounter += 1;
    const turnId = "provider-turn-live-probe-" + turnCounter;
    const itemId = "provider-item-live-probe-" + turnCounter;
    const startedTurn = turn(turnId, "inProgress");
    respond(message.id, { turn: startedTurn });
    setTimeout(() => {
      write({ method: "turn/started", params: { threadId: providerThreadId, turn: startedTurn } });
      write({
        method: "item/started",
        params: {
          threadId: providerThreadId,
          turnId,
          item: { id: itemId, text: "", type: "agentMessage" },
        },
      });
      write({
        method: "item/agentMessage/delta",
        params: {
          delta: "provider final reached browser path",
          itemId,
          threadId: providerThreadId,
          turnId,
        },
      });
      write({
        method: "item/completed",
        params: {
          threadId: providerThreadId,
          turnId,
          item: { id: itemId, phase: "final_answer", text: "provider final reached browser path", type: "agentMessage" },
        },
      });
      write({ method: "turn/completed", params: { threadId: providerThreadId, turn: turn(turnId, "completed") } });
    }, 25);
    return;
  }
  if (message.method === "thread/read") {
    respond(message.id, { thread: thread(process.cwd()) });
    return;
  }
  if (message.id !== undefined) {
    write({ id: message.id, error: { code: -32601, message: "Unhandled request: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  remainder += chunk;
  const lines = remainder.split("\\n");
  remainder = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    handle(JSON.parse(line));
  }
});
`;
  await writeFile(fakeCodexPath, source);
  await chmod(fakeCodexPath, 0o755);
  return fakeCodexPath;
}

function wsRequest(ws, method, body = {}, timeoutMs = 45_000) {
  const id = `probe-${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = JSON.stringify({ id, body: { _tag: method, ...body } });
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      rejectRequest(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "push") {
        return;
      }
      if (message.id !== id) {
        return;
      }
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
      if (message.type !== "push" || message.channel !== channel) {
        return;
      }
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolvePush(message);
    };
    ws.on("message", onMessage);
  });
}

async function waitForObservedPush(pushes, predicate, label, timeoutMs = 90_000) {
  let matched = null;
  await waitFor(
    () => {
      matched = pushes.find(predicate) ?? null;
      return matched !== null;
    },
    label,
    timeoutMs,
  );
  return matched;
}

async function connectWs(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.once("open", resolveOpen);
    ws.once("error", rejectOpen);
  });
  const welcome = await waitForPush(ws, "server.welcome", () => true, 10_000);
  return { ws, welcome };
}

function collectPushes(ws, sink) {
  const onMessage = (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type !== "push") {
      return;
    }
    sink.push({
      channel: message.channel,
      data: message.data,
      receivedAt: nowIso(),
    });
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
  return { child, stdout, stderr };
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
    activeProgram,
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

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    wait(5_000).then(() => "timeout"),
  ]);
  if (exited === "timeout") {
    child.kill("SIGKILL");
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const t3Home = resolve(outDir, "t3-home");
  const t3UserData = resolve(t3Home, "userdata");
  const binDir = resolve(outDir, "bin");
  await Promise.all([
    rm(resolve(outDir, "failure.json"), { force: true }),
    rm(resolve(outDir, "summary.json"), { force: true }),
    rm(resolve(outDir, "server.stdout"), { force: true }),
    rm(resolve(outDir, "server.stderr"), { force: true }),
    rm(resolve(outDir, "observed-pushes.json"), { force: true }),
  ]);
  await rm(t3Home, { recursive: true, force: true });
  await mkdir(t3Home, { recursive: true });
  await mkdir(t3UserData, { recursive: true });
  await mkdir(binDir, { recursive: true });
  const fakeCodexPath = await writeFakeCodex(binDir);
  const ownerAuthority = await loadOwnerAuthorityStatus();
  await writeFile(
    resolve(outDir, "owner-cto-status.json"),
    `${JSON.stringify(ownerAuthority.raw, null, 2)}\n`,
  );
  await writeFile(
    resolve(t3UserData, "settings.json"),
    `${JSON.stringify({ providers: { codex: { binaryPath: fakeCodexPath } } }, null, 2)}\n`,
  );
  const port = await findFreePort();
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
    T3CODE_HOME: t3Home,
    T3CODE_HOST: "127.0.0.1",
    T3CODE_LOG_WS_EVENTS: "1",
    T3CODE_NO_BROWSER: "1",
    T3CODE_PORT: String(port),
    VX_AGENTS_OWNER_REVISION: "t3code-app-server-live-proof",
    VX_AGENTS_REPO_ROOT: agentsRoot,
    VX_AGENTS_ROLE_SESSION_REPO_ROOT: agentsRoot,
  };

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
    {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let ws = null;
  let browser = null;
  let stopCollectingPushes = null;
  const observedPushes = [];
  await writeFile(
    resolve(outDir, "run-metadata.json"),
    `${JSON.stringify(
      {
        ...proofMetadata(),
        port,
        fakeCodexPath,
        t3Home,
        activeProgramId: ownerAuthority.activeProgramId,
        ctoThreadId: ownerAuthority.ctoThreadId,
        jasperThreadId: ownerAuthority.jasperThreadId,
        startedAt: nowIso(),
      },
      null,
      2,
    )}\n`,
  );
  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`).catch(() => null);
      return response?.status === 200;
    }, "T3 server live health");
    await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${port}/health/ready`).catch(() => null);
        return response?.status === 200;
      },
      "T3 server ready health",
      60_000,
    );
    const servedIndexHtml = await fetch(`http://127.0.0.1:${port}/`).then((response) =>
      response.text(),
    );
    const servedAssets = servedAssetNames(servedIndexHtml);

    const connection = await connectWs(port);
    ws = connection.ws;
    const serverWelcome = connection.welcome;
    stopCollectingPushes = collectPushes(ws, observedPushes);
    const config = await wsRequest(ws, "server.getConfig");
    const bootstrapSummary = await wsRequest(ws, "orchestration.getBootstrapSummary");
    const sidebarAuthority = await wsRequest(ws, "server.getAgentsVxappSidebarAuthoritySnapshot", {
      page: 1,
      limit: 20,
    });
    const sidebarOwner = activeOwnerThreadFromSidebarAuthority(sidebarAuthority, ownerAuthority);
    const bootstrapOwner = activeOwnerThreadFromBootstrapSummary(bootstrapSummary, ownerAuthority);
    const ownerProgramCard = sidebarOwner.programCard;
    const ownerProgram = bootstrapOwner.program;
    const activeOwnerThreadId =
      ownerAuthority.ctoThreadId ??
      sidebarOwner.threadId ??
      bootstrapOwner.threadId ??
      serverWelcome.data?.bootstrapThreadId ??
      null;
    const agentRuntime = activeOwnerThreadId
      ? await wsRequest(ws, "server.getAgentRuntimeSnapshot", {
          agentKind: "executive",
          threadId: activeOwnerThreadId,
        })
      : null;
    const jasperRuntime = await wsRequest(ws, "server.getAgentRuntimeSnapshot", {
      agentKind: "orchestrator",
      threadId: ownerAuthority.jasperThreadId,
    });
    const firstWorkerTarget =
      sidebarAuthority.programs
        .flatMap((row) => row.workers ?? [])
        .find((worker) => worker?.threadId && worker?.workspace) ?? null;
    const workerRuntime = firstWorkerTarget
      ? await wsRequest(ws, "server.getWorkerRuntimeSnapshot", {
          threadId: firstWorkerTarget.threadId,
          workspace: firstWorkerTarget.workspace,
        })
      : null;
    await writeFile(resolve(outDir, "server-config.json"), `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(
      resolve(outDir, "bootstrap-summary.json"),
      `${JSON.stringify(bootstrapSummary, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "sidebar-authority.json"),
      `${JSON.stringify(sidebarAuthority, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "agent-runtime.json"),
      `${JSON.stringify(agentRuntime, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "jasper-agent-runtime.json"),
      `${JSON.stringify(jasperRuntime, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "worker-runtime.json"),
      `${JSON.stringify(workerRuntime, null, 2)}\n`,
    );
    const createdAt = nowIso();
    const projectId = "project-provider-live-probe";
    const threadId = "thread-provider-live-probe";
    const projectRoot = resolve(outDir, "provider-project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(resolve(projectRoot, "README.md"), "# provider probe\n");

    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "project.create",
        commandId: "cmd-live-provider-project",
        projectId,
        title: "Live Provider Probe",
        workspaceRoot: projectRoot,
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt,
      },
    });
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.create",
        commandId: "cmd-live-provider-thread",
        threadId,
        projectId,
        title: "Live provider thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      },
    });
    const sessionPromise = waitForPush(
      ws,
      "orchestration.domainEvent",
      (push) =>
        push.data?.type === "thread.session-set" &&
        push.data?.payload?.threadId === threadId &&
        push.data?.payload?.session?.status === "running",
    );
    const assistantPromise = waitForPush(
      ws,
      "orchestration.domainEvent",
      (push) =>
        push.data?.type === "thread.message-sent" &&
        push.data?.payload?.threadId === threadId &&
        String(push.data?.payload?.text ?? "").includes("provider final reached browser path"),
    );
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.turn.start",
        commandId: "cmd-live-provider-turn",
        threadId,
        message: {
          messageId: "msg-live-provider-turn",
          role: "user",
          text: "emit bounded live probe completion",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: nowIso(),
      },
    });
    const sessionPush = await sessionPromise;
    const assistantPush = await assistantPromise;
    const completedPush = await waitForObservedPush(
      observedPushes,
      (push) =>
        push.channel === "orchestration.domainEvent" &&
        push.data?.type === "thread.session-set" &&
        push.data?.payload?.threadId === threadId &&
        push.data?.payload?.session?.status === "ready" &&
        push.data?.payload?.session?.activeTurnId === null &&
        Number(push.data?.sequence ?? 0) > Number(sessionPush.data?.sequence ?? 0),
      "provider turn ready session after running turn",
    );
    const currentStateBeforeGenerated = await wsRequest(ws, "orchestration.getCurrentState");
    await writeFile(
      resolve(outDir, "current-state.json"),
      `${JSON.stringify(currentStateBeforeGenerated, null, 2)}\n`,
    );

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    const browserWsFrames = [];
    page.on("websocket", (socket) => {
      socket.on("framesent", (event) => {
        if (browserWsFrames.length < 80) {
          browserWsFrames.push({ direction: "sent", payload: event.payload });
        }
      });
      socket.on("framereceived", (event) => {
        if (browserWsFrames.length < 80) {
          browserWsFrames.push({ direction: "received", payload: event.payload });
        }
      });
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    if (activeOwnerThreadId) {
      await page
        .waitForURL(new RegExp(`/${activeOwnerThreadId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), {
          timeout: 45_000,
        })
        .catch(() => undefined);
    }
    const browserStartupUrl = page.url();
    await page.goto(`http://127.0.0.1:${port}/sidebar`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="vx-orchestration-sidebar"]', { timeout: 45_000 });
    const activeOwnerProgramTitle = ownerProgramCard?.program?.title ?? ownerProgram?.title ?? null;
    if (activeOwnerThreadId) {
      await page
        .waitForFunction(
          ([threadId, title]) =>
            document.body.textContent?.includes(threadId) ||
            (title ? document.body.textContent?.includes(title) : false) ||
            document.querySelector(`[data-testid="thread-row-${threadId}"]`) !== null,
          [activeOwnerThreadId, activeOwnerProgramTitle],
          { timeout: 45_000 },
        )
        .catch(() => undefined);
    }
    const screenshotPath = resolve(outDir, "t3code-app-server-sidebar.png");
    const tracePath = resolve(outDir, "t3code-app-server-sidebar-trace.zip");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await context.tracing.stop({ path: tracePath });

    const bodyText = await page.locator("body").innerText();
    const sidebarCtoRowSelector = activeOwnerThreadId
      ? `[data-testid="thread-row-${activeOwnerThreadId}"]`
      : null;
    let sidebarCtoRowFound = false;
    let sidebarClickUrl = page.url();
    if (sidebarCtoRowSelector) {
      const sidebarCtoRow = page.locator(sidebarCtoRowSelector).first();
      sidebarCtoRowFound = (await sidebarCtoRow.count()) > 0;
      if (sidebarCtoRowFound) {
        await sidebarCtoRow.click();
        await page.waitForURL(
          new RegExp(`/${activeOwnerThreadId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
          {
            timeout: 45_000,
          },
        );
        sidebarClickUrl = page.url();
      }
    }
    const serverWelcomeBootstrapThreadId = serverWelcome.data?.bootstrapThreadId ?? null;
    const currentStateThreadId =
      currentStateBeforeGenerated.projects?.find(
        (project) => project.currentSessionRootThreadId === activeOwnerThreadId,
      )?.currentSessionRootThreadId ?? null;
    const sidebarThreadId = ownerProgramCard?.executive?.threadId ?? null;
    const sidebarJasperThreadId = ownerProgramCard?.orchestrator?.threadId ?? null;
    const startupSidebarCurrentStateParity =
      activeOwnerThreadId !== null &&
      serverWelcomeBootstrapThreadId === activeOwnerThreadId &&
      currentStateThreadId === activeOwnerThreadId &&
      sidebarThreadId === activeOwnerThreadId;
    const activeAuthorityParity =
      ownerProgram?.id === ownerAuthority.activeProgramId &&
      ownerProgram?.executiveThreadId === ownerAuthority.ctoThreadId &&
      ownerProgram?.currentOrchestratorThreadId === ownerAuthority.jasperThreadId &&
      sidebarJasperThreadId === ownerAuthority.jasperThreadId;
    const browserStartupRouteMatchesOwner =
      activeOwnerThreadId !== null && browserStartupUrl.endsWith(`/${activeOwnerThreadId}`);
    const sidebarClickRouteMatchesOwner =
      activeOwnerThreadId !== null && sidebarClickUrl.endsWith(`/${activeOwnerThreadId}`);
    const activeRuntimeOk =
      agentRuntime?.threadId === ownerAuthority.ctoThreadId &&
      agentRuntime?.agentKind === "executive" &&
      agentRuntime?.workspaceRoot === ownerAuthority.ctoWorkspaceRoot &&
      jasperRuntime?.threadId === ownerAuthority.jasperThreadId &&
      jasperRuntime?.agentKind === "orchestrator" &&
      jasperRuntime?.workspaceRoot === ownerAuthority.jasperWorkspaceRoot;
    const summary = {
      ok:
        !ownerAuthority.legacyFallbackUsed &&
        activeAuthorityParity &&
        activeRuntimeOk &&
        startupSidebarCurrentStateParity &&
        browserStartupRouteMatchesOwner &&
        sidebarClickRouteMatchesOwner &&
        servedAssets.length > 0 &&
        bootstrapSummary.threads.some((row) => row.id === activeOwnerThreadId) &&
        sidebarAuthority.programs.some((row) => row.executive?.threadId === activeOwnerThreadId) &&
        bootstrapSummary.programs?.some((row) => row.executiveThreadId === activeOwnerThreadId) &&
        agentRuntime?.threadId === activeOwnerThreadId &&
        agentRuntime?.agentKind === "executive" &&
        sessionPush.data?.type === "thread.session-set" &&
        assistantPush.data?.type === "thread.message-sent" &&
        completedPush.data?.type === "thread.session-set" &&
        completedPush.data?.payload?.session?.status === "ready" &&
        (sidebarCtoRowFound ||
          (activeOwnerThreadId !== null && bodyText.includes(activeOwnerThreadId))),
      ...proofMetadata(),
      baseUrl: `http://127.0.0.1:${port}`,
      fakeCodexPath,
      servedAssets,
      directWebSocket: {
        bootstrapThreadPresent: bootstrapSummary.threads.some(
          (row) => row.id === activeOwnerThreadId,
        ),
        bootstrapProjectCount: Array.isArray(bootstrapSummary.projects)
          ? bootstrapSummary.projects.length
          : null,
        bootstrapThreadCount: Array.isArray(bootstrapSummary.threads)
          ? bootstrapSummary.threads.length
          : null,
      },
      provider: {
        sessionEvent: sessionPush.data,
        assistantEvent: assistantPush.data,
        readySessionEvent: completedPush.data,
      },
      serverConfig: {
        cwd: config.cwd,
        providerCount: Array.isArray(config.providers) ? config.providers.length : null,
        codexStatus: Array.isArray(config.providers)
          ? (config.providers.find((provider) => provider.provider === "codex")?.status ?? null)
          : null,
      },
      ownerSidebar: {
        programCount: sidebarAuthority.programs.length,
        todoCount: sidebarAuthority.todos.length,
        currentTodoCount: sidebarAuthority.currentTodos.length,
        ownerDiagnosticsCount: sidebarAuthority.ownerDiagnostics.length,
        activeProgramId: ownerProgramCard?.program?.id ?? null,
      },
      ownerStatusAuthority: {
        activeProgramId: ownerAuthority.activeProgramId,
        activeProgramTitle: ownerAuthority.activeProgramTitle,
        ctoThreadId: ownerAuthority.ctoThreadId,
        ctoWorkspaceRoot: ownerAuthority.ctoWorkspaceRoot,
        jasperThreadId: ownerAuthority.jasperThreadId,
        jasperWorkspaceRoot: ownerAuthority.jasperWorkspaceRoot,
        legacyFallbackUsed: ownerAuthority.legacyFallbackUsed,
        activeAuthorityParity,
        activeRuntimeOk,
      },
      startupAuthority: {
        activeOwnerThreadId,
        serverWelcomeBootstrapThreadId,
        currentStateThreadId,
        sidebarThreadId,
        sidebarJasperThreadId,
        authoritySource:
          serverWelcome.data?.startupAuthority?.authoritySource ?? "agents-vxapp-owner",
        startupContract:
          serverWelcome.data?.startupAuthority?.startupContract ??
          "external-role-authority-snapshot",
        diagnostic: serverWelcome.data?.startupAuthority ?? null,
        ok: startupSidebarCurrentStateParity,
      },
      ownerProgramAuthority: {
        activeProgramId: ownerProgram?.id ?? null,
        executiveThreadId: ownerProgram?.executiveThreadId ?? null,
        currentOrchestratorThreadId: ownerProgram?.currentOrchestratorThreadId ?? null,
      },
      agentRuntime: {
        availability: agentRuntime?.availability ?? null,
        reasonCode: agentRuntime?.reasonCode ?? null,
        runtimeKind: agentRuntime?.runtimeKind ?? null,
        workspaceRoot: agentRuntime?.workspaceRoot ?? null,
        packCount: agentRuntime?.summary?.packCount ?? null,
        skillCount: agentRuntime?.summary?.skillCount ?? null,
      },
      jasperRuntime: {
        availability: jasperRuntime?.availability ?? null,
        reasonCode: jasperRuntime?.reasonCode ?? null,
        runtimeKind: jasperRuntime?.runtimeKind ?? null,
        workspaceRoot: jasperRuntime?.workspaceRoot ?? null,
        packCount: jasperRuntime?.summary?.packCount ?? null,
        skillCount: jasperRuntime?.summary?.skillCount ?? null,
      },
      workerRuntime:
        workerRuntime === null
          ? null
          : {
              threadId: workerRuntime.threadId,
              workspace: workerRuntime.workspace,
              availability: workerRuntime.availability,
              reasonCode: workerRuntime.reasonCode,
            },
      currentState: {
        projectCount: Array.isArray(currentStateBeforeGenerated.projects)
          ? currentStateBeforeGenerated.projects.length
          : null,
        threadCount: Array.isArray(currentStateBeforeGenerated.threads)
          ? currentStateBeforeGenerated.threads.length
          : null,
      },
      browser: {
        sidebarRendered:
          sidebarCtoRowFound ||
          (activeOwnerThreadId !== null && bodyText.includes(activeOwnerThreadId)),
        containsAttention: bodyText.includes("attention"),
        frameSampleCount: browserWsFrames.length,
        startupUrl: browserStartupUrl,
        sidebarClickUrl,
        startupRouteMatchesOwner: browserStartupRouteMatchesOwner,
        sidebarClickRouteMatchesOwner,
      },
      artifacts: { screenshotPath, tracePath },
    };
    await writeFile(resolve(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(
      resolve(outDir, "browser-ws-frames.json"),
      `${JSON.stringify(browserWsFrames, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "observed-pushes.json"),
      `${JSON.stringify(observedPushes, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "server.stdout"),
      Buffer.concat(server.stdout).toString("utf8"),
    );
    await writeFile(
      resolve(outDir, "server.stderr"),
      Buffer.concat(server.stderr).toString("utf8"),
    );
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    if (stopCollectingPushes) {
      stopCollectingPushes();
    }
    if (browser) {
      await browser.close();
    }
    if (ws) {
      ws.close();
    }
    await stopProcess(server.child);
    await mkdir(dirname(resolve(outDir, "server.stdout")), { recursive: true });
    await writeFile(
      resolve(outDir, "observed-pushes.json"),
      `${JSON.stringify(observedPushes, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "server.stdout"),
      Buffer.concat(server.stdout).toString("utf8"),
    );
    await writeFile(
      resolve(outDir, "server.stderr"),
      Buffer.concat(server.stderr).toString("utf8"),
    );
  }
}

main().catch(async (error) => {
  await mkdir(outDir, { recursive: true });
  await writeFile(
    resolve(outDir, "failure.json"),
    `${JSON.stringify(
      { ok: false, ...proofMetadata(), message: error.message, stack: error.stack },
      null,
      2,
    )}\n`,
  );
  console.error(error);
  process.exitCode = 1;
});
