import * as Http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  PlatformError,
  PubSub,
  Scope,
  Stream,
} from "effect";
import { describe, expect, it, afterEach, vi } from "vitest";
import { createServer } from "./wsServer";
import WebSocket from "ws";
import { deriveServerPaths, ServerConfig, type ServerConfigShape } from "./config";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";

import {
  DEFAULT_TERMINAL_ID,
  DEFAULT_SERVER_SETTINGS,
  EDITORS,
  EventId,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  ProviderItemId,
  type ServerSettings,
  ThreadId,
  TurnId,
  WS_CHANNELS,
  WS_METHODS,
  type WebSocketResponse,
  type ProviderRuntimeEvent,
  type ServerProvider,
  type KeybindingsConfig,
  type ResolvedKeybindingsConfig,
  type WsPushChannel,
  type WsPushMessage,
  type WsPush,
} from "@t3tools/contracts";
import {
  WS_CHANNELS as AGENT_WS_CHANNELS,
  WS_METHODS as AGENT_WS_METHODS,
  type AgentProtocolMeta,
  type AgentServerPush,
  type AgentServerResponse,
} from "@agent-runtime/contracts";
import { compileResolvedKeybindingRule, DEFAULT_KEYBINDINGS } from "./keybindings";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "@t3tools/contracts";
import { TerminalManager, type TerminalManagerShape } from "./terminal/Services/Manager";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./persistence/Layers/Sqlite";
import { SqlClient, SqlError } from "effect/unstable/sql";
import { ProviderService, type ProviderServiceShape } from "./provider/Services/ProviderService";
import { ProviderRegistry, type ProviderRegistryShape } from "./provider/Services/ProviderRegistry";
import { Open, type OpenShape } from "./open";
import { GitManager, type GitManagerShape } from "./git/Services/GitManager.ts";
import type { GitCoreShape } from "./git/Services/GitCore.ts";
import { GitCore } from "./git/Services/GitCore.ts";
import { GitCommandError, GitManagerError } from "./git/Errors.ts";
import { MigrationError } from "@effect/sql-sqlite-bun/SqliteMigrator";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { ServerSettingsService } from "./serverSettings.ts";

vi.mock("node-pty", () => ({
  spawn: () => ({
    pid: 4242,
    write: () => {},
    resize: () => {},
    kill: () => {},
    onData: () => () => {},
    onExit: () => () => {},
  }),
}));

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProviderItemId = (value: string): ProviderItemId => ProviderItemId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

const defaultOpenService: OpenShape = {
  openBrowser: () => Effect.void,
  openInEditor: () => Effect.void,
};

const defaultProviderStatuses: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
  },
];
const CONFIG_UPDATED_HELPER_TIMEOUT_MS = 3_000;
const CONFIG_UPDATED_HELPER_ATTEMPTS = 3;
const CONFIG_UPDATED_HELPER_RETRY_DELAY_MS = 250;

const defaultProviderRegistryService: ProviderRegistryShape = {
  getProviders: Effect.succeed(defaultProviderStatuses),
  refresh: () => Effect.succeed(defaultProviderStatuses),
  streamChanges: Stream.empty,
};

const defaultServerSettings = DEFAULT_SERVER_SETTINGS;
const AGENT_SESSION_TOKEN_SECRET = "agent-session-token-test-secret";
const AGENT_SESSION_TOKEN_SIGNATURE_ALGORITHM = "sha256";
const DEFAULT_AGENT_CAPABILITIES = ["recurring-quotes", "quote-search", "render-table"] as const;

function normalizeAgentSessionTokenPayload(payload: {
  tenantId: string;
  userId: string;
  sessionId: string;
  conversationId: string;
  capabilities?: string[];
  lastSeenSequence?: number;
  exp?: number;
}): string {
  return JSON.stringify({
    tenantId: payload.tenantId,
    userId: payload.userId,
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
    ...(payload.lastSeenSequence !== undefined
      ? { lastSeenSequence: payload.lastSeenSequence }
      : {}),
    ...(payload.exp !== undefined ? { exp: payload.exp } : {}),
    ...(payload.capabilities ? { capabilities: payload.capabilities } : {}),
  });
}

function makeAgentSessionTokenFromPayload(
  payload: {
    tenantId: string;
    userId: string;
    sessionId: string;
    conversationId: string;
    capabilities?: string[];
    lastSeenSequence?: number;
    exp?: number;
  },
  signingKey = AGENT_SESSION_TOKEN_SECRET,
): string {
  const signature = createHmac(AGENT_SESSION_TOKEN_SIGNATURE_ALGORITHM, signingKey)
    .update(normalizeAgentSessionTokenPayload(payload))
    .digest("hex");
  return JSON.stringify({ ...payload, signature });
}

function makeAgentSessionToken(
  overrides: {
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    conversationId?: string;
    capabilities?: string[];
    lastSeenSequence?: number;
    exp?: number;
  } = {},
  signingKey = AGENT_SESSION_TOKEN_SECRET,
): string {
  const tokenPayload = {
    tenantId: overrides.tenantId ?? "tenant-1",
    userId: overrides.userId ?? "user-1",
    sessionId: overrides.sessionId ?? "agent-session-boot",
    conversationId: overrides.conversationId ?? "agent-conversation-boot",
    capabilities: overrides.capabilities ?? ["recurring-quotes", "quote-search"],
    ...(overrides.lastSeenSequence !== undefined
      ? { lastSeenSequence: overrides.lastSeenSequence }
      : {}),
    ...(overrides.lastSeenSequence !== undefined
      ? { lastSeenSequence: overrides.lastSeenSequence }
      : {}),
    ...(overrides.exp !== undefined ? { exp: overrides.exp } : {}),
  };
  return makeAgentSessionTokenFromPayload(tokenPayload, signingKey);
}

class MockTerminalManager implements TerminalManagerShape {
  private readonly sessions = new Map<string, TerminalSessionSnapshot>();
  private readonly eventPubSub = Effect.runSync(PubSub.unbounded<TerminalEvent>());
  private activeSubscriptions = 0;

  private key(threadId: string, terminalId: string): string {
    return `${threadId}\u0000${terminalId}`;
  }

  emitEvent(event: TerminalEvent): void {
    Effect.runSync(PubSub.publish(this.eventPubSub, event));
  }

  subscriptionCount(): number {
    return this.activeSubscriptions;
  }

  readonly open: TerminalManagerShape["open"] = (input: TerminalOpenInput) =>
    Effect.sync(() => {
      const now = new Date().toISOString();
      const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
      const snapshot: TerminalSessionSnapshot = {
        threadId: input.threadId,
        terminalId,
        cwd: input.cwd,
        status: "running",
        pid: 4242,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: now,
      };
      this.sessions.set(this.key(input.threadId, terminalId), snapshot);
      queueMicrotask(() => {
        this.emitEvent({
          type: "started",
          threadId: input.threadId,
          terminalId,
          createdAt: now,
          snapshot,
        });
      });
      return snapshot;
    });

  readonly write: TerminalManagerShape["write"] = (input: TerminalWriteInput) =>
    Effect.sync(() => {
      const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
      const existing = this.sessions.get(this.key(input.threadId, terminalId));
      if (!existing) {
        throw new Error(`Unknown terminal thread: ${input.threadId}`);
      }
      queueMicrotask(() => {
        this.emitEvent({
          type: "output",
          threadId: input.threadId,
          terminalId,
          createdAt: new Date().toISOString(),
          data: input.data,
        });
      });
    });

  readonly resize: TerminalManagerShape["resize"] = (_input: TerminalResizeInput) => Effect.void;

  readonly clear: TerminalManagerShape["clear"] = (input: TerminalClearInput) =>
    Effect.sync(() => {
      const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
      queueMicrotask(() => {
        this.emitEvent({
          type: "cleared",
          threadId: input.threadId,
          terminalId,
          createdAt: new Date().toISOString(),
        });
      });
    });

  readonly restart: TerminalManagerShape["restart"] = (input: TerminalOpenInput) =>
    Effect.sync(() => {
      const now = new Date().toISOString();
      const terminalId = input.terminalId ?? DEFAULT_TERMINAL_ID;
      const snapshot: TerminalSessionSnapshot = {
        threadId: input.threadId,
        terminalId,
        cwd: input.cwd,
        status: "running",
        pid: 5252,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: now,
      };
      this.sessions.set(this.key(input.threadId, terminalId), snapshot);
      queueMicrotask(() => {
        this.emitEvent({
          type: "restarted",
          threadId: input.threadId,
          terminalId,
          createdAt: now,
          snapshot,
        });
      });
      return snapshot;
    });

  readonly close: TerminalManagerShape["close"] = (input: TerminalCloseInput) =>
    Effect.sync(() => {
      if (input.terminalId) {
        this.sessions.delete(this.key(input.threadId, input.terminalId));
        return;
      }
      for (const key of this.sessions.keys()) {
        if (key.startsWith(`${input.threadId}\u0000`)) {
          this.sessions.delete(key);
        }
      }
    });

  readonly subscribe: TerminalManagerShape["subscribe"] = (listener) =>
    Effect.sync(() => {
      this.activeSubscriptions += 1;
      const fiber = Effect.runFork(
        Stream.runForEach(Stream.fromPubSub(this.eventPubSub), (event) => listener(event)),
      );
      return () => {
        this.activeSubscriptions -= 1;
        Effect.runFork(Fiber.interrupt(fiber).pipe(Effect.ignore));
      };
    });
}

// ---------------------------------------------------------------------------
// WebSocket test harness
//
// Incoming messages are split into two channels:
//   - pushChannel: server push envelopes (type === "push")
//   - responseChannel: request/response envelopes (have an "id" field)
//
// This means sendRequest never has to skip push messages and waitForPush
// never has to skip response messages, eliminating a class of ordering bugs.
// ---------------------------------------------------------------------------

interface MessageChannel<T> {
  queue: T[];
  waiters: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>;
}

interface SocketChannels {
  push: MessageChannel<WsPush>;
  response: MessageChannel<WebSocketResponse>;
}

interface AgentMessageChannel<T> {
  queue: T[];
  waiters: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>;
}

interface AgentSocketChannels {
  push: AgentMessageChannel<AgentServerPush>;
  response: AgentMessageChannel<AgentServerResponse>;
}

const channelsBySocket = new WeakMap<WebSocket, SocketChannels>();
const agentChannelsBySocket = new WeakMap<WebSocket, AgentSocketChannels>();

function enqueue<T>(channel: MessageChannel<T>, item: T) {
  const waiter = channel.waiters.shift();
  if (waiter) {
    if (waiter.timeoutId !== null) clearTimeout(waiter.timeoutId);
    waiter.resolve(item);
    return;
  }
  channel.queue.push(item);
}

function dequeue<T>(channel: MessageChannel<T>, timeoutMs: number): Promise<T> {
  const queued = channel.queue.shift();
  if (queued !== undefined) {
    return Promise.resolve(queued);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timeoutId: setTimeout(() => {
        const index = channel.waiters.indexOf(waiter);
        if (index >= 0) channel.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for WebSocket message after ${timeoutMs}ms`));
      }, timeoutMs) as ReturnType<typeof setTimeout>,
    };
    channel.waiters.push(waiter);
  });
}

function isWsPushEnvelope(message: unknown): message is WsPush {
  if (typeof message !== "object" || message === null) return false;
  if (!("type" in message) || !("channel" in message)) return false;
  return (message as { type?: unknown }).type === "push";
}

function isAgentPushEnvelope(message: unknown): message is AgentServerPush {
  if (typeof message !== "object" || message === null) return false;
  if (!("metadata" in message) || !("channel" in message)) return false;
  return !("id" in message) && typeof (message as { channel?: unknown }).channel === "string";
}

function asWebSocketResponse(message: unknown): WebSocketResponse | null {
  if (typeof message !== "object" || message === null) return null;
  if (!("id" in message)) return null;
  const id = (message as { id?: unknown }).id;
  if (typeof id !== "string") return null;
  return message as WebSocketResponse;
}

function asAgentResponse(message: unknown): AgentServerResponse | null {
  if (typeof message !== "object" || message === null) return null;
  if (!("id" in message)) return null;
  const id = (message as { id?: unknown }).id;
  if (typeof id !== "string") return null;
  return message as AgentServerResponse;
}

function sleepMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function makeAlternateKeybindingsContents(contents: string): string {
  try {
    JSON.parse(contents);
    return "{ not-json";
  } catch {
    return "[]";
  }
}

function connectWsOnce(port: number, token?: string, route = "/"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}${query}`);
    const channels: SocketChannels = {
      push: { queue: [], waiters: [] },
      response: { queue: [], waiters: [] },
    };
    channelsBySocket.set(ws, channels);

    ws.on("message", (raw) => {
      const parsed = JSON.parse(String(raw));
      if (isWsPushEnvelope(parsed)) {
        enqueue(channels.push, parsed);
      } else {
        const response = asWebSocketResponse(parsed);
        if (response) {
          enqueue(channels.response, response);
        }
      }
    });

    ws.once("open", () => resolve(ws));
    ws.once("error", () => reject(new Error("WebSocket connection failed")));
  });
}

async function connectWs(port: number, token?: string, attempts = 5): Promise<WebSocket> {
  let lastError: unknown = new Error("WebSocket connection failed");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await connectWsOnce(port, token);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  throw lastError;
}

async function connectAgentWs(port: number, token?: string, attempts = 5): Promise<WebSocket> {
  let lastError: unknown = new Error("WebSocket connection failed");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await connectAgentWsOnce(port, token);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  throw lastError;
}

function connectAgentWsOnce(port: number, token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent${query}`);
    const channels: AgentSocketChannels = {
      push: { queue: [], waiters: [] },
      response: { queue: [], waiters: [] },
    };
    agentChannelsBySocket.set(ws, channels);

    ws.on("message", (raw) => {
      const parsed = JSON.parse(String(raw));
      if (isAgentPushEnvelope(parsed)) {
        enqueue(channels.push, parsed);
      } else {
        const response = asAgentResponse(parsed);
        if (response) {
          enqueue(channels.response, response);
        }
      }
    });

    ws.once("open", () => resolve(ws));
    ws.once("error", () => reject(new Error("WebSocket connection failed")));
    ws.once("close", (code, reason) => {
      reject(new Error(`WebSocket connection closed: ${code} ${reason.toString()}`));
    });
  });
}

/** Connect and wait for the server.welcome push. Returns [ws, welcomeData]. */
async function connectAndAwaitWelcome(
  port: number,
  token?: string,
): Promise<[WebSocket, WsPushMessage<typeof WS_CHANNELS.serverWelcome>]> {
  const ws = await connectWs(port, token);
  const welcome = await waitForPush(ws, WS_CHANNELS.serverWelcome);
  return [ws, welcome];
}

async function connectAndAwaitAgentWelcome(
  port: number,
  token: string,
): Promise<[WebSocket, AgentServerPush]> {
  const ws = await connectAgentWs(port, token);
  const welcome = await waitForAgentPush(
    ws,
    AGENT_WS_CHANNELS.sessionWelcome,
    (push) => push.channel === AGENT_WS_CHANNELS.sessionWelcome,
  );
  return [ws, welcome];
}

async function sendRequest(
  ws: WebSocket,
  method: string,
  params?: unknown,
): Promise<WebSocketResponse> {
  const channels = channelsBySocket.get(ws);
  if (!channels) throw new Error("WebSocket not initialized");

  const id = crypto.randomUUID();
  const body =
    method === ORCHESTRATION_WS_METHODS.dispatchCommand
      ? { _tag: method, command: params }
      : params && typeof params === "object" && !Array.isArray(params)
        ? { _tag: method, ...(params as Record<string, unknown>) }
        : { _tag: method };
  ws.send(JSON.stringify({ id, body }));

  // Response channel only contains responses — no push filtering needed
  while (true) {
    const response = await dequeue(channels.response, 60_000);
    if (response.id === id || response.id === "unknown") {
      return response;
    }
  }
}

async function sendAgentRequest(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown> = {},
  metadata: Partial<AgentProtocolMeta> = {},
): Promise<AgentServerResponse> {
  const channels = agentChannelsBySocket.get(ws);
  if (!channels) throw new Error("Agent websocket not initialized");

  const id = crypto.randomUUID();
  const metadataPayload = {
    protocolVersion: 1,
    sessionId: "agent-session-1",
    conversationId: "agent-conversation-1",
    turnId: "turn-1",
    eventId: `agent-event-${id}`,
    sequence: 1,
    timestamp: new Date().toISOString(),
    ...metadata,
  };
  ws.send(
    JSON.stringify({
      id,
      metadata: metadataPayload,
      payload: { _tag: method, ...params },
    }),
  );

  while (true) {
    const response = await dequeue(channels.response, 60_000);
    if (response.id === id || response.id === "unknown") {
      return response;
    }
  }
}

async function waitForAgentPush(
  ws: WebSocket,
  channel: string,
  predicate?: (push: AgentServerPush) => boolean,
  maxMessages = 120,
  idleTimeoutMs = 5_000,
): Promise<AgentServerPush> {
  const channels = agentChannelsBySocket.get(ws);
  if (!channels) throw new Error("Agent websocket not initialized");

  for (let remaining = maxMessages; remaining > 0; remaining--) {
    const push = await dequeue(channels.push, idleTimeoutMs);
    if (push.channel !== channel) continue;
    if (!predicate || predicate(push)) return push;
  }
  throw new Error(`Timed out waiting for agent push on ${channel}`);
}

async function waitForPush<C extends WsPushChannel>(
  ws: WebSocket,
  channel: C,
  predicate?: (push: WsPushMessage<C>) => boolean,
  maxMessages = 120,
  idleTimeoutMs = 5_000,
): Promise<WsPushMessage<C>> {
  const channels = channelsBySocket.get(ws);
  if (!channels) throw new Error("WebSocket not initialized");

  for (let remaining = maxMessages; remaining > 0; remaining--) {
    const push = await dequeue(channels.push, idleTimeoutMs);
    if (push.channel !== channel) continue;
    const typed = push as WsPushMessage<C>;
    if (!predicate || predicate(typed)) return typed;
  }
  throw new Error(`Timed out waiting for push on ${channel}`);
}

async function rewriteKeybindingsAndWaitForPush(
  ws: WebSocket,
  keybindingsPath: string,
  contents: string,
  predicate: (push: WsPushMessage<typeof WS_CHANNELS.serverConfigUpdated>) => boolean,
  attempts = CONFIG_UPDATED_HELPER_ATTEMPTS,
): Promise<WsPushMessage<typeof WS_CHANNELS.serverConfigUpdated>> {
  const alternateContents = makeAlternateKeybindingsContents(contents);

  const clearQueuedConfigUpdatedPushes = () => {
    const channels = channelsBySocket.get(ws);
    if (!channels) return;
    channels.push.queue = channels.push.queue.filter(
      (queued) => queued.channel !== WS_CHANNELS.serverConfigUpdated,
    );
  };

  // Give the server keybindings poll loop a chance to hydrate its internal baseline
  // before we rewrite the file, which prevents missing the first change signal.
  await sleepMs(CONFIG_UPDATED_HELPER_RETRY_DELAY_MS);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    clearQueuedConfigUpdatedPushes();
    if (alternateContents !== contents) {
      fs.writeFileSync(keybindingsPath, alternateContents, "utf8");
      await sleepMs(25);
    }
    fs.writeFileSync(keybindingsPath, contents, "utf8");
    try {
      const push = await waitForPush(
        ws,
        WS_CHANNELS.serverConfigUpdated,
        predicate,
        48,
        CONFIG_UPDATED_HELPER_TIMEOUT_MS,
      );
      return push;
    } catch (error) {
      lastError = error;
      await sleepMs(CONFIG_UPDATED_HELPER_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function requestPath(
  port: number,
  requestPath: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = Http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method: "GET",
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.once("error", reject);
    req.end();
  });
}

function compileKeybindings(bindings: KeybindingsConfig): ResolvedKeybindingsConfig {
  const resolved: Array<ResolvedKeybindingsConfig[number]> = [];
  for (const binding of bindings) {
    const compiled = compileResolvedKeybindingRule(binding);
    if (!compiled) {
      throw new Error(`Unexpected invalid keybinding in test setup: ${binding.command}`);
    }
    resolved.push(compiled);
  }
  return resolved;
}

const DEFAULT_RESOLVED_KEYBINDINGS = compileKeybindings([...DEFAULT_KEYBINDINGS]);
const VALID_EDITOR_IDS = new Set(EDITORS.map((editor) => editor.id));

function expectAvailableEditors(value: unknown): void {
  expect(Array.isArray(value)).toBe(true);
  for (const editorId of value as unknown[]) {
    expect(typeof editorId).toBe("string");
    expect(VALID_EDITOR_IDS.has(editorId as (typeof EDITORS)[number]["id"])).toBe(true);
  }
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function deriveServerPathsSync(baseDir: string, devUrl: URL | undefined) {
  return Effect.runSync(
    deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)),
  );
}

describe("WebSocket Server", () => {
  let server: Http.Server | null = null;
  let serverScope: Scope.Closeable | null = null;
  let disposeServerRuntime: (() => Promise<void>) | null = null;
  const connections: WebSocket[] = [];
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function createTestServer(
    options: {
      persistenceLayer?: Layer.Layer<
        SqlClient.SqlClient,
        SqlError.SqlError | MigrationError | PlatformError.PlatformError
      >;
      cwd?: string;
      autoBootstrapProjectFromCwd?: boolean;
      logWebSocketEvents?: boolean;
      devUrl?: string;
      authToken?: string;
      baseDir?: string;
      staticDir?: string;
      providerLayer?: Layer.Layer<ProviderService, never>;
      providerRegistry?: ProviderRegistryShape;
      open?: OpenShape;
      gitManager?: GitManagerShape;
      gitCore?: Pick<GitCoreShape, "listBranches" | "initRepo" | "pullCurrentBranch">;
      terminalManager?: TerminalManagerShape;
      serverSettings?: Partial<ServerSettings>;
    } = {},
  ): Promise<Http.Server> {
    if (serverScope) {
      throw new Error("Test server is already running");
    }

    const baseDir = options.baseDir ?? makeTempDir("t3code-ws-base-");
    const devUrl = options.devUrl ? new URL(options.devUrl) : undefined;
    const derivedPaths = deriveServerPathsSync(baseDir, devUrl);
    const scope = await Effect.runPromise(Scope.make("sequential"));
    const persistenceLayer = options.persistenceLayer ?? SqlitePersistenceMemory;
    const providerLayer = options.providerLayer ?? makeServerProviderLayer();
    const providerRegistryLayer = Layer.succeed(
      ProviderRegistry,
      options.providerRegistry ?? defaultProviderRegistryService,
    );
    const openLayer = Layer.succeed(Open, options.open ?? defaultOpenService);
    const nodeServicesLayer = NodeServices.layer;
    const serverSettingsLayer = ServerSettingsService.layerTest(options.serverSettings);
    const serverSettingsRuntimeLayer = serverSettingsLayer.pipe(
      Layer.provideMerge(nodeServicesLayer),
    );
    const analyticsLayer = AnalyticsService.layerTest;
    const serverConfigLayer = Layer.succeed(ServerConfig, {
      mode: "web",
      port: 0,
      host: undefined,
      cwd: options.cwd ?? "/test/project",
      baseDir,
      ...derivedPaths,
      staticDir: options.staticDir,
      devUrl,
      noBrowser: true,
      authToken: options.authToken,
      autoBootstrapProjectFromCwd: options.autoBootstrapProjectFromCwd ?? false,
      logWebSocketEvents: options.logWebSocketEvents ?? Boolean(options.devUrl),
    } satisfies ServerConfigShape);
    const infrastructureLayer = providerLayer.pipe(Layer.provideMerge(persistenceLayer));
    const providerRuntimeLayer = infrastructureLayer.pipe(
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(serverSettingsRuntimeLayer),
      Layer.provideMerge(analyticsLayer),
    );
    const runtimeOverrides = Layer.mergeAll(
      options.gitManager ? Layer.succeed(GitManager, options.gitManager) : Layer.empty,
      options.gitCore
        ? Layer.succeed(GitCore, options.gitCore as unknown as GitCoreShape)
        : Layer.empty,
      options.terminalManager
        ? Layer.succeed(TerminalManager, options.terminalManager)
        : Layer.empty,
    );

    const runtimeLayer = Layer.merge(
      Layer.merge(
        makeServerRuntimeServicesLayer().pipe(
          Layer.provideMerge(providerRuntimeLayer),
          Layer.provideMerge(serverConfigLayer),
          Layer.provideMerge(serverSettingsRuntimeLayer),
          Layer.provideMerge(analyticsLayer),
          Layer.provideMerge(nodeServicesLayer),
        ),
        Layer.mergeAll(providerRuntimeLayer, serverSettingsRuntimeLayer, analyticsLayer),
      ),
      runtimeOverrides,
    );
    const dependenciesLayer = Layer.mergeAll(
      runtimeLayer,
      providerRegistryLayer,
      openLayer,
      serverConfigLayer,
      nodeServicesLayer,
    );
    const runtime = ManagedRuntime.make(dependenciesLayer);
    try {
      const httpServer = await runtime.runPromise(createServer().pipe(Scope.provide(scope)));
      disposeServerRuntime = () => runtime.dispose();
      serverScope = scope;
      return httpServer;
    } catch (error) {
      await runtime.dispose();
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw error;
    }
  }

  async function closeTestServer() {
    if (!serverScope && !disposeServerRuntime) return;
    const scope = serverScope;
    const disposeRuntime = disposeServerRuntime;
    serverScope = null;
    disposeServerRuntime = null;
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    if (disposeRuntime) {
      await disposeRuntime();
    }
  }

  afterEach(async () => {
    for (const ws of connections) {
      ws.close();
    }
    connections.length = 0;
    await closeTestServer();
    server = null;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("sends welcome message on connect", async () => {
    server = await createTestServer({ cwd: "/test/project" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const [ws, welcome] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    expect(welcome.data).toEqual({
      cwd: "/test/project",
      projectName: "project",
    });
  });

  it("serves persisted attachments from stateDir", async () => {
    const baseDir = makeTempDir("t3code-state-attachments-");
    const { attachmentsDir } = deriveServerPathsSync(baseDir, undefined);
    const attachmentPath = path.join(attachmentsDir, "thread-a", "message-a", "0.png");
    fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
    fs.writeFileSync(attachmentPath, Buffer.from("hello-attachment"));

    server = await createTestServer({ cwd: "/test/project", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${port}/attachments/thread-a/message-a/0.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes).toEqual(Buffer.from("hello-attachment"));
  });

  it("serves persisted attachments for URL-encoded paths", async () => {
    const baseDir = makeTempDir("t3code-state-attachments-encoded-");
    const { attachmentsDir } = deriveServerPathsSync(baseDir, undefined);
    const attachmentPath = path.join(
      attachmentsDir,
      "thread%20folder",
      "message%20folder",
      "file%20name.png",
    );
    fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
    fs.writeFileSync(attachmentPath, Buffer.from("hello-encoded-attachment"));

    server = await createTestServer({ cwd: "/test/project", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const response = await fetch(
      `http://127.0.0.1:${port}/attachments/thread%20folder/message%20folder/file%20name.png`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes).toEqual(Buffer.from("hello-encoded-attachment"));
  });

  it("serves static index for root path", async () => {
    const baseDir = makeTempDir("t3code-state-static-root-");
    const staticDir = makeTempDir("t3code-static-root-");
    fs.writeFileSync(path.join(staticDir, "index.html"), "<h1>static-root</h1>", "utf8");

    server = await createTestServer({ cwd: "/test/project", baseDir, staticDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("static-root");
  });

  it("serves lightweight liveness and readiness endpoints", async () => {
    const baseDir = makeTempDir("t3code-state-health-");
    const staticDir = makeTempDir("t3code-static-health-");
    fs.writeFileSync(path.join(staticDir, "index.html"), "<h1>health</h1>", "utf8");

    server = await createTestServer({ cwd: "/test/project", baseDir, staticDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const liveResponse = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.text()).toBe("ok");

    const readyResponse = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.text()).toBe("ready");
  });

  it("rejects static path traversal attempts", async () => {
    const baseDir = makeTempDir("t3code-state-static-traversal-");
    const staticDir = makeTempDir("t3code-static-traversal-");
    fs.writeFileSync(path.join(staticDir, "index.html"), "<h1>safe</h1>", "utf8");

    server = await createTestServer({ cwd: "/test/project", baseDir, staticDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const response = await requestPath(port, "/..%2f..%2fetc/passwd");
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe("Invalid static file path");
  });

  it("bootstraps the cwd project on startup when enabled", async () => {
    server = await createTestServer({
      cwd: "/test/bootstrap-workspace",
      autoBootstrapProjectFromCwd: true,
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const [ws, welcome] = await connectAndAwaitWelcome(port);
    connections.push(ws);
    expect(welcome.data).toEqual(
      expect.objectContaining({
        cwd: "/test/bootstrap-workspace",
        projectName: "bootstrap-workspace",
        bootstrapProjectId: expect.any(String),
        bootstrapThreadId: expect.any(String),
      }),
    );

    const snapshotResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getSnapshot);
    expect(snapshotResponse.error).toBeUndefined();
    const snapshot = snapshotResponse.result as {
      snapshotProfile?: string;
      snapshotCoverage?: {
        includeArchivedThreads: boolean;
      };
      projects: Array<{
        id: string;
        workspaceRoot: string;
        title: string;
        defaultModelSelection: {
          provider: string;
          model: string;
        } | null;
      }>;
      threads: Array<{
        id: string;
        projectId: string;
        title: string;
        modelSelection: {
          provider: string;
          model: string;
        };
        branch: string | null;
        worktreePath: string | null;
      }>;
    };
    const bootstrapProjectId = (welcome.data as { bootstrapProjectId?: string }).bootstrapProjectId;
    const bootstrapThreadId = (welcome.data as { bootstrapThreadId?: string }).bootstrapThreadId;
    expect(bootstrapProjectId).toBeDefined();
    expect(bootstrapThreadId).toBeDefined();
    expect(snapshot.snapshotProfile).toBe("operational");
    expect(snapshot.snapshotCoverage).toEqual(
      expect.objectContaining({
        includeArchivedThreads: true,
      }),
    );

    expect(snapshot.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bootstrapProjectId,
          workspaceRoot: "/test/bootstrap-workspace",
          title: "bootstrap-workspace",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
        }),
      ]),
    );
    expect(snapshot.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bootstrapThreadId,
          projectId: bootstrapProjectId,
          title: "New thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          branch: null,
          worktreePath: null,
        }),
      ]),
    );

    const debugSnapshotResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getSnapshot, {
      profile: "debug-export",
    });
    expect(debugSnapshotResponse.error).toBeUndefined();
    expect(debugSnapshotResponse.result).toEqual(
      expect.objectContaining({
        snapshotProfile: "debug-export",
      }),
    );

    const activeThreadSnapshotResponse = await sendRequest(
      ws,
      ORCHESTRATION_WS_METHODS.getSnapshot,
      {
        profile: "active-thread",
        threadId: bootstrapThreadId,
      },
    );
    expect(activeThreadSnapshotResponse.error).toBeUndefined();
    expect(activeThreadSnapshotResponse.result).toEqual(
      expect.objectContaining({
        snapshotProfile: "active-thread",
        threads: [expect.objectContaining({ id: bootstrapThreadId })],
      }),
    );
  });

  it("serves bounded orchestration read RPCs without requiring a snapshot", async () => {
    server = await createTestServer({
      cwd: "/test/bounded-read-workspace",
      autoBootstrapProjectFromCwd: true,
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const [ws, welcome] = await connectAndAwaitWelcome(port);
    connections.push(ws);
    const bootstrapProjectId = (welcome.data as { bootstrapProjectId?: string }).bootstrapProjectId;
    const bootstrapThreadId = (welcome.data as { bootstrapThreadId?: string }).bootstrapThreadId;
    expect(bootstrapProjectId).toBeDefined();
    expect(bootstrapThreadId).toBeDefined();

    const readinessResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getReadiness);
    expect(readinessResponse.error).toBeUndefined();
    expect(readinessResponse.result).toEqual(
      expect.objectContaining({
        projectCount: 1,
        threadCount: 1,
      }),
    );

    const projectResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getProjectByWorkspace, {
      workspaceRoot: "/test/bounded-read-workspace",
    });
    expect(projectResponse.error).toBeUndefined();
    expect(projectResponse.result).toEqual(
      expect.objectContaining({
        id: bootstrapProjectId,
        workspaceRoot: "/test/bounded-read-workspace",
        title: "bounded-read-workspace",
      }),
    );

    const threadsResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.listProjectThreads, {
      projectId: bootstrapProjectId,
    });
    expect(threadsResponse.error).toBeUndefined();
    expect(threadsResponse.result).toEqual([
      expect.objectContaining({
        id: bootstrapThreadId,
        projectId: bootstrapProjectId,
        title: "New thread",
      }),
    ]);

    const sessionThreadsResponse = await sendRequest(
      ws,
      ORCHESTRATION_WS_METHODS.listSessionThreads,
      {
        rootThreadId: bootstrapThreadId,
      },
    );
    expect(sessionThreadsResponse.error).toBeUndefined();
    expect(sessionThreadsResponse.result).toEqual([
      expect.objectContaining({
        id: bootstrapThreadId,
        projectId: bootstrapProjectId,
        title: "New thread",
      }),
    ]);

    const bootstrapSummaryResponse = await sendRequest(
      ws,
      ORCHESTRATION_WS_METHODS.getBootstrapSummary,
    );
    expect(bootstrapSummaryResponse.error).toBeUndefined();
    expect(bootstrapSummaryResponse.result).toEqual(
      expect.objectContaining({
        projects: expect.arrayContaining([
          expect.objectContaining({
            id: bootstrapProjectId,
          }),
        ]),
        threads: expect.arrayContaining([
          expect.objectContaining({
            id: bootstrapThreadId,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
          }),
        ]),
      }),
    );
  });

  it("includes bootstrap ids in welcome when cwd project and thread already exist", async () => {
    const baseDir = makeTempDir("t3code-state-bootstrap-existing-");
    const { dbPath } = deriveServerPathsSync(baseDir, undefined);
    const persistenceLayer = makeSqlitePersistenceLive(dbPath).pipe(
      Layer.provide(NodeServices.layer),
    );
    const cwd = "/test/bootstrap-existing";

    server = await createTestServer({
      cwd,
      baseDir,
      persistenceLayer,
      autoBootstrapProjectFromCwd: true,
    });
    let addr = server.address();
    let port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const [firstWs, firstWelcome] = await connectAndAwaitWelcome(port);
    connections.push(firstWs);
    const firstBootstrapProjectId = (firstWelcome.data as { bootstrapProjectId?: string })
      .bootstrapProjectId;
    const firstBootstrapThreadId = (firstWelcome.data as { bootstrapThreadId?: string })
      .bootstrapThreadId;
    expect(firstBootstrapProjectId).toBeDefined();
    expect(firstBootstrapThreadId).toBeDefined();

    firstWs.close();
    await closeTestServer();
    server = null;

    server = await createTestServer({
      cwd,
      baseDir,
      persistenceLayer,
      autoBootstrapProjectFromCwd: true,
    });
    addr = server.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const [secondWs, secondWelcome] = await connectAndAwaitWelcome(port);
    connections.push(secondWs);
    expect(secondWelcome.data).toEqual(
      expect.objectContaining({
        cwd,
        projectName: "bootstrap-existing",
        bootstrapProjectId: firstBootstrapProjectId,
        bootstrapThreadId: firstBootstrapThreadId,
      }),
    );
  });

  it("logs outbound websocket push events in dev mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Keep test output clean while verifying websocket logs.
    });

    server = await createTestServer({
      cwd: "/test/project",
      devUrl: "http://localhost:5173",
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    expect(
      logSpy.mock.calls.some(([message]) => {
        if (typeof message !== "string") return false;
        return (
          message.includes("[ws]") &&
          message.includes("outgoing push") &&
          message.includes(`channel="${WS_CHANNELS.serverWelcome}"`)
        );
      }),
    ).toBe(true);
  });

  it("responds to server.getConfig", async () => {
    const baseDir = makeTempDir("t3code-state-get-config-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    ensureParentDir(keybindingsPath);
    fs.writeFileSync(keybindingsPath, "[]", "utf8");

    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.serverGetConfig);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      cwd: "/my/workspace",
      keybindingsConfigPath: keybindingsPath,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      issues: [],
      providers: defaultProviderStatuses,
      availableEditors: expect.any(Array),
      settings: defaultServerSettings,
    });
    expectAvailableEditors((response.result as { availableEditors: unknown }).availableEditors);
  });

  it("bootstraps default keybindings file when missing", async () => {
    const baseDir = makeTempDir("t3code-state-bootstrap-keybindings-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    expect(fs.existsSync(keybindingsPath)).toBe(false);

    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.serverGetConfig);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      cwd: "/my/workspace",
      keybindingsConfigPath: keybindingsPath,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      issues: [],
      providers: defaultProviderStatuses,
      availableEditors: expect.any(Array),
      settings: defaultServerSettings,
    });
    expectAvailableEditors((response.result as { availableEditors: unknown }).availableEditors);

    const persistedConfig = JSON.parse(
      fs.readFileSync(keybindingsPath, "utf8"),
    ) as KeybindingsConfig;
    expect(persistedConfig).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("falls back to defaults and reports malformed keybindings config issues", async () => {
    const baseDir = makeTempDir("t3code-state-malformed-keybindings-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    ensureParentDir(keybindingsPath);
    fs.writeFileSync(keybindingsPath, "{ not-json", "utf8");

    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.serverGetConfig);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      cwd: "/my/workspace",
      keybindingsConfigPath: keybindingsPath,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      issues: [
        {
          kind: "keybindings.malformed-config",
          message: expect.stringContaining("expected JSON array"),
        },
      ],
      providers: defaultProviderStatuses,
      availableEditors: expect.any(Array),
      settings: defaultServerSettings,
    });
    expectAvailableEditors((response.result as { availableEditors: unknown }).availableEditors);
    expect(fs.readFileSync(keybindingsPath, "utf8")).toBe("{ not-json");
  });

  it("ignores invalid keybinding entries but keeps valid entries and reports issues", async () => {
    const baseDir = makeTempDir("t3code-state-partial-invalid-keybindings-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    ensureParentDir(keybindingsPath);
    fs.writeFileSync(
      keybindingsPath,
      JSON.stringify([
        { key: "mod+j", command: "terminal.toggle" },
        { key: "mod+shift+d+o", command: "terminal.new" },
        { key: "mod+x", command: "not-a-real-command" },
      ]),
      "utf8",
    );

    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.serverGetConfig);
    expect(response.error).toBeUndefined();
    const result = response.result as {
      cwd: string;
      keybindingsConfigPath: string;
      keybindings: ResolvedKeybindingsConfig;
      issues: Array<{ kind: string; index?: number; message: string }>;
      providers: ReadonlyArray<ServerProvider>;
      availableEditors: unknown;
    };
    expect(result.cwd).toBe("/my/workspace");
    expect(result.keybindingsConfigPath).toBe(keybindingsPath);
    expect(result.issues).toEqual([
      {
        kind: "keybindings.invalid-entry",
        index: 1,
        message: expect.any(String),
      },
      {
        kind: "keybindings.invalid-entry",
        index: 2,
        message: expect.any(String),
      },
    ]);
    expect(result.keybindings).toHaveLength(DEFAULT_RESOLVED_KEYBINDINGS.length);
    expect(result.keybindings.some((entry) => entry.command === "terminal.toggle")).toBe(true);
    expect(result.keybindings.some((entry) => entry.command === "terminal.new")).toBe(true);
    expect(result.providers).toEqual(defaultProviderStatuses);
    expectAvailableEditors(result.availableEditors);
  });

  it("pushes server.configUpdated issues when keybindings file changes", async () => {
    const baseDir = makeTempDir("t3code-state-keybindings-watch-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    ensureParentDir(keybindingsPath);
    fs.writeFileSync(keybindingsPath, "[]", "utf8");

    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const malformedPush = await rewriteKeybindingsAndWaitForPush(
      ws,
      keybindingsPath,
      "{ not-json",
      (push) =>
        Array.isArray(push.data.issues) &&
        Boolean(push.data.issues[0]) &&
        push.data.issues[0]!.kind === "keybindings.malformed-config",
    );
    expect(malformedPush.data).toEqual({
      issues: [{ kind: "keybindings.malformed-config", message: expect.any(String) }],
    });

    const invalidEntryPush = await rewriteKeybindingsAndWaitForPush(
      ws,
      keybindingsPath,
      JSON.stringify([
        { key: "mod+j", command: "terminal.toggle" },
        { key: "mod+x", command: "chat.notReal" },
      ]),
      (push) =>
        Array.isArray(push.data.issues) &&
        push.data.issues.length === 1 &&
        push.data.issues[0]!.kind === "keybindings.invalid-entry",
    );
    expect(invalidEntryPush.data).toEqual({
      issues: [
        {
          kind: "keybindings.invalid-entry",
          index: 1,
          message: expect.any(String),
        },
      ],
    });

    const successPush = await rewriteKeybindingsAndWaitForPush(
      ws,
      keybindingsPath,
      "[]",
      (push) => Array.isArray(push.data.issues) && push.data.issues.length === 0,
    );
    expect(successPush.data).toEqual({ issues: [] });
  }, 30_000);

  it("routes shell.openInEditor through the injected open service", async () => {
    const openCalls: Array<{ cwd: string; editor: string }> = [];
    const openService: OpenShape = {
      openBrowser: () => Effect.void,
      openInEditor: (input) => {
        openCalls.push({ cwd: input.cwd, editor: input.editor });
        return Effect.void;
      },
    };

    server = await createTestServer({ cwd: "/my/workspace", open: openService });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.shellOpenInEditor, {
      cwd: "/my/workspace",
      editor: "cursor",
    });
    expect(response.error).toBeUndefined();
    expect(openCalls).toEqual([{ cwd: "/my/workspace", editor: "cursor" }]);
  });

  it("reads keybindings from the configured state directory", async () => {
    const baseDir = makeTempDir("t3code-state-keybindings-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    ensureParentDir(keybindingsPath);
    fs.writeFileSync(
      keybindingsPath,
      JSON.stringify([
        { key: "cmd+j", command: "terminal.toggle" },
        { key: "mod+d", command: "terminal.split", when: "terminalFocus" },
        { key: "mod+n", command: "terminal.new", when: "terminalFocus" },
      ]),
      "utf8",
    );
    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.serverGetConfig);
    expect(response.error).toBeUndefined();
    const persistedConfig = JSON.parse(
      fs.readFileSync(keybindingsPath, "utf8"),
    ) as KeybindingsConfig;
    expect(response.result).toEqual({
      cwd: "/my/workspace",
      keybindingsConfigPath: keybindingsPath,
      keybindings: compileKeybindings(persistedConfig),
      issues: [],
      providers: defaultProviderStatuses,
      availableEditors: expect.any(Array),
      settings: defaultServerSettings,
    });
    expectAvailableEditors((response.result as { availableEditors: unknown }).availableEditors);
  });

  it("upserts keybinding rules and updates cached server config", async () => {
    const baseDir = makeTempDir("t3code-state-upsert-keybinding-");
    const { keybindingsConfigPath: keybindingsPath } = deriveServerPathsSync(baseDir, undefined);
    ensureParentDir(keybindingsPath);
    fs.writeFileSync(
      keybindingsPath,
      JSON.stringify([{ key: "mod+j", command: "terminal.toggle" }]),
      "utf8",
    );

    server = await createTestServer({ cwd: "/my/workspace", baseDir });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const upsertResponse = await sendRequest(ws, WS_METHODS.serverUpsertKeybinding, {
      key: "mod+shift+r",
      command: "script.run-tests.run",
    });
    expect(upsertResponse.error).toBeUndefined();
    const persistedConfig = JSON.parse(
      fs.readFileSync(keybindingsPath, "utf8"),
    ) as KeybindingsConfig;
    const persistedCommands = new Set(persistedConfig.map((entry) => entry.command));
    for (const defaultRule of DEFAULT_KEYBINDINGS) {
      expect(persistedCommands.has(defaultRule.command)).toBe(true);
    }
    expect(persistedCommands.has("script.run-tests.run")).toBe(true);
    expect(upsertResponse.result).toEqual({
      keybindings: compileKeybindings(persistedConfig),
      issues: [],
    });

    const configResponse = await sendRequest(ws, WS_METHODS.serverGetConfig);
    expect(configResponse.error).toBeUndefined();
    expect(configResponse.result).toEqual({
      cwd: "/my/workspace",
      keybindingsConfigPath: keybindingsPath,
      keybindings: compileKeybindings(persistedConfig),
      issues: [],
      providers: defaultProviderStatuses,
      availableEditors: expect.any(Array),
      settings: defaultServerSettings,
    });
    expectAvailableEditors(
      (configResponse.result as { availableEditors: unknown }).availableEditors,
    );
  });

  it("returns error for unknown methods", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, "nonexistent.method");
    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain("Invalid request format");
  });

  it("returns error when requesting turn diff for unknown thread", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getTurnDiff, {
      threadId: "thread-missing",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain("Thread 'thread-missing' not found.");
  });

  it("returns error when requesting turn diff with an inverted range", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getTurnDiff, {
      threadId: "thread-any",
      fromTurnCount: 2,
      toTurnCount: 1,
    });
    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain(
      "fromTurnCount must be less than or equal to toTurnCount",
    );
  });

  it("returns error when requesting full thread diff for unknown thread", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
      threadId: "thread-missing",
      toTurnCount: 2,
    });
    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain("Thread 'thread-missing' not found.");
  });

  it("returns error when requesting file diff for unknown thread", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getFileDiff, {
      threadId: "thread-missing",
      path: "src/index.ts",
      fromTurnCount: 0,
      toTurnCount: 2,
    });
    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain("Thread 'thread-missing' not found.");
  });

  it("returns retryable error when requested turn exceeds current checkpoint turn count", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const workspaceRoot = makeTempDir("t3code-ws-diff-project-");
    const createdAt = new Date().toISOString();
    const createProjectResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "project.create",
      commandId: "cmd-diff-project-create",
      projectId: "project-diff",
      title: "Diff Project",
      workspaceRoot,
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt,
    });
    expect(createProjectResponse.error).toBeUndefined();
    const createThreadResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "thread.create",
      commandId: "cmd-diff-thread-create",
      threadId: "thread-diff",
      projectId: "project-diff",
      title: "Diff Thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });
    expect(createThreadResponse.error).toBeUndefined();

    const response = await sendRequest(ws, ORCHESTRATION_WS_METHODS.getTurnDiff, {
      threadId: "thread-diff",
      fromTurnCount: 0,
      toTurnCount: 1,
    });
    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain("exceeds current turn count");
  });

  it("rejects project.create when the workspace root does not exist", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const missingWorkspaceRoot = path.join(makeTempDir("t3code-ws-project-missing-"), "missing");
    const response = await sendRequest(ws, ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "project.create",
      commandId: "cmd-ws-project-create-missing",
      projectId: "project-missing",
      title: "Missing Project",
      workspaceRoot: missingWorkspaceRoot,
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt: new Date().toISOString(),
    });

    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain("Workspace root does not exist:");
  });

  it("keeps orchestration domain push behavior for provider runtime events", async () => {
    const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    const emitRuntimeEvent = (event: ProviderRuntimeEvent) => {
      Effect.runSync(PubSub.publish(runtimeEventPubSub, event));
    };
    const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
    const providerService: ProviderServiceShape = {
      startSession: (threadId) =>
        Effect.succeed({
          provider: "codex",
          status: "ready",
          runtimeMode: "full-access",
          threadId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      sendTurn: ({ threadId }) =>
        Effect.succeed({
          threadId,
          turnId: asTurnId("provider-turn-1"),
        }),
      interruptTurn: () => unsupported(),
      respondToRequest: () => unsupported(),
      respondToUserInput: () => unsupported(),
      stopSession: () => unsupported(),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
      rollbackConversation: () => unsupported(),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    };
    const providerLayer = Layer.succeed(ProviderService, providerService);

    server = await createTestServer({
      cwd: "/test",
      providerLayer,
      serverSettings: { enableAssistantStreaming: true },
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const workspaceRoot = makeTempDir("t3code-ws-project-");
    const createdAt = new Date().toISOString();
    const createProjectResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "project.create",
      commandId: "cmd-ws-project-create",
      projectId: "project-1",
      title: "WS Project",
      workspaceRoot,
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt,
    });
    expect(createProjectResponse.error).toBeUndefined();
    const createThreadResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "thread.create",
      commandId: "cmd-ws-runtime-thread-create",
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread 1",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });
    expect(createThreadResponse.error).toBeUndefined();

    const startTurnResponse = await sendRequest(ws, ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "thread.turn.start",
      commandId: "cmd-ws-runtime-turn-start",
      threadId: "thread-1",
      message: {
        messageId: "msg-ws-runtime-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt,
    });
    expect(startTurnResponse.error).toBeUndefined();

    await waitForPush(ws, ORCHESTRATION_WS_CHANNELS.domainEvent, (push) => {
      const event = push.data as { type?: string };
      return event.type === "thread.session-set";
    });

    emitRuntimeEvent({
      type: "content.delta",
      eventId: asEventId("evt-ws-runtime-message-delta"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-1"),
      itemId: asProviderItemId("item-1"),
      payload: {
        streamKind: "assistant_text",
        delta: "hello from runtime",
      },
    } as unknown as ProviderRuntimeEvent);

    const domainPush = await waitForPush(ws, ORCHESTRATION_WS_CHANNELS.domainEvent, (push) => {
      const event = push.data as { type?: string; payload?: { messageId?: string; text?: string } };
      return (
        event.type === "thread.message-sent" && event.payload?.messageId === "assistant:item-1"
      );
    });

    const domainEvent = domainPush.data as {
      type: string;
      payload: { messageId: string; text: string };
    };
    expect(domainEvent.type).toBe("thread.message-sent");
    expect(domainEvent.payload.messageId).toBe("assistant:item-1");
    expect(domainEvent.payload.text).toBe("hello from runtime");
  });

  it("routes terminal RPC methods and broadcasts terminal events", async () => {
    const cwd = makeTempDir("t3code-ws-terminal-cwd-");
    const terminalManager = new MockTerminalManager();
    server = await createTestServer({
      cwd: "/test",
      terminalManager,
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const open = await sendRequest(ws, WS_METHODS.terminalOpen, {
      threadId: "thread-1",
      cwd,
      cols: 100,
      rows: 24,
    });
    expect(open.error).toBeUndefined();
    expect((open.result as TerminalSessionSnapshot).threadId).toBe("thread-1");
    expect((open.result as TerminalSessionSnapshot).terminalId).toBe(DEFAULT_TERMINAL_ID);

    const write = await sendRequest(ws, WS_METHODS.terminalWrite, {
      threadId: "thread-1",
      data: "echo hello\n",
    });
    expect(write.error).toBeUndefined();

    const resize = await sendRequest(ws, WS_METHODS.terminalResize, {
      threadId: "thread-1",
      cols: 120,
      rows: 30,
    });
    expect(resize.error).toBeUndefined();

    const clear = await sendRequest(ws, WS_METHODS.terminalClear, {
      threadId: "thread-1",
    });
    expect(clear.error).toBeUndefined();

    const restart = await sendRequest(ws, WS_METHODS.terminalRestart, {
      threadId: "thread-1",
      cwd,
      cols: 120,
      rows: 30,
    });
    expect(restart.error).toBeUndefined();

    const close = await sendRequest(ws, WS_METHODS.terminalClose, {
      threadId: "thread-1",
      deleteHistory: true,
    });
    expect(close.error).toBeUndefined();

    const manualEvent: TerminalEvent = {
      type: "output",
      threadId: "thread-1",
      terminalId: DEFAULT_TERMINAL_ID,
      createdAt: new Date().toISOString(),
      data: "manual test output\n",
    };
    terminalManager.emitEvent(manualEvent);

    const push = await waitForPush(
      ws,
      WS_CHANNELS.terminalEvent,
      (candidate) => (candidate.data as TerminalEvent).type === "output",
    );
    expect(push.type).toBe("push");
    expect(push.channel).toBe(WS_CHANNELS.terminalEvent);
  });

  it("shuts down cleanly for injected terminal managers", async () => {
    const terminalManager = new MockTerminalManager();
    server = await createTestServer({
      cwd: "/test",
      terminalManager,
    });

    await closeTestServer();
    server = null;

    expect(() =>
      terminalManager.emitEvent({
        type: "output",
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        createdAt: new Date().toISOString(),
        data: "after shutdown\n",
      }),
    ).not.toThrow();
  });

  it("returns validation errors for invalid terminal open params", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.terminalOpen, {
      threadId: "",
      cwd: "",
      cols: 1,
      rows: 1,
    });
    expect(response.error).toBeDefined();
  });

  it("handles invalid JSON gracefully", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    // Send garbage
    ws.send("not json at all");

    // Error response goes to the response channel
    const channels = channelsBySocket.get(ws)!;
    let response: WebSocketResponse | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const message = await dequeue(channels.response, 5_000);
      if (message.id === "unknown") {
        response = message;
        break;
      }
      if (message.error) {
        response = message;
        break;
      }
    }
    expect(response).toBeDefined();
    expect(response!.error).toBeDefined();
    expect(response!.error!.message).toContain("Invalid request format");
  });

  it("catches websocket message handler rejections and keeps the socket usable", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    const brokenOpenService: OpenShape = {
      openBrowser: () => Effect.void,
      openInEditor: () =>
        Effect.sync(() => BigInt(1)).pipe(Effect.map((result) => result as unknown as void)),
    };

    try {
      server = await createTestServer({ cwd: "/test", open: brokenOpenService });
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;

      const [ws] = await connectAndAwaitWelcome(port);
      connections.push(ws);

      ws.send(
        JSON.stringify({
          id: "req-broken-open",
          body: {
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/tmp",
            editor: "cursor",
          },
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandledRejections).toHaveLength(0);

      const workspace = makeTempDir("t3code-ws-handler-still-usable-");
      fs.writeFileSync(path.join(workspace, "file.txt"), "ok\n", "utf8");
      const response = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
        cwd: workspace,
        query: "file",
        limit: 5,
      });
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual(
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({
              path: "file.txt",
              kind: "file",
            }),
          ]),
        }),
      );
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("returns errors for removed projects CRUD methods", async () => {
    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const listResponse = await sendRequest(ws, WS_METHODS.projectsList);
    expect(listResponse.result).toBeUndefined();
    expect(listResponse.error?.message).toContain("Invalid request format");

    const addResponse = await sendRequest(ws, WS_METHODS.projectsAdd, {
      cwd: "/tmp/project-a",
    });
    expect(addResponse.result).toBeUndefined();
    expect(addResponse.error?.message).toContain("Invalid request format");

    const removeResponse = await sendRequest(ws, WS_METHODS.projectsRemove, {
      id: "project-a",
    });
    expect(removeResponse.result).toBeUndefined();
    expect(removeResponse.error?.message).toContain("Invalid request format");
  });

  it("supports projects.searchEntries", async () => {
    const workspace = makeTempDir("t3code-ws-workspace-entries-");
    fs.mkdirSync(path.join(workspace, "src", "components"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "src", "components", "Composer.tsx"),
      "export {};",
      "utf8",
    );
    fs.writeFileSync(path.join(workspace, "README.md"), "# test", "utf8");
    fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
      cwd: workspace,
      query: "comp",
      limit: 10,
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      entries: expect.arrayContaining([
        expect.objectContaining({ path: "src/components", kind: "directory" }),
        expect.objectContaining({ path: "src/components/Composer.tsx", kind: "file" }),
      ]),
      truncated: false,
    });
  });

  it("supports projects.writeFile within the workspace root", async () => {
    const workspace = makeTempDir("t3code-ws-write-file-");

    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.projectsWriteFile, {
      cwd: workspace,
      relativePath: "plans/effect-rpc.md",
      contents: "# Plan\n\n- step 1\n",
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      relativePath: "plans/effect-rpc.md",
    });
    expect(fs.readFileSync(path.join(workspace, "plans", "effect-rpc.md"), "utf8")).toBe(
      "# Plan\n\n- step 1\n",
    );
  });

  it("invalidates workspace entry search cache after projects.writeFile", async () => {
    const workspace = makeTempDir("t3code-ws-write-file-invalidate-");
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "existing.ts"), "export {};\n", "utf8");

    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const beforeWrite = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
      cwd: workspace,
      query: "rpc",
      limit: 10,
    });
    expect(beforeWrite.error).toBeUndefined();
    expect(beforeWrite.result).toEqual({
      entries: [],
      truncated: false,
    });

    const writeResponse = await sendRequest(ws, WS_METHODS.projectsWriteFile, {
      cwd: workspace,
      relativePath: "plans/effect-rpc.md",
      contents: "# Plan\n",
    });
    expect(writeResponse.error).toBeUndefined();

    const afterWrite = await sendRequest(ws, WS_METHODS.projectsSearchEntries, {
      cwd: workspace,
      query: "rpc",
      limit: 10,
    });
    expect(afterWrite.error).toBeUndefined();
    expect(afterWrite.result).toEqual({
      entries: expect.arrayContaining([
        expect.objectContaining({ path: "plans/effect-rpc.md", kind: "file" }),
      ]),
      truncated: false,
    });
  });

  it("rejects projects.writeFile paths outside the workspace root", async () => {
    const workspace = makeTempDir("t3code-ws-write-file-reject-");

    server = await createTestServer({ cwd: "/test" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.projectsWriteFile, {
      cwd: workspace,
      relativePath: "../escape.md",
      contents: "# no\n",
    });

    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain(
      "Workspace file path must be relative to the project root: ../escape.md",
    );
    expect(fs.existsSync(path.join(workspace, "..", "escape.md"))).toBe(false);
  });

  it("routes git core methods over websocket", async () => {
    const listBranches = vi.fn(() =>
      Effect.succeed({
        branches: [],
        isRepo: false,
        hasOriginRemote: false,
      }),
    );
    const initRepo = vi.fn(() => Effect.void);
    const pullCurrentBranch = vi.fn(() =>
      Effect.fail(
        new GitCommandError({
          operation: "GitCore.test.pullCurrentBranch",
          detail: "No upstream configured",
          command: "git pull",
          cwd: "/repo/path",
        }),
      ),
    );

    server = await createTestServer({
      cwd: "/test",
      gitCore: {
        listBranches,
        initRepo,
        pullCurrentBranch,
      },
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const listResponse = await sendRequest(ws, WS_METHODS.gitListBranches, { cwd: "/repo/path" });
    expect(listResponse.error).toBeUndefined();
    expect(listResponse.result).toEqual({ branches: [], isRepo: false, hasOriginRemote: false });
    expect(listBranches).toHaveBeenCalledWith({ cwd: "/repo/path" });

    const initResponse = await sendRequest(ws, WS_METHODS.gitInit, { cwd: "/repo/path" });
    expect(initResponse.error).toBeUndefined();
    expect(initRepo).toHaveBeenCalledWith({ cwd: "/repo/path" });

    const pullResponse = await sendRequest(ws, WS_METHODS.gitPull, { cwd: "/repo/path" });
    expect(pullResponse.result).toBeUndefined();
    expect(pullResponse.error?.message).toContain("No upstream configured");
    expect(pullCurrentBranch).toHaveBeenCalledWith("/repo/path");
  });

  it("supports git.status over websocket", async () => {
    const statusResult = {
      branch: "feature/test",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/index.ts", insertions: 7, deletions: 2 }],
        insertions: 7,
        deletions: 2,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const status = vi.fn(() => Effect.succeed(statusResult));
    const runStackedAction = vi.fn(() => Effect.void as any);
    const resolvePullRequest = vi.fn(() => Effect.void as any);
    const preparePullRequestThread = vi.fn(() => Effect.void as any);
    const gitManager: GitManagerShape = {
      status,
      resolvePullRequest,
      preparePullRequestThread,
      runStackedAction,
    };

    server = await createTestServer({ cwd: "/test", gitManager });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.gitStatus, {
      cwd: "/test",
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(statusResult);
    expect(status).toHaveBeenCalledWith({ cwd: "/test" });
  });

  it("supports git pull request routing over websocket", async () => {
    const resolvePullRequestResult = {
      pullRequest: {
        number: 42,
        title: "PR thread flow",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open" as const,
      },
    };
    const preparePullRequestThreadResult = {
      ...resolvePullRequestResult,
      branch: "feature/pr-threads",
      worktreePath: "/tmp/pr-threads",
    };

    const gitManager: GitManagerShape = {
      status: vi.fn(() => Effect.void as any),
      resolvePullRequest: vi.fn(() => Effect.succeed(resolvePullRequestResult)),
      preparePullRequestThread: vi.fn(() => Effect.succeed(preparePullRequestThreadResult)),
      runStackedAction: vi.fn(() => Effect.void as any),
    };

    server = await createTestServer({ cwd: "/test", gitManager });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const resolveResponse = await sendRequest(ws, WS_METHODS.gitResolvePullRequest, {
      cwd: "/test",
      reference: "#42",
    });
    expect(resolveResponse.error).toBeUndefined();
    expect(resolveResponse.result).toEqual(resolvePullRequestResult);

    const prepareResponse = await sendRequest(ws, WS_METHODS.gitPreparePullRequestThread, {
      cwd: "/test",
      reference: "42",
      mode: "worktree",
    });
    expect(prepareResponse.error).toBeUndefined();
    expect(prepareResponse.result).toEqual(preparePullRequestThreadResult);
    expect(gitManager.resolvePullRequest).toHaveBeenCalledWith({
      cwd: "/test",
      reference: "#42",
    });
    expect(gitManager.preparePullRequestThread).toHaveBeenCalledWith({
      cwd: "/test",
      reference: "42",
      mode: "worktree",
    });
  });

  it("returns errors from git.runStackedAction", async () => {
    const runStackedAction = vi.fn(() =>
      Effect.fail(
        new GitManagerError({
          operation: "GitManager.test.runStackedAction",
          detail: "Cannot push from detached HEAD.",
        }),
      ),
    );
    const gitManager: GitManagerShape = {
      status: vi.fn(() => Effect.void as any),
      resolvePullRequest: vi.fn(() => Effect.void as any),
      preparePullRequestThread: vi.fn(() => Effect.void as any),
      runStackedAction,
    };

    server = await createTestServer({ cwd: "/test", gitManager });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitWelcome(port);
    connections.push(ws);

    const response = await sendRequest(ws, WS_METHODS.gitRunStackedAction, {
      actionId: "client-action-1",
      cwd: "/test",
      action: "commit_push",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
      },
    });
    expect(response.result).toBeUndefined();
    expect(response.error?.message).toContain("detached HEAD");
    expect(runStackedAction).toHaveBeenCalledWith(
      {
        actionId: "client-action-1",
        cwd: "/test",
        action: "commit_push",
      },
      expect.objectContaining({
        actionId: "client-action-1",
        progressReporter: expect.any(Object),
      }),
    );
  });

  it("publishes git action progress only to the initiating websocket", async () => {
    const runStackedAction = vi.fn(
      (_input, options) =>
        options?.progressReporter
          ?.publish({
            actionId: options.actionId ?? "action-1",
            cwd: "/test",
            action: "commit",
            kind: "phase_started",
            phase: "commit",
            label: "Committing...",
          })
          .pipe(
            Effect.flatMap(() =>
              Effect.succeed({
                action: "commit" as const,
                branch: { status: "skipped_not_requested" as const },
                commit: {
                  status: "created" as const,
                  commitSha: "abc1234",
                  subject: "Test commit",
                },
                push: { status: "skipped_not_requested" as const },
                pr: { status: "skipped_not_requested" as const },
              }),
            ),
          ) ?? Effect.void,
    );
    const gitManager: GitManagerShape = {
      status: vi.fn(() => Effect.void as any),
      resolvePullRequest: vi.fn(() => Effect.void as any),
      preparePullRequestThread: vi.fn(() => Effect.void as any),
      runStackedAction,
    };

    server = await createTestServer({ cwd: "/test", gitManager });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [initiatingWs] = await connectAndAwaitWelcome(port);
    const [otherWs] = await connectAndAwaitWelcome(port);
    connections.push(initiatingWs, otherWs);

    const responsePromise = sendRequest(initiatingWs, WS_METHODS.gitRunStackedAction, {
      actionId: "client-action-2",
      cwd: "/test",
      action: "commit",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
      },
    });
    const progressPush = await waitForPush(initiatingWs, WS_CHANNELS.gitActionProgress);

    expect(progressPush.data).toEqual({
      actionId: "client-action-2",
      cwd: "/test",
      action: "commit",
      kind: "phase_started",
      phase: "commit",
      label: "Committing...",
    });

    await expect(
      waitForPush(otherWs, WS_CHANNELS.gitActionProgress, undefined, 10, 100),
    ).rejects.toThrow("Timed out waiting for WebSocket message after 100ms");
    await expect(responsePromise).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          action: "commit",
        }),
      }),
    );
  });

  it("rejects agent websocket connections without a valid session token", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const futureExp = Date.now() + 60_000;
    const baseToken = JSON.parse(
      makeAgentSessionToken({
        tenantId: "tenant-1",
        userId: "user-1",
        exp: futureExp,
      }),
    ) as Record<string, unknown>;

    await expect(connectAgentWs(port)).rejects.toThrow("WebSocket connection failed");
    await expect(connectAgentWs(port, "not-json")).rejects.toThrow("WebSocket connection failed");
    await expect(
      connectAgentWs(
        port,
        makeAgentSessionToken({ tenantId: "tenant-1", userId: "user-1", exp: 0 }),
      ),
    ).rejects.toThrow("WebSocket connection failed");
    await expect(
      connectAgentWs(
        port,
        makeAgentSessionToken({ tenantId: "tenant-1", userId: "user-1" }, "invalid-session-secret"),
      ),
    ).rejects.toThrow("WebSocket connection failed");

    const tamperCases: Array<{ label: string; mutate: (token: Record<string, unknown>) => void }> =
      [
        {
          label: "tenantId",
          mutate: (token) => {
            token.tenantId = "tenant-evil";
          },
        },
        {
          label: "userId",
          mutate: (token) => {
            token.userId = "user-evil";
          },
        },
        {
          label: "sessionId",
          mutate: (token) => {
            token.sessionId = "session-evil";
          },
        },
        {
          label: "conversationId",
          mutate: (token) => {
            token.conversationId = "conversation-evil";
          },
        },
        {
          label: "lastSeenSequence",
          mutate: (token) => {
            token.lastSeenSequence = 999;
          },
        },
        {
          label: "exp",
          mutate: (token) => {
            token.exp = Date.now() - 1;
          },
        },
        {
          label: "capabilities",
          mutate: (token) => {
            const capabilities = Array.isArray(token.capabilities) ? [...token.capabilities] : [];
            capabilities.push("admin");
            token.capabilities = capabilities;
          },
        },
      ];

    for (const entry of tamperCases) {
      const tamperedToken = JSON.parse(JSON.stringify(baseToken)) as Record<string, unknown>;
      entry.mutate(tamperedToken);
      await expect(connectAgentWs(port, JSON.stringify(tamperedToken))).rejects.toThrow(
        `WebSocket connection failed`,
      );
      void entry.label;
    }
  });

  it("bootstraps a new agent websocket session and sends welcome", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const token = makeAgentSessionToken({
      tenantId: "tenant-agent",
      userId: "agent-user",
      sessionId: "agent-session-boot",
      conversationId: "agent-conversation-boot",
      capabilities: ["quote-search"],
    });

    const [ws, welcome] = await connectAndAwaitAgentWelcome(port, token);
    connections.push(ws);

    expect(welcome.channel).toBe(AGENT_WS_CHANNELS.sessionWelcome);
    expect(welcome.data).toEqual({
      capabilities: ["quote-search"],
      resumeSupported: true,
    });
    expect(welcome.metadata).toMatchObject({
      protocolVersion: 1,
      sessionId: "agent-session-boot",
      conversationId: "agent-conversation-boot",
      sequence: 1,
      turnId: expect.any(String),
      eventId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it("supports agent protocol connect/sendMessage flow with response and pushes", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitAgentWelcome(
      port,
      makeAgentSessionToken({
        tenantId: "tenant-agent",
        userId: "agent-user",
        sessionId: "agent-protocol-session",
        capabilities: ["quote-search"],
      }),
    );
    connections.push(ws);

    const connectResponse = await sendAgentRequest(ws, AGENT_WS_METHODS.connect, {
      tenantId: "tenant-agent",
      authToken: "agent-token",
      capabilities: ["recurring-quotes", "quote-search"],
    });
    const connectWelcome = await waitForAgentPush(
      ws,
      AGENT_WS_CHANNELS.sessionWelcome,
      (push) => push.channel === AGENT_WS_CHANNELS.sessionWelcome,
    );
    expect(connectResponse.error).toBeUndefined();
    expect(connectResponse.result).toEqual({
      capabilities: ["quote-search"],
    });
    expect(connectWelcome.data).toMatchObject({
      message: "Session connected",
      capabilities: ["quote-search"],
      resumeSupported: true,
    });

    const message = "What is the weather in Sydney?";
    const response = await sendAgentRequest(ws, AGENT_WS_METHODS.sendMessage, { message });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(
      expect.objectContaining({
        turnId: expect.any(String),
        messageId: expect.stringContaining("assistant-"),
      }),
    );

    const delta = await waitForAgentPush(ws, AGENT_WS_CHANNELS.assistantDelta, (push) => {
      return (push.data as { delta?: string }).delta === message;
    });
    expect(delta.data).toEqual({ delta: message });

    const complete = await waitForAgentPush(
      ws,
      AGENT_WS_CHANNELS.assistantMessage,
      (push) => (push.data as { status?: string }).status === "complete",
    );
    expect(complete.data).toEqual({
      message,
      status: "complete",
    });
  });

  it("authoritatively resolves capabilities from token on connect and getCapabilities", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const token = makeAgentSessionToken({
      tenantId: "tenant-agent",
      userId: "agent-user",
      sessionId: "agent-capability-session",
      conversationId: "agent-capability-conversation",
      capabilities: ["quote-search"],
    });

    const [ws] = await connectAndAwaitAgentWelcome(port, token);
    connections.push(ws);

    const connectResponse = await sendAgentRequest(ws, AGENT_WS_METHODS.connect, {
      tenantId: "tenant-agent",
      authToken: "agent-token",
      capabilities: ["recurring-quotes", "quote-search", "admin"],
    });
    expect(connectResponse.error).toBeUndefined();
    expect(connectResponse.result).toEqual({
      capabilities: ["quote-search"],
    });

    const getCapabilitiesResponse = await sendAgentRequest(ws, AGENT_WS_METHODS.getCapabilities);
    expect(getCapabilitiesResponse.error).toBeUndefined();
    expect(getCapabilitiesResponse.result).toEqual({
      capabilities: ["quote-search"],
    });
  });

  it("falls back to default capabilities when token capabilities are empty or omitted", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const futureExp = Date.now() + 60_000;
    const omittedCapabilitiesToken = makeAgentSessionTokenFromPayload({
      tenantId: "tenant-agent-default-omitted",
      userId: "agent-user-default",
      sessionId: "agent-default-session-omitted",
      conversationId: "agent-default-conversation-omitted",
      exp: futureExp,
    });
    const emptyCapabilitiesToken = makeAgentSessionToken({
      tenantId: "tenant-agent-default-empty",
      userId: "agent-user-default",
      sessionId: "agent-default-session-empty",
      conversationId: "agent-default-conversation-empty",
      capabilities: [],
      exp: futureExp,
    });

    for (const token of [omittedCapabilitiesToken, emptyCapabilitiesToken]) {
      const [ws] = await connectAndAwaitAgentWelcome(port, token);
      connections.push(ws);

      const response = await sendAgentRequest(ws, AGENT_WS_METHODS.getCapabilities);
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({
        capabilities: DEFAULT_AGENT_CAPABILITIES,
      });
    }
  });

  it("replays prior agent events when lastSeenSequence is provided", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const tokenSeed = {
      tenantId: "tenant-agent",
      userId: "agent-user",
      sessionId: "agent-replay-session",
      conversationId: "agent-replay-conversation",
    };

    const [originalWs] = await connectAndAwaitAgentWelcome(port, makeAgentSessionToken(tokenSeed));
    connections.push(originalWs);

    const message = "Replay this message from prior session";
    const response = await sendAgentRequest(originalWs, AGENT_WS_METHODS.sendMessage, { message });
    expect(response.error).toBeUndefined();

    originalWs.close();

    const replayedWs = await connectAgentWs(
      port,
      makeAgentSessionToken({
        ...tokenSeed,
        lastSeenSequence: 1,
      }),
    );
    connections.push(replayedWs);

    const replayDelta = await waitForAgentPush(
      replayedWs,
      AGENT_WS_CHANNELS.assistantDelta,
      (push) => (push.data as { delta?: string }).delta === message,
    );
    expect(replayDelta.data).toEqual({ delta: message });
    expect(replayDelta.metadata.sequence).toBe(2);
    const replayMessage = await waitForAgentPush(
      replayedWs,
      AGENT_WS_CHANNELS.assistantMessage,
      (push) => (push.data as { message?: string }).message === message,
    );
    expect(replayMessage.data).toEqual({
      message,
      status: "complete",
    });
    expect(replayMessage.metadata.sequence).toBe(3);
    const replayWelcome = await waitForAgentPush(
      replayedWs,
      AGENT_WS_CHANNELS.sessionWelcome,
      (push) => push.channel === AGENT_WS_CHANNELS.sessionWelcome,
    );
    expect(replayWelcome.metadata.sequence).toBe(5);
    expect(replayWelcome.metadata.sequence).toBeGreaterThan(replayMessage.metadata.sequence);
  });

  it("rejects stale session reuse when tenant, user, or conversation identity changes", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const tokenSeed = {
      tenantId: "tenant-rebind",
      userId: "agent-user-rebind",
      sessionId: "agent-rebind-session",
      conversationId: "agent-rebind-conversation",
    };
    const message = "stateful message before rebind attempt";

    const [seedWs] = await connectAndAwaitAgentWelcome(port, makeAgentSessionToken(tokenSeed));
    connections.push(seedWs);
    const response = await sendAgentRequest(seedWs, AGENT_WS_METHODS.sendMessage, { message });
    expect(response.error).toBeUndefined();
    seedWs.close();

    const expectRejectedRebind = async (overrides: {
      tenantId?: string;
      userId?: string;
      conversationId?: string;
    }) => {
      const rebindWs = await connectAgentWs(
        port,
        makeAgentSessionToken({
          ...tokenSeed,
          ...overrides,
        }),
      );
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          rebindWs.once("close", (code, reason) => {
            if (code !== 1008 || reason.toString() !== "Invalid agent session token") {
              reject(new Error(`Unexpected close: ${code} ${reason}`));
              return;
            }
            resolve();
          });
          rebindWs.once("error", (error) => {
            reject(new Error(`Unexpected error: ${String(error)}`));
          });
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for invalid-session close")), 1_000),
        ),
      ]);
    };

    await expect(expectRejectedRebind({ tenantId: "tenant-another" })).resolves.toBeUndefined();
    await expect(expectRejectedRebind({ userId: "user-another" })).resolves.toBeUndefined();
    await expect(
      expectRejectedRebind({ conversationId: "conversation-another" }),
    ).resolves.toBeUndefined();

    const reconnectedWs = await connectAgentWs(
      port,
      makeAgentSessionToken({
        ...tokenSeed,
        lastSeenSequence: 1,
      }),
    );
    connections.push(reconnectedWs);

    const replayDelta = await waitForAgentPush(
      reconnectedWs,
      AGENT_WS_CHANNELS.assistantDelta,
      (push) => (push.data as { delta?: string }).delta === message,
    );
    expect(replayDelta.data).toEqual({ delta: message });
    expect(replayDelta.metadata.sequence).toBe(2);
  });

  it("does not replay events when lastSeenSequence is already current", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const tokenSeed = {
      tenantId: "tenant-noreplay",
      userId: "agent-user-noreplay",
      sessionId: "agent-noreplay-session",
      conversationId: "agent-noreplay-conversation",
    };

    const [seedWs] = await connectAndAwaitAgentWelcome(port, makeAgentSessionToken(tokenSeed));
    connections.push(seedWs);
    await sendAgentRequest(seedWs, AGENT_WS_METHODS.sendMessage, {
      message: "only for first sequence seed",
    });
    seedWs.close();

    const reconnectedWs = await connectAgentWs(
      port,
      makeAgentSessionToken({
        ...tokenSeed,
        lastSeenSequence: 4,
      }),
    );
    connections.push(reconnectedWs);

    const freshWelcome = await waitForAgentPush(
      reconnectedWs,
      AGENT_WS_CHANNELS.sessionWelcome,
      () => true,
    );
    expect(freshWelcome.data).toMatchObject({
      capabilities: ["recurring-quotes", "quote-search"],
      resumeSupported: true,
    });
    expect(freshWelcome.metadata.sequence).toBe(5);
    await expect(
      waitForAgentPush(reconnectedWs, AGENT_WS_CHANNELS.assistantDelta, () => true, 16, 200),
    ).rejects.toThrow("Timed out waiting for WebSocket message");
  });

  it("returns schema errors for malformed agent messages and keeps the socket usable", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [ws] = await connectAndAwaitAgentWelcome(
      port,
      makeAgentSessionToken({
        tenantId: "tenant-malformed",
        userId: "agent-user-malformed",
      }),
    );
    connections.push(ws);

    const channels = agentChannelsBySocket.get(ws);
    if (!channels) throw new Error("Agent channels missing");
    ws.send("totally not json");

    const malformedResponse = await dequeue(channels.response, 5_000);
    expect(malformedResponse.error).toBeDefined();
    expect(malformedResponse.error?.message).toContain("Invalid request format");

    const capabilities = await sendAgentRequest(ws, AGENT_WS_METHODS.getCapabilities);
    expect(capabilities.error).toBeUndefined();
    expect(capabilities.result).toEqual({
      capabilities: ["recurring-quotes", "quote-search"],
    });
  });

  it("returns typed unsupported-method errors without poisoning other agent sessions", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const [errorWs] = await connectAndAwaitAgentWelcome(
      port,
      makeAgentSessionToken({
        tenantId: "tenant-multi",
        userId: "agent-user-multi",
      }),
    );
    const [healthyWs] = await connectAndAwaitAgentWelcome(
      port,
      makeAgentSessionToken({
        tenantId: "tenant-multi",
        userId: "agent-user-multi",
        sessionId: "agent-healthy-session",
      }),
    );
    connections.push(errorWs, healthyWs);

    const errorResponse = await sendAgentRequest(errorWs, "agent.unknown");
    expect(errorResponse.error).toEqual({
      code: "bad_request",
      message: "Unsupported agent method: agent.unknown",
    });

    const healthyResponse = await sendAgentRequest(healthyWs, AGENT_WS_METHODS.getCapabilities);
    expect(healthyResponse.error).toBeUndefined();
    expect(healthyResponse.result).toEqual({
      capabilities: ["recurring-quotes", "quote-search"],
    });
  });

  it("returns protocol errors for unsupported agent methods", async () => {
    server = await createTestServer({ cwd: "/test", authToken: AGENT_SESSION_TOKEN_SECRET });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const token = makeAgentSessionToken({
      tenantId: "tenant-agent",
      userId: "agent-user",
      sessionId: "agent-error-session",
    });

    const [ws] = await connectAndAwaitAgentWelcome(port, token);
    connections.push(ws);

    const response = await sendAgentRequest(ws, "agent.unknown");
    expect(response.error).toBeDefined();
    expect(response.error).toMatchObject({
      code: "bad_request",
      message: "Unsupported agent method: agent.unknown",
    });
  });

  it("rejects websocket connections without a valid auth token", async () => {
    server = await createTestServer({ cwd: "/test", authToken: "secret-token" });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    await expect(connectWs(port)).rejects.toThrow("WebSocket connection failed");

    const [authorizedWs] = await connectAndAwaitWelcome(port, "secret-token");
    connections.push(authorizedWs);
  });
});
