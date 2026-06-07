import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.equal(DEFAULT_SERVER_SETTINGS.startupThreadTarget, "executive");
      assert.deepEqual(decodePatch({ startupThreadTarget: "orchestrator" }), {
        startupThreadTarget: "orchestrator",
      });

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });
      assert.deepEqual(
        decodePatch({
          providers: {
            codex: {
              homePath: "/Users/me/.codex-openai",
              profileName: "t3-openai",
            },
            ollamaLocal: {
              host: "192.168.10.12",
              port: 11435,
              apiPath: "/api",
              responsesApiPath: "/v1",
              codexBinaryPath: "/opt/codex/bin/codex",
              codexHomePath: "/Users/me/.codex-ollama",
              codexProfileName: "t3-ollama-gpu",
              defaultModel: "qwen3:8b",
            },
          },
        }),
        {
          providers: {
            codex: {
              homePath: "/Users/me/.codex-openai",
              profileName: "t3-openai",
            },
            ollamaLocal: {
              host: "192.168.10.12",
              port: 11435,
              apiPath: "/api",
              responsesApiPath: "/v1",
              codexBinaryPath: "/opt/codex/bin/codex",
              codexHomePath: "/Users/me/.codex-ollama",
              codexProfileName: "t3-ollama-gpu",
              defaultModel: "qwen3:8b",
            },
          },
        },
      );
      assert.deepEqual(
        decodePatch({
          providers: {
            ollamaLocal: {
              host: "ollama.internal",
              port: 11435,
              apiPath: "/api",
              defaultModel: "qwen3:14b",
            },
          },
        }),
        {
          providers: {
            ollamaLocal: {
              host: "ollama.internal",
              port: 11435,
              apiPath: "/api",
              defaultModel: "qwen3:14b",
            },
          },
        },
      );

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }),
        {
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        },
      );
    }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
            profileName: "t3-openai",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
          ollamaLocal: {
            host: "ollama.internal",
            port: 11435,
            responsesApiPath: "/v1",
            codexBinaryPath: "/usr/local/bin/codex",
            codexHomePath: "/Users/julius/.codex-ollama",
            codexProfileName: "t3-ollama-gpu",
            defaultModel: "qwen3:14b",
          },
        },
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          ollamaLocal: {
            apiPath: "gpu-api",
          },
        },
        textGenerationModelSelection: {
          options: {
            fastMode: false,
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        profileName: "t3-openai",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        customModels: ["claude-custom"],
      });
      assert.deepEqual(next.providers.ollamaLocal, {
        enabled: true,
        protocol: "http",
        host: "ollama.internal",
        port: 11435,
        apiPath: "/gpu-api",
        responsesApiPath: "/v1",
        codexBinaryPath: "/usr/local/bin/codex",
        codexHomePath: "/Users/julius/.codex-ollama",
        codexProfileName: "t3-ollama-gpu",
        defaultModel: "qwen3:14b",
        customModels: [],
      });
      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: {
          reasoningEffort: "high",
          fastMode: false,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            effort: "high",
          },
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "high",
          },
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "high",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("drops stale text generation options when resetting model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.provider,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.provider,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        profileName: "t3-openai",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        customModels: [],
      });
      assert.deepEqual(next.providers.ollamaLocal, DEFAULT_SERVER_SETTINGS.providers.ollamaLocal);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("normalizes ollama connection settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          ollamaLocal: {
            host: "  ollama.internal  ",
            port: 70_000,
            apiPath: "v1",
            defaultModel: "  qwen3:14b  ",
          },
        },
      });

      assert.deepEqual(next.providers.ollamaLocal, {
        enabled: true,
        protocol: "http",
        host: "ollama.internal",
        port: 65_535,
        apiPath: "/v1",
        responsesApiPath: "/v1",
        codexBinaryPath: "codex",
        codexHomePath: "~/.codex-ollama",
        codexProfileName: "t3-ollama-gpu",
        defaultModel: "qwen3:14b",
        customModels: [],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
