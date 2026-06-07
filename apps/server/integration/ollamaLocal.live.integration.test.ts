import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import { Effect, Fiber, Layer, Queue, Stream } from "effect";

import { ServerConfig } from "../src/config.ts";
import { makeOllamaAdapter } from "../src/provider/Layers/OllamaAdapter.ts";
import { listOllamaModels } from "../src/provider/ollamaApi.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";

const LIVE_OLLAMA_TESTS_ENABLED = process.env.OLLAMA_LIVE_TESTS === "1";
const LIVE_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://192.168.10.12:11435/api";
const LIVE_OLLAMA_RESPONSES_API_PATH = process.env.OLLAMA_RESPONSES_API_PATH ?? "/v1";
const LIVE_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const LIVE_OLLAMA_PREFLIGHT_TIMEOUT_MS = 10_000;

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

class LiveOllamaTurnTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveOllamaTurnTimeoutError";
  }
}

class LiveOllamaEndpointUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveOllamaEndpointUnreachableError";
  }
}

function buildLiveSettingsOverrides() {
  const url = new URL(LIVE_OLLAMA_BASE_URL);
  return {
    providers: {
      ollamaLocal: {
        protocol: url.protocol === "https:" ? ("https" as const) : ("http" as const),
        host: url.hostname,
        port: Number(url.port || (url.protocol === "https:" ? "443" : "80")),
        apiPath: url.pathname || "/api",
        responsesApiPath: LIVE_OLLAMA_RESPONSES_API_PATH,
        codexHomePath: fs.mkdtempSync(path.join(os.tmpdir(), "t3-live-ollama-codex-home-")),
        defaultModel: LIVE_OLLAMA_MODEL,
      },
    },
  } as const;
}

async function collectTurnEvents(
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
  stream: Stream.Stream<ProviderRuntimeEvent>,
  action: () => Promise<unknown>,
  timeoutMs = 90_000,
): Promise<ReadonlyArray<ProviderRuntimeEvent>> {
  const queue = await runPromise(Queue.unbounded<ProviderRuntimeEvent>());
  const consumer = Effect.runFork(
    Stream.runForEach(stream, (event) => Queue.offer(queue, event).pipe(Effect.asVoid)),
  );

  try {
    await action();

    const collected: ProviderRuntimeEvent[] = [];
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new LiveOllamaTurnTimeoutError(
          `Timed out waiting for live Ollama turn completion after ${timeoutMs}ms.`,
        );
      }

      const event = await Promise.race([
        runPromise(Queue.take(queue)),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(
              new LiveOllamaTurnTimeoutError(
                `Timed out waiting for live Ollama turn completion after ${timeoutMs}ms.`,
              ),
            );
          }, remainingMs);
          void timer;
        }),
      ]);

      collected.push(event);
      if (event.type === "turn.completed") {
        return collected;
      }
    }
  } finally {
    Effect.runFork(Fiber.interrupt(consumer).pipe(Effect.ignore));
  }
}

async function ensureLiveEndpointReachable(): Promise<ReadonlyArray<string>> {
  try {
    const models = await Effect.runPromise(
      listOllamaModels({
        baseUrl: LIVE_OLLAMA_BASE_URL,
        timeoutMs: LIVE_OLLAMA_PREFLIGHT_TIMEOUT_MS,
      }),
    );
    if (!models.includes(LIVE_OLLAMA_MODEL)) {
      throw new LiveOllamaEndpointUnreachableError(
        `Ollama endpoint ${LIVE_OLLAMA_BASE_URL} is reachable, but model ${LIVE_OLLAMA_MODEL} is unavailable.`,
      );
    }
    return models;
  } catch (error) {
    if (error instanceof LiveOllamaEndpointUnreachableError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LiveOllamaEndpointUnreachableError(
      `Unable to reach live Ollama endpoint ${LIVE_OLLAMA_BASE_URL}: ${detail}`,
    );
  }
}

const liveAdapterLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), process.cwd()),
  ServerSettingsService.layerTest(buildLiveSettingsOverrides()),
).pipe(Layer.provideMerge(NodeServices.layer));

const makeLiveAdapter = () => makeOllamaAdapter().pipe(Effect.provide(liveAdapterLayer));

it.live.skipIf(!LIVE_OLLAMA_TESTS_ENABLED)(
  "connects to the real Ollama endpoint and streams assistant text through the Codex-backed adapter",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(() => ensureLiveEndpointReachable());

        const runPromise = Effect.runPromise;
        const adapter = yield* makeLiveAdapter();
        const threadId = asThreadId("thread-live-ollama-connectivity");

        const session = yield* adapter.startSession({
          threadId,
          provider: "ollamaLocal",
          runtimeMode: "full-access",
        });
        assert.equal(session.provider, "ollamaLocal");
        assert.equal(session.model, LIVE_OLLAMA_MODEL);

        const events = yield* Effect.promise(() =>
          collectTurnEvents(runPromise, adapter.streamEvents, () =>
            runPromise(
              adapter.sendTurn({
                threadId,
                input:
                  "Reply with one short sentence so T3 can verify the live Ollama adapter path.",
              }),
            ),
          ),
        );

        assert.equal(
          events.some((event) => event.type === "runtime.error"),
          false,
        );
        assert.equal(
          events.some(
            (event) =>
              event.type === "content.delta" &&
              event.payload.streamKind === "assistant_text" &&
              event.payload.delta.length > 0,
          ),
          true,
        );
      }),
    ),
  120_000,
);

it.live.skipIf(!LIVE_OLLAMA_TESTS_ENABLED)(
  "preserves a real ollamaLocal Codex session across two turns and clears adapter state on stop",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(() => ensureLiveEndpointReachable());

        const runPromise = Effect.runPromise;
        const adapter = yield* makeLiveAdapter();
        const threadId = asThreadId("thread-live-ollama-history");

        yield* adapter.startSession({
          threadId,
          provider: "ollamaLocal",
          runtimeMode: "full-access",
        });

        const firstTurnEvents = yield* Effect.promise(() =>
          collectTurnEvents(runPromise, adapter.streamEvents, () =>
            runPromise(
              adapter.sendTurn({
                threadId,
                input: "Reply with a concise acknowledgement.",
              }),
            ),
          ),
        );
        assert.equal(
          firstTurnEvents.some((event) => event.type === "runtime.error"),
          false,
        );

        const secondTurnEvents = yield* Effect.promise(() =>
          collectTurnEvents(runPromise, adapter.streamEvents, () =>
            runPromise(
              adapter.sendTurn({
                threadId,
                input: "Reply again and mention that this is the second turn.",
              }),
            ),
          ),
        );
        assert.equal(
          secondTurnEvents.some((event) => event.type === "runtime.error"),
          false,
        );

        const snapshot = yield* adapter.readThread(threadId);
        assert.equal(snapshot.turns.length, 2);

        yield* adapter.stopSession(threadId);
        assert.equal(yield* adapter.hasSession(threadId), false);
      }),
    ),
  120_000,
);

it.live.skipIf(!LIVE_OLLAMA_TESTS_ENABLED)(
  "keeps ollamaLocal provider identity and per-turn model selection against the live endpoint",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(() => ensureLiveEndpointReachable());

        const runPromise = Effect.runPromise;
        const adapter = yield* makeLiveAdapter();
        const threadId = asThreadId("thread-live-ollama-provider-identity");

        const session = yield* adapter.startSession({
          threadId,
          provider: "ollamaLocal",
          runtimeMode: "full-access",
        });
        assert.equal(session.provider, "ollamaLocal");

        const events = yield* Effect.promise(() =>
          collectTurnEvents(runPromise, adapter.streamEvents, () =>
            runPromise(
              adapter.sendTurn({
                threadId,
                input: "Reply with exactly: acknowledged",
                modelSelection: {
                  provider: "ollamaLocal",
                  model: LIVE_OLLAMA_MODEL,
                },
              }),
            ),
          ),
        );

        assert.equal(
          events.some((event) => event.type === "runtime.error"),
          false,
        );

        const sessions = yield* adapter.listSessions();
        assert.equal(sessions[0]?.provider, "ollamaLocal");
        assert.equal(sessions[0]?.model, LIVE_OLLAMA_MODEL);
      }),
    ),
  120_000,
);

it.live.skipIf(!LIVE_OLLAMA_TESTS_ENABLED)(
  "executes a real shell tool call through the Codex-backed ollamaLocal adapter",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(() => ensureLiveEndpointReachable());

        const runPromise = Effect.runPromise;
        const adapter = yield* makeLiveAdapter();
        const threadId = asThreadId("thread-live-ollama-tool-call");
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-live-ollama-tool-call-"));
        const probePath = path.join(workspaceDir, "tool-probe.txt");

        yield* adapter.startSession({
          threadId,
          provider: "ollamaLocal",
          runtimeMode: "full-access",
          cwd: workspaceDir,
        });

        const events = yield* Effect.promise(() =>
          collectTurnEvents(runPromise, adapter.streamEvents, () =>
            runPromise(
              adapter.sendTurn({
                threadId,
                input: `Use the exec_command tool to run exactly this shell command: printf ok > ${probePath}. After running it, reply with exactly DONE.`,
              }),
            ),
          ),
        );

        assert.equal(
          events.some((event) => event.type === "runtime.error"),
          false,
        );
        assert.equal(
          events.some(
            (event) =>
              event.type === "item.started" && event.payload.itemType === "command_execution",
          ),
          true,
        );
        assert.equal(
          events.some(
            (event) =>
              event.type === "item.completed" && event.payload.itemType === "command_execution",
          ),
          true,
        );
        assert.equal(fs.readFileSync(probePath, "utf8"), "ok");
      }),
    ),
  180_000,
);
