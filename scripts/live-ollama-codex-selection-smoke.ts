#!/usr/bin/env bun
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractDomainEvents,
  makeRecorderInitScript,
  normalizeBrowserWsFrames,
  pairRpcExchanges,
} from "./perf/wsEvidence.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(new URL("../apps/server/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { WebSocket } = serverRequire("ws") as {
  WebSocket: new (url: string) => WsClient;
};
const { chromium } = webRequire("playwright") as {
  chromium: {
    launch: (options: { headless: boolean }) => Promise<Browser>;
  };
};

type PushEnvelope = {
  readonly channel: string;
  readonly data: unknown;
};

type RawWsData = string | Buffer | ArrayBuffer | readonly unknown[];

interface WsClient {
  readonly once: (event: string, listener: (...args: unknown[]) => void) => void;
  readonly on: (event: string, listener: (...args: unknown[]) => void) => void;
  readonly off: (event: string, listener: (...args: unknown[]) => void) => void;
  readonly send: (payload: string) => void;
  readonly close: () => void;
}

interface Browser {
  readonly newPage: (options?: { viewport?: { width: number; height: number } }) => Promise<Page>;
  readonly close: () => Promise<void>;
}

interface Locator {
  readonly click: (options?: { timeout?: number }) => Promise<void>;
  readonly fill: (value: string, options?: { timeout?: number }) => Promise<void>;
  readonly hover: (options?: { timeout?: number }) => Promise<void>;
  readonly textContent: () => Promise<string | null>;
  readonly waitFor: (options?: {
    state?: "attached" | "visible";
    timeout?: number;
  }) => Promise<void>;
  readonly evaluate: <T>(fn: (element: unknown) => T | Promise<T>) => Promise<T>;
}

interface Page {
  readonly addInitScript: (script: { content: string }) => Promise<void>;
  readonly goto: (
    url: string,
    options?: { waitUntil?: "domcontentloaded" | "networkidle"; timeout?: number },
  ) => Promise<unknown>;
  readonly locator: (selector: string) => Locator;
  readonly getByRole: (role: string, options?: { name?: string | RegExp }) => Locator;
  readonly evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
  readonly close: () => Promise<void>;
}

const webBaseUrl = (
  process.env.T3_WEB_BASE_URL ??
  process.env.T3_BASE_URL ??
  "http://127.0.0.1:3000"
).replace(/\/$/, "");
const serverBaseUrl = (
  process.env.T3_SERVER_BASE_URL ??
  process.env.T3_BASE_URL ??
  webBaseUrl
).replace(/\/$/, "");
const wsUrl = `${serverBaseUrl.replace(/^http/, "ws")}/ws`;
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://192.168.10.12:11435/api";
const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const ollamaCodexProfileName = process.env.OLLAMA_CODEX_PROFILE_NAME ?? "t3-ollama-gpu";
const ollamaCodexHomePath = process.env.OLLAMA_CODEX_HOME_PATH ?? "~/.codex-ollama";
const ollamaCodexBinaryPath = process.env.OLLAMA_CODEX_BINARY_PATH ?? "codex";
const timeoutMs = Number.parseInt(process.env.T3_OLLAMA_SMOKE_TIMEOUT_MS ?? "180000", 10);
const outDir = resolve(
  process.env.T3_OLLAMA_SMOKE_OUT_DIR ??
    resolve(repoRoot, ".vx/live-probes/t3-ollama-codex-selection-smoke"),
);

function nowIso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  const path = resolve(outDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requireEnvUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new Error(
      `${label} must be a valid URL: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function buildOllamaSettingsPatch() {
  const parsed = requireEnvUrl(ollamaBaseUrl, "OLLAMA_BASE_URL");
  return {
    providers: {
      ollamaLocal: {
        enabled: true,
        protocol: parsed.protocol === "https:" ? "https" : "http",
        host: parsed.hostname,
        port:
          parsed.port.length > 0
            ? Number.parseInt(parsed.port, 10)
            : parsed.protocol === "https:"
              ? 443
              : 80,
        apiPath: parsed.pathname || "/api",
        responsesApiPath: "/v1",
        codexBinaryPath: ollamaCodexBinaryPath,
        codexHomePath: ollamaCodexHomePath,
        codexProfileName: ollamaCodexProfileName,
        defaultModel: ollamaModel,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function rawWsDataFromArgs(args: ReadonlyArray<unknown>): RawWsData {
  return (args[0] ?? "") as RawWsData;
}

function wsRequest<T>(
  ws: WsClient,
  method: string,
  body: Record<string, unknown> = {},
  timeout = 45_000,
): Promise<T> {
  const id = `ollama-smoke-${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = JSON.stringify({ id, body: { _tag: method, ...body } });
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      rejectRequest(new Error(`Timed out waiting for ${method}`));
    }, timeout);
    const onMessage = (...args: ReadonlyArray<unknown>) => {
      const raw = rawWsDataFromArgs(args);
      const message = JSON.parse(String(raw));
      if (message.type === "push") return;
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      if (message.error) {
        rejectRequest(Object.assign(new Error(message.error.message), { response: message }));
        return;
      }
      resolveRequest(message.result as T);
    };
    ws.on("message", onMessage);
    ws.send(payload);
  });
}

function waitForPush(
  ws: WsClient,
  channel: string,
  predicate: (message: PushEnvelope) => boolean,
  timeout = 45_000,
): Promise<PushEnvelope> {
  return new Promise((resolvePush, rejectPush) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      rejectPush(new Error(`Timed out waiting for push ${channel}`));
    }, timeout);
    const onMessage = (...args: ReadonlyArray<unknown>) => {
      const raw = rawWsDataFromArgs(args);
      const message = JSON.parse(String(raw));
      if (message.type !== "push" || message.channel !== channel) return;
      const envelope = { channel: message.channel, data: message.data };
      if (!predicate(envelope)) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolvePush(envelope);
    };
    ws.on("message", onMessage);
  });
}

async function connectWs(): Promise<WsClient> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.once("open", () => resolveOpen());
    ws.once("error", rejectOpen);
  });
  await waitForPush(ws, "server.welcome", () => true, 10_000);
  return ws;
}

async function waitFor<T>(
  label: string,
  predicate: () => Promise<T | null>,
  timeout = 45_000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = await predicate();
    if (value !== null) {
      return value;
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForOllamaReady(ws: WsClient): Promise<Record<string, unknown>> {
  await wsRequest(ws, "server.updateSettings", {
    patch: buildOllamaSettingsPatch(),
  });
  await wsRequest(ws, "server.refreshProviders");

  return waitFor(
    "reachable Ollama provider",
    async () => {
      const config = await wsRequest<Record<string, unknown>>(ws, "server.getConfig");
      const providers = Array.isArray(config.providers) ? config.providers : [];
      const provider = providers.find(
        (candidate) => isRecord(candidate) && candidate.provider === "ollamaLocal",
      );
      if (!isRecord(provider)) {
        return null;
      }
      const ready =
        provider.enabled === true &&
        provider.installed === true &&
        (provider.status === "ready" || provider.status === "warning");
      if (!ready) {
        return null;
      }
      return provider;
    },
    timeoutMs,
  );
}

function deriveModelLabel(provider: Record<string, unknown>, model: string): string {
  const models = Array.isArray(provider.models) ? provider.models : [];
  const live = models.find(
    (candidate) => isRecord(candidate) && candidate.slug === model && hasText(candidate.name),
  );
  return live && hasText(live.name) ? live.name : model;
}

function commandMatchesTurnStart(
  candidate: Record<string, unknown>,
  threadId: string,
  provider: string,
  model: string,
): boolean {
  if (candidate.type !== "thread.turn.start" || candidate.threadId !== threadId) {
    return false;
  }
  const selection = candidate.modelSelection;
  return isRecord(selection) && selection.provider === provider && selection.model === model;
}

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeJson("run-metadata.json", {
    startedAt: nowIso(),
    webBaseUrl,
    serverBaseUrl,
    wsUrl,
    ollamaBaseUrl,
    ollamaModel,
    ollamaCodexProfileName,
    ollamaCodexHomePath,
  });

  const health = await fetch(`${serverBaseUrl}/health/ready`).catch(() => null);
  if (health?.status !== 200) {
    throw new Error(`T3 server is not ready at ${serverBaseUrl}`);
  }

  const ws = await connectWs();
  const browser = await chromium.launch({ headless: true });
  try {
    const provider = await waitForOllamaReady(ws);
    const modelLabel = deriveModelLabel(provider, ollamaModel);
    const createdAt = nowIso();
    const projectId = `project-ollama-smoke-${Date.now()}`;
    const threadId = `thread-ollama-smoke-${Date.now()}`;
    const projectRoot = resolve(outDir, "workspace");
    const toolProbePath = resolve(projectRoot, "smoke-tool.txt");
    const toolProbeContents = "smoke-tool-ok";
    await mkdir(projectRoot, { recursive: true });
    await writeFile(resolve(projectRoot, "README.md"), "# ollama smoke\n");

    const config = await wsRequest<Record<string, unknown>>(ws, "server.getConfig");
    const providers = Array.isArray(config.providers) ? config.providers : [];
    const codexProvider = providers.find(
      (candidate) => isRecord(candidate) && candidate.provider === "codex",
    );
    const codexModel =
      isRecord(codexProvider) &&
      Array.isArray(codexProvider.models) &&
      codexProvider.models.length > 0 &&
      isRecord(codexProvider.models[0]) &&
      hasText(codexProvider.models[0].slug)
        ? codexProvider.models[0].slug
        : "gpt-5.4";

    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "project.create",
        commandId: `cmd-${projectId}`,
        projectId,
        title: "Ollama selection smoke",
        workspaceRoot: projectRoot,
        defaultModelSelection: { provider: "codex", model: codexModel },
        createdAt,
      },
    });
    await wsRequest(ws, "orchestration.dispatchCommand", {
      command: {
        type: "thread.create",
        commandId: `cmd-${threadId}`,
        threadId,
        projectId,
        title: "Ollama selection smoke thread",
        modelSelection: { provider: "codex", model: codexModel },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      },
    });

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await page.addInitScript({ content: makeRecorderInitScript() });
      await page.goto(`${webBaseUrl}/${threadId}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.locator('[data-testid="composer-editor"]').waitFor({
        state: "visible",
        timeout: 60_000,
      });

      const pickerTrigger = page.locator('[data-testid="provider-model-picker-trigger"]');
      await pickerTrigger.click({ timeout: 10_000 });
      const ollamaMenuItem = page.getByRole("menuitem", { name: /Ollama/ });
      await ollamaMenuItem.hover({ timeout: 10_000 });
      await page.getByRole("menuitemradio", { name: modelLabel }).click({ timeout: 10_000 });

      await waitFor(
        "provider picker label update",
        async () => {
          const text = await pickerTrigger.textContent();
          return text?.includes(modelLabel) ? text : null;
        },
        15_000,
      );

      const composer = page.locator('[data-testid="composer-editor"]');
      await composer.click({ timeout: 10_000 });
      await composer.fill(
        `Use the exec_command tool to run exactly this shell command: printf ${toolProbeContents} > ${toolProbePath}. After running it, reply with exactly ${toolProbeContents}.`,
        { timeout: 10_000 },
      );
      const browserSubmit = Date.now();
      await page.locator('[data-chat-composer-form="true"]').evaluate((element: unknown) => {
        const candidate = element as { requestSubmit?: () => void };
        candidate.requestSubmit?.();
      });

      const proof = await waitFor(
        "ollama-backed turn completion",
        async () => {
          const rawFrames = await page.evaluate<readonly unknown[]>(
            () =>
              (globalThis as unknown as { __t3PerfWsLog?: readonly unknown[] }).__t3PerfWsLog ?? [],
          );
          const frames = normalizeBrowserWsFrames(rawFrames);
          const exchanges = pairRpcExchanges(frames);
          const dispatch = exchanges.find((exchange) => {
            if (exchange.method !== "orchestration.dispatchCommand") {
              return false;
            }
            return (
              isRecord(exchange.requestBody.command) &&
              commandMatchesTurnStart(
                exchange.requestBody.command,
                threadId,
                "ollamaLocal",
                ollamaModel,
              )
            );
          });
          const events = extractDomainEvents(frames).map((entry) => entry.event);
          const toolStarted = events.find(
            (event) =>
              event.type === "thread.activity-appended" &&
              isRecord(event.payload) &&
              event.payload.threadId === threadId &&
              isRecord(event.payload.activity) &&
              event.payload.activity.kind === "tool.started",
          );
          const toolCompleted = events.find(
            (event) =>
              event.type === "thread.activity-appended" &&
              isRecord(event.payload) &&
              event.payload.threadId === threadId &&
              isRecord(event.payload.activity) &&
              event.payload.activity.kind === "tool.completed",
          );
          const runningEvent = events.find(
            (event) =>
              event.type === "thread.session-set" &&
              isRecord(event.payload) &&
              event.payload.threadId === threadId &&
              isRecord(event.payload.session) &&
              event.payload.session.providerName === "ollamaLocal" &&
              event.payload.session.status === "running",
          );
          const assistantFinal = events.find(
            (event) =>
              event.type === "thread.message-sent" &&
              isRecord(event.payload) &&
              event.payload.threadId === threadId &&
              event.payload.role === "assistant" &&
              event.payload.streaming !== true,
          );
          const readyEvent = events.find(
            (event) =>
              event.type === "thread.session-set" &&
              isRecord(event.payload) &&
              event.payload.threadId === threadId &&
              isRecord(event.payload.session) &&
              event.payload.session.providerName === "ollamaLocal" &&
              event.payload.session.status === "ready" &&
              event.payload.session.activeTurnId == null,
          );
          const probeFileText = await readFile(toolProbePath, "utf8").catch(() => null);
          if (!runningEvent || !readyEvent || !toolStarted || !toolCompleted) {
            const thread = await wsRequest<Record<string, unknown> | null>(
              ws,
              "orchestration.getThreadById",
              { threadId },
            );
            if (!thread || !isRecord(thread)) {
              return null;
            }
            const session = isRecord(thread.session) ? thread.session : null;
            const messages = await wsRequest<ReadonlyArray<unknown>>(
              ws,
              "orchestration.listThreadMessages",
              { threadId, limit: 100 },
            );
            const serverAssistantFinal =
              messages.find(
                (message) =>
                  isRecord(message) &&
                  message.role === "assistant" &&
                  message.streaming !== true &&
                  hasText(message.text),
              ) ??
              messages.find(
                (message) =>
                  isRecord(message) && message.role === "assistant" && message.streaming !== true,
              );
            const activities = Array.isArray(thread.activities) ? thread.activities : [];
            const serverToolStarted = activities.find(
              (activity) =>
                isRecord(activity) && activity.kind === "tool.started" && activity.turnId != null,
            );
            const serverToolCompleted = activities.find(
              (activity) =>
                isRecord(activity) && activity.kind === "tool.completed" && activity.turnId != null,
            );
            if (
              !session ||
              session.providerName !== "ollamaLocal" ||
              session.status !== "ready" ||
              session.activeTurnId != null ||
              !serverToolStarted ||
              !serverToolCompleted ||
              probeFileText !== toolProbeContents
            ) {
              return null;
            }
            return {
              source: "server-state",
              browserSubmit,
              dispatch: dispatch ?? null,
              assistantFinal: serverAssistantFinal,
              session,
              toolStarted: serverToolStarted,
              toolCompleted: serverToolCompleted,
              toolProbePath,
              toolProbeContents: probeFileText,
              frameCount: frames.length,
            };
          }
          if (probeFileText !== toolProbeContents) {
            return null;
          }
          return {
            source: "browser-ws",
            browserSubmit,
            dispatch,
            toolStarted,
            toolCompleted,
            runningEvent,
            assistantFinal,
            readyEvent,
            toolProbePath,
            toolProbeContents: probeFileText,
            frameCount: frames.length,
          };
        },
        timeoutMs,
      );

      await writeJson("summary.json", {
        ok: true,
        finishedAt: nowIso(),
        webBaseUrl,
        serverBaseUrl,
        ollamaBaseUrl,
        threadId,
        projectId,
        modelLabel,
        proof,
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            webBaseUrl,
            serverBaseUrl,
            threadId,
            projectId,
            provider: "ollamaLocal",
            model: ollamaModel,
            modelLabel,
            outDir,
          },
          null,
          2,
        ),
      );
    } finally {
      await page.close();
    }
  } finally {
    ws.close();
    await browser.close();
  }
}

await main();
