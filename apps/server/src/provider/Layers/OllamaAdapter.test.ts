import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, vi } from "@effect/vitest";
import { Effect, Layer, Queue, Scope, Schema, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterValidationError } from "../Errors.ts";
import {
  type CodexSessionRuntimeOptions,
  type CodexSessionRuntimeSendTurnInput,
  type CodexSessionRuntimeShape,
  type CodexThreadSnapshot,
} from "./CodexSessionRuntime.ts";
import { makeOllamaAdapterLive } from "./OllamaAdapter.ts";
import { OllamaAdapter } from "../Services/OllamaAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

class FakeCodexRuntime implements CodexSessionRuntimeShape {
  private readonly eventQueue = Effect.runSync(Queue.unbounded<ProviderEvent>());
  private readonly now = new Date().toISOString();

  readonly options: CodexSessionRuntimeOptions;

  public readonly startImpl = vi.fn(() =>
    Promise.resolve({
      provider: this.options.provider ?? "codex",
      status: "ready" as const,
      runtimeMode: this.options.runtimeMode,
      threadId: this.options.threadId,
      cwd: this.options.cwd,
      ...(this.options.model ? { model: this.options.model } : {}),
      createdAt: this.now,
      updatedAt: this.now,
    } satisfies ProviderSession),
  );

  public readonly sendTurnImpl = vi.fn(
    (_input: CodexSessionRuntimeSendTurnInput): Promise<ProviderTurnStartResult> =>
      Promise.resolve({
        threadId: this.options.threadId,
        turnId: asTurnId("turn-1"),
      }),
  );

  constructor(options: CodexSessionRuntimeOptions) {
    this.options = options;
  }

  start() {
    return Effect.promise(() => this.startImpl());
  }

  getSession = Effect.promise(() => this.startImpl());

  sendTurn(input: CodexSessionRuntimeSendTurnInput) {
    return Effect.promise(() => this.sendTurnImpl(input));
  }

  interruptTurn = () => Effect.void;

  readThread = Effect.succeed({
    threadId: "provider-thread-1",
    turns: [],
  } satisfies CodexThreadSnapshot);

  rollbackThread = (_numTurns: number) =>
    Effect.succeed({
      threadId: "provider-thread-1",
      turns: [],
    } satisfies CodexThreadSnapshot);

  respondToRequest = (_requestId: string, _decision: ProviderApprovalDecision) => Effect.void;

  respondToUserInput = (_requestId: string, _answers: ProviderUserInputAnswers) => Effect.void;

  get events() {
    return Stream.fromQueue(this.eventQueue);
  }

  close = Effect.void;
}

function makeRuntimeFactory() {
  const runtimes: Array<FakeCodexRuntime> = [];
  const factory = vi.fn((options: CodexSessionRuntimeOptions) =>
    Effect.gen(function* () {
      yield* Scope.Scope;
      const runtime = new FakeCodexRuntime(options);
      runtimes.push(runtime);
      return runtime;
    }),
  );

  return {
    factory,
    get lastRuntime(): FakeCodexRuntime | undefined {
      return runtimes.at(-1);
    },
  };
}

it.effect("starts ollamaLocal through the Codex harness with isolated launch settings", () =>
  Effect.gen(function* () {
    const runtimeFactory = makeRuntimeFactory();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-codex-home-"));
    const layer = makeOllamaAdapterLive({ makeRuntime: runtimeFactory.factory }).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            ollamaLocal: {
              host: "192.168.10.12",
              port: 11435,
              apiPath: "/api",
              responsesApiPath: "/v1",
              codexBinaryPath: "/usr/local/bin/codex-ollama",
              codexHomePath: codexHome,
              codexProfileName: "t3-ollama-gpu",
              defaultModel: "qwen3:8b",
            },
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    const adapter = yield* Effect.service(OllamaAdapter).pipe(Effect.provide(layer));
    const session = yield* adapter
      .startSession({
        provider: "ollamaLocal",
        threadId: asThreadId("thread-ollama-managed"),
        modelSelection: createModelSelection("ollamaLocal", "qwen3:8b"),
        runtimeMode: "full-access",
      })
      .pipe(Effect.provide(layer));

    assert.equal(session.provider, "ollamaLocal");
    assert.equal(adapter.capabilities.sessionRecovery, "resume-cursor");
    assert.deepStrictEqual(runtimeFactory.lastRuntime?.options, {
      provider: "ollamaLocal",
      threadId: asThreadId("thread-ollama-managed"),
      cwd: process.cwd(),
      binaryPath: "/usr/local/bin/codex-ollama",
      homePath: codexHome,
      profileName: "t3-ollama-gpu",
      appServerConfigOverrides: [
        'model="qwen3:8b"',
        'web_search="disabled"',
        "features.multi_agent=false",
        'model_provider="t3_ollama_gpu_provider"',
        'model_providers.t3_ollama_gpu_provider.name="Ollama GPU"',
        'model_providers.t3_ollama_gpu_provider.base_url="http://192.168.10.12:11435/v1/"',
        'model_providers.t3_ollama_gpu_provider.wire_api="responses"',
      ],
      runtimeMode: "full-access",
      model: "qwen3:8b",
    });

    const profileContents = fs.readFileSync(
      path.join(codexHome, "t3-ollama-gpu.config.toml"),
      "utf8",
    );
    assert.match(profileContents, /model = "qwen3:8b"/);
    assert.match(profileContents, /web_search = "disabled"/);
    assert.match(profileContents, /\[features\]/);
    assert.match(profileContents, /multi_agent = false/);
    assert.match(profileContents, /model_provider = "t3_ollama_gpu_provider"/);
    assert.match(profileContents, /base_url = "http:\/\/192\.168\.10\.12:11435\/v1\/"/);
    assert.match(profileContents, /wire_api = "responses"/);
  }),
);

it.effect("forwards ollamaLocal model selection without codex-only turn options", () =>
  Effect.gen(function* () {
    const runtimeFactory = makeRuntimeFactory();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-codex-home-"));
    const layer = makeOllamaAdapterLive({ makeRuntime: runtimeFactory.factory }).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            ollamaLocal: {
              codexHomePath: codexHome,
            },
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
    const adapter = yield* Effect.service(OllamaAdapter).pipe(Effect.provide(layer));

    yield* adapter
      .startSession({
        provider: "ollamaLocal",
        threadId: asThreadId("thread-ollama-turn"),
        runtimeMode: "full-access",
      })
      .pipe(Effect.provide(layer));

    const runtime = runtimeFactory.lastRuntime;
    assert.ok(runtime);
    runtime.sendTurnImpl.mockClear();

    yield* adapter
      .sendTurn({
        threadId: asThreadId("thread-ollama-turn"),
        input: "hello",
        modelSelection: createModelSelection("ollamaLocal", "qwen3:8b"),
      })
      .pipe(Effect.provide(layer));

    assert.deepStrictEqual(runtime.sendTurnImpl.mock.calls[0]?.[0], {
      input: "hello",
      model: "qwen3:8b",
    });
  }),
);

it.effect("injects repo grounding context for docs-like ollamaLocal turns", () =>
  Effect.gen(function* () {
    const runtimeFactory = makeRuntimeFactory();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-codex-home-"));
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-docs-repo-"));
    fs.writeFileSync(
      path.join(repoDir, "README.md"),
      "# Repo Docs\n\nThis repo documents the API and architecture.\n",
      "utf8",
    );
    const layer = makeOllamaAdapterLive({ makeRuntime: runtimeFactory.factory }).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            ollamaLocal: {
              codexHomePath: codexHome,
            },
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
    const adapter = yield* Effect.service(OllamaAdapter).pipe(Effect.provide(layer));

    yield* adapter
      .startSession({
        provider: "ollamaLocal",
        threadId: asThreadId("thread-ollama-grounding"),
        runtimeMode: "full-access",
        cwd: repoDir,
      })
      .pipe(Effect.provide(layer));

    const runtime = runtimeFactory.lastRuntime;
    assert.ok(runtime);
    runtime.sendTurnImpl.mockClear();

    yield* adapter
      .sendTurn({
        threadId: asThreadId("thread-ollama-grounding"),
        input: "How does this repo's API work?",
        modelSelection: createModelSelection("ollamaLocal", "qwen3:8b"),
      })
      .pipe(Effect.provide(layer));

    const sentInput = runtime.sendTurnImpl.mock.calls[0]?.[0];
    assert.ok(sentInput);
    assert.equal(sentInput.model, "qwen3:8b");
    assert.match(sentInput.input ?? "", /<repo_grounding_guard>/);
    assert.match(
      sentInput.input ?? "",
      /Read `README\.md` in the workspace root before answering\./,
    );
    assert.match(sentInput.input ?? "", /# Repo Docs/);
    assert.match(sentInput.input ?? "", /How does this repo's API work\?/);
  }),
);

it.effect(
  "rejects unsupported ollamaLocal models before starting a Codex-backed agent session",
  () =>
    Effect.gen(function* () {
      const runtimeFactory = makeRuntimeFactory();
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-codex-home-"));
      const layer = makeOllamaAdapterLive({ makeRuntime: runtimeFactory.factory }).pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(
          ServerSettingsService.layerTest({
            providers: {
              ollamaLocal: {
                codexHomePath: codexHome,
              },
            },
          }),
        ),
        Layer.provideMerge(NodeServices.layer),
      );

      const adapter = yield* Effect.service(OllamaAdapter).pipe(Effect.provide(layer));
      const failure = yield* adapter
        .startSession({
          provider: "ollamaLocal",
          threadId: asThreadId("thread-ollama-unsupported-start"),
          modelSelection: createModelSelection("ollamaLocal", "qwen2.5-coder:14b"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.flip, Effect.provide(layer));

      assert.equal(Schema.is(ProviderAdapterValidationError)(failure), true);
      if (!Schema.is(ProviderAdapterValidationError)(failure)) {
        return;
      }
      assert.match(failure.issue, /qwen2\.5-coder:14b/);
      assert.equal(runtimeFactory.lastRuntime, undefined);
    }),
);

it.effect("rejects unsupported ollamaLocal per-turn model switches before dispatch", () =>
  Effect.gen(function* () {
    const runtimeFactory = makeRuntimeFactory();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-codex-home-"));
    const layer = makeOllamaAdapterLive({ makeRuntime: runtimeFactory.factory }).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            ollamaLocal: {
              codexHomePath: codexHome,
            },
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
    const adapter = yield* Effect.service(OllamaAdapter).pipe(Effect.provide(layer));

    yield* adapter
      .startSession({
        provider: "ollamaLocal",
        threadId: asThreadId("thread-ollama-unsupported-turn"),
        runtimeMode: "full-access",
      })
      .pipe(Effect.provide(layer));

    const runtime = runtimeFactory.lastRuntime;
    assert.ok(runtime);
    runtime.sendTurnImpl.mockClear();

    const failure = yield* adapter
      .sendTurn({
        threadId: asThreadId("thread-ollama-unsupported-turn"),
        input: "hello",
        modelSelection: createModelSelection("ollamaLocal", "deepseek-coder-v2:16b"),
      })
      .pipe(Effect.flip, Effect.provide(layer));

    assert.equal(Schema.is(ProviderAdapterValidationError)(failure), true);
    if (!Schema.is(ProviderAdapterValidationError)(failure)) {
      return;
    }
    assert.match(failure.issue, /deepseek-coder-v2:16b/);
    assert.equal(runtime.sendTurnImpl.mock.calls.length, 0);
  }),
);

it.effect("ignores codex-only model selection when the active adapter is ollamaLocal", () =>
  Effect.gen(function* () {
    const runtimeFactory = makeRuntimeFactory();
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ollama-codex-home-"));
    const layer = makeOllamaAdapterLive({ makeRuntime: runtimeFactory.factory }).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            ollamaLocal: {
              codexHomePath: codexHome,
            },
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
    const adapter = yield* Effect.service(OllamaAdapter).pipe(Effect.provide(layer));

    yield* adapter
      .startSession({
        provider: "ollamaLocal",
        threadId: asThreadId("thread-ollama-ignore-mismatch"),
        runtimeMode: "full-access",
      })
      .pipe(Effect.provide(layer));

    const runtime = runtimeFactory.lastRuntime;
    assert.ok(runtime);
    runtime.sendTurnImpl.mockClear();

    yield* adapter
      .sendTurn({
        threadId: asThreadId("thread-ollama-ignore-mismatch"),
        input: "hello",
        modelSelection: createModelSelection("codex", "gpt-5.4", {
          fastMode: true,
        }),
      })
      .pipe(Effect.provide(layer));

    assert.deepStrictEqual(runtime.sendTurnImpl.mock.calls[0]?.[0], {
      input: "hello",
    });
  }),
);
