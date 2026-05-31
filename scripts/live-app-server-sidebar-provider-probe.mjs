#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const agentsRoot = process.env.AGENTS_VXAPP_REPO_ROOT ?? "/home/gizmo/agents-vxapp";
const ownerEvidenceRoot = resolve(
  agentsRoot,
  "plans/evidence/orchestration-platform-migration/live-orchestration",
);
const ownerStateRoot = resolve(ownerEvidenceRoot, "isolated-state/owner-app");
const ownerDbPath = resolve(ownerStateRoot, "state/vx_agents.sqlite3");
const generatedRoleEvidenceRoot = resolve(
  agentsRoot,
  "plans/evidence/orchestration-platform-migration/generated-role-session-live",
);
const generatedRoleSourceWorkRoot = "/tmp/agents-vxapp-generated-role-session-live";
const generatedRoleSourceRuntimeRoot = resolve(
  generatedRoleSourceWorkRoot,
  ".agents-vxapp-runtime",
);
const outDir = resolve(
  process.env.T3CODE_APP_SERVER_PROBE_OUT_DIR ??
    resolve(agentsRoot, "plans/evidence/orchestration-platform-migration/t3code-app-server-live"),
);
const generatedRoleRuntimeRoot =
  process.env.T3CODE_APP_SERVER_ROLE_RUNTIME_ROOT ??
  "/tmp/t3code-app-server-live-generated-role-runtime";
const generatedRoleStateRoot = resolve(generatedRoleRuntimeRoot, "role-state");
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

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function loadGeneratedRoleSessions() {
  const summary = JSON.parse(
    await readFile(resolve(generatedRoleEvidenceRoot, "summary.json"), "utf8"),
  );
  const sessions = {};
  for (const entry of summary.materialized ?? []) {
    if (entry.role === "cto") {
      sessions.cto = {
        role: "cto",
        threadId: "thread-generated-cto-live",
        agentKind: "executive",
        sessionId: entry.session_id,
        workspace: mapGeneratedWorkspaceToActiveRuntime(entry.workspace),
      };
    }
    if (entry.role === "jasper") {
      sessions.jasper = {
        role: "jasper",
        threadId: "thread-generated-jasper-live",
        agentKind: "orchestrator",
        sessionId: entry.session_id,
        workspace: mapGeneratedWorkspaceToActiveRuntime(entry.workspace),
      };
    }
  }
  if (!sessions.cto || !sessions.jasper) {
    throw new Error(
      "generated role-session evidence is missing CTO or Jasper materialized workspace",
    );
  }
  return sessions;
}

function mapGeneratedWorkspaceToActiveRuntime(workspace) {
  const raw = String(workspace);
  if (!raw.startsWith(generatedRoleSourceRuntimeRoot)) {
    throw new Error(`generated workspace is outside source runtime root: ${raw}`);
  }
  return `${generatedRoleRuntimeRoot}${raw.slice(generatedRoleSourceRuntimeRoot.length)}`;
}

async function prepareGeneratedRoleRuntime(sessions) {
  await rm(generatedRoleRuntimeRoot, { recursive: true, force: true });
  await mkdir(generatedRoleRuntimeRoot, { recursive: true });
  await cp(
    resolve(generatedRoleSourceRuntimeRoot, "role-sessions"),
    resolve(generatedRoleRuntimeRoot, "role-sessions"),
    {
      recursive: true,
    },
  );
  await cp(resolve(generatedRoleSourceRuntimeRoot, "role-state"), generatedRoleStateRoot, {
    recursive: true,
  });
  for (const session of [sessions.cto, sessions.jasper]) {
    const sessionRecordPath = resolve(
      generatedRoleStateRoot,
      session.role,
      "sessions",
      `${session.sessionId}.json`,
    );
    const record = JSON.parse(await readFile(sessionRecordPath, "utf8"));
    record.workspace_path = session.workspace;
    await writeFile(sessionRecordPath, `${JSON.stringify(record, null, 2)}\n`);
  }
}

function seedGeneratedRoleBinding(session) {
  const now = nowIso();
  const metadata = JSON.stringify({
    source: "t3code-app-server-live-role-runtime-proof",
    role: session.role,
  });
  const sql = `
INSERT OR REPLACE INTO agents_session_bindings (
  binding_key,
  workspace_root,
  repo_name,
  current_session_id,
  current_thread_id,
  status,
  metadata_json,
  created_at,
  updated_at
) VALUES (
  ${sqlQuote(`live-generated-${session.role}`)},
  ${sqlQuote(session.workspace)},
  ${sqlQuote("agents-vxapp")},
  ${sqlQuote(session.sessionId)},
  ${sqlQuote(session.threadId)},
  ${sqlQuote("active")},
  ${sqlQuote(metadata)},
  ${sqlQuote(now)},
  ${sqlQuote(now)}
);
`;
  const result = spawnSync("sqlite3", [ownerDbPath, sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `failed to seed generated ${session.role} role-session binding: ${result.stderr || result.stdout}`,
    );
  }
}

function clearGeneratedRoleBindings() {
  const sql = `
DELETE FROM agents_session_bindings
WHERE binding_key IN (${sqlQuote("live-generated-cto")}, ${sqlQuote("live-generated-jasper")});
`;
  const result = spawnSync("sqlite3", [ownerDbPath, sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `failed to clear generated role-session bindings: ${result.stderr || result.stdout}`,
    );
  }
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
  await waitForPush(ws, "server.welcome", () => true, 10_000);
  return ws;
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
  const generatedRoleSessions = await loadGeneratedRoleSessions();
  clearGeneratedRoleBindings();
  await rm(generatedRoleRuntimeRoot, { recursive: true, force: true });
  await mkdir(generatedRoleRuntimeRoot, { recursive: true });
  await writeFile(
    resolve(outDir, "generated-role-session-bindings.json"),
    `${JSON.stringify(generatedRoleSessions, null, 2)}\n`,
  );
  await writeFile(
    resolve(t3UserData, "settings.json"),
    `${JSON.stringify({ providers: { codex: { binaryPath: fakeCodexPath } } }, null, 2)}\n`,
  );
  const port = await findFreePort();
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
    T3CODE_HOME: t3Home,
    T3CODE_HOST: "127.0.0.1",
    T3CODE_LOG_WS_EVENTS: "1",
    T3CODE_NO_BROWSER: "1",
    T3CODE_PORT: String(port),
    T3_STATE_DB: ownerDbPath,
    VX_AGENTS_APP_ROOT: ownerStateRoot,
    VX_AGENTS_OWNER_REVISION: "t3code-app-server-live-proof",
    VX_AGENTS_REPO_ROOT: agentsRoot,
    VX_AGENTS_ROLE_SESSION_REPO_ROOT: agentsRoot,
    VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT: generatedRoleRuntimeRoot,
    VX_AGENTS_ROLE_SESSION_STATE_ROOT: generatedRoleStateRoot,
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
        ownerDbPath,
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

    ws = await connectWs(port);
    stopCollectingPushes = collectPushes(ws, observedPushes);
    const config = await wsRequest(ws, "server.getConfig");
    const sidebarAuthority = await wsRequest(ws, "server.getAgentsVxappSidebarAuthoritySnapshot", {
      page: 1,
      limit: 20,
    });
    const sidebarGraph = await wsRequest(ws, "server.getAgentsVxappSidebarGraph", {});
    const controlPlane = await wsRequest(ws, "server.getAgentsVxappControlPlaneSnapshot", {
      page: 1,
      limit: 20,
    });
    const agentRuntime = await wsRequest(ws, "server.getAgentRuntimeSnapshot", {
      agentKind: "executive",
      threadId: "thread-cto-live",
    });
    await writeFile(resolve(outDir, "server-config.json"), `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(
      resolve(outDir, "sidebar-authority.json"),
      `${JSON.stringify(sidebarAuthority, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "sidebar-graph.json"),
      `${JSON.stringify(sidebarGraph, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "control-plane.json"),
      `${JSON.stringify(controlPlane, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "agent-runtime.json"),
      `${JSON.stringify(agentRuntime, null, 2)}\n`,
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
    await page.goto(`http://127.0.0.1:${port}/sidebar`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="vx-orchestration-sidebar"]', { timeout: 45_000 });
    await page.waitForFunction(
      () => document.body.textContent?.includes("Live Orchestration Proof"),
      undefined,
      { timeout: 45_000 },
    );
    const screenshotPath = resolve(outDir, "t3code-app-server-sidebar.png");
    const tracePath = resolve(outDir, "t3code-app-server-sidebar-trace.zip");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await context.tracing.stop({ path: tracePath });

    const bodyText = await page.locator("body").innerText();
    await prepareGeneratedRoleRuntime(generatedRoleSessions);
    seedGeneratedRoleBinding(generatedRoleSessions.cto);
    seedGeneratedRoleBinding(generatedRoleSessions.jasper);
    const generatedCtoRuntime = await wsRequest(ws, "server.getAgentRuntimeSnapshot", {
      agentKind: generatedRoleSessions.cto.agentKind,
      threadId: generatedRoleSessions.cto.threadId,
    });
    const generatedJasperRuntime = await wsRequest(ws, "server.getAgentRuntimeSnapshot", {
      agentKind: generatedRoleSessions.jasper.agentKind,
      threadId: generatedRoleSessions.jasper.threadId,
    });
    await writeFile(
      resolve(outDir, "generated-cto-agent-runtime.json"),
      `${JSON.stringify(generatedCtoRuntime, null, 2)}\n`,
    );
    await writeFile(
      resolve(outDir, "generated-jasper-agent-runtime.json"),
      `${JSON.stringify(generatedJasperRuntime, null, 2)}\n`,
    );
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "project.create",
        commandId: "cmd-live-generated-cto-project",
        projectId: "project-generated-cto-runtime",
        title: "Generated CTO Runtime",
        workspaceRoot: generatedCtoRuntime.workspaceRoot,
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt: nowIso(),
      },
    });
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.create",
        commandId: "cmd-live-generated-cto-thread",
        threadId: generatedRoleSessions.cto.threadId,
        projectId: "project-generated-cto-runtime",
        title: "Generated CTO runtime thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: generatedCtoRuntime.workspaceRoot,
        createdAt: nowIso(),
      },
    });
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "project.create",
        commandId: "cmd-live-generated-jasper-project",
        projectId: "project-generated-jasper-runtime",
        title: "Generated Jasper Runtime",
        workspaceRoot: generatedJasperRuntime.workspaceRoot,
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt: nowIso(),
      },
    });
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.create",
        commandId: "cmd-live-generated-jasper-thread",
        threadId: generatedRoleSessions.jasper.threadId,
        projectId: "project-generated-jasper-runtime",
        title: "Generated Jasper runtime thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: generatedJasperRuntime.workspaceRoot,
        createdAt: nowIso(),
      },
    });
    const generatedCtoThreadPush = await waitForObservedPush(
      observedPushes,
      (push) =>
        push.channel === "orchestration.domainEvent" &&
        push.data?.type === "thread.created" &&
        push.data?.payload?.threadId === generatedRoleSessions.cto.threadId,
      "generated CTO thread.created event",
    );
    const generatedJasperThreadPush = await waitForObservedPush(
      observedPushes,
      (push) =>
        push.channel === "orchestration.domainEvent" &&
        push.data?.type === "thread.created" &&
        push.data?.payload?.threadId === generatedRoleSessions.jasper.threadId,
      "generated Jasper thread.created event",
    );
    const summary = {
      ok:
        sidebarAuthority.programs.some((row) => row.program?.id === "program-live") &&
        sidebarGraph.threadLinks.some((row) => row.threadId === "thread-cto-live") &&
        controlPlane.programs.some((row) => row.id === "program-live") &&
        agentRuntime.threadId === "thread-cto-live" &&
        agentRuntime.agentKind === "executive" &&
        generatedCtoRuntime.threadId === generatedRoleSessions.cto.threadId &&
        generatedCtoRuntime.availability === "inspectable" &&
        generatedCtoRuntime.workspaceRoot === generatedRoleSessions.cto.workspace &&
        generatedCtoRuntime.summary?.role === "cto" &&
        generatedJasperRuntime.threadId === generatedRoleSessions.jasper.threadId &&
        generatedJasperRuntime.availability === "inspectable" &&
        generatedJasperRuntime.workspaceRoot === generatedRoleSessions.jasper.workspace &&
        generatedJasperRuntime.summary?.role === "jasper" &&
        generatedCtoThreadPush.data?.payload?.worktreePath ===
          generatedRoleSessions.cto.workspace &&
        generatedJasperThreadPush.data?.payload?.worktreePath ===
          generatedRoleSessions.jasper.workspace &&
        sessionPush.data?.type === "thread.session-set" &&
        assistantPush.data?.type === "thread.message-sent" &&
        completedPush.data?.type === "thread.session-set" &&
        completedPush.data?.payload?.session?.status === "ready" &&
        bodyText.includes("Live Orchestration Proof"),
      ...proofMetadata(),
      baseUrl: `http://127.0.0.1:${port}`,
      fakeCodexPath,
      ownerDbPath,
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
      },
      sidebarGraph: {
        threadLinkCount: sidebarGraph.threadLinks.length,
        staleMirror: sidebarGraph.mirrorDiagnostics?.staleMirror ?? null,
      },
      agentRuntime: {
        availability: agentRuntime.availability,
        reasonCode: agentRuntime.reasonCode,
        runtimeKind: agentRuntime.runtimeKind,
        workspaceRoot: agentRuntime.workspaceRoot,
        packCount: agentRuntime.summary?.packCount ?? null,
        skillCount: agentRuntime.summary?.skillCount ?? null,
      },
      generatedRoleRuntime: {
        cto: {
          threadId: generatedCtoRuntime.threadId,
          availability: generatedCtoRuntime.availability,
          workspaceRoot: generatedCtoRuntime.workspaceRoot,
          workspaceResolution: generatedCtoRuntime.workspaceResolution,
          role: generatedCtoRuntime.summary?.role ?? null,
          profile: generatedCtoRuntime.summary?.profile ?? null,
          skillCount: generatedCtoRuntime.summary?.skillCount ?? null,
        },
        jasper: {
          threadId: generatedJasperRuntime.threadId,
          availability: generatedJasperRuntime.availability,
          workspaceRoot: generatedJasperRuntime.workspaceRoot,
          workspaceResolution: generatedJasperRuntime.workspaceResolution,
          role: generatedJasperRuntime.summary?.role ?? null,
          profile: generatedJasperRuntime.summary?.profile ?? null,
          skillCount: generatedJasperRuntime.summary?.skillCount ?? null,
        },
      },
      currentState: {
        projectCount: Array.isArray(currentStateBeforeGenerated.projects)
          ? currentStateBeforeGenerated.projects.length
          : null,
        threadCount: Array.isArray(currentStateBeforeGenerated.threads)
          ? currentStateBeforeGenerated.threads.length
          : null,
        generatedThreadWorktreePaths: [
          {
            id: generatedRoleSessions.cto.threadId,
            worktreePath: generatedCtoThreadPush.data?.payload?.worktreePath ?? null,
          },
          {
            id: generatedRoleSessions.jasper.threadId,
            worktreePath: generatedJasperThreadPush.data?.payload?.worktreePath ?? null,
          },
        ],
      },
      browser: {
        sidebarRendered: bodyText.includes("Live Orchestration Proof"),
        containsAttention: bodyText.includes("attention"),
        frameSampleCount: browserWsFrames.length,
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
