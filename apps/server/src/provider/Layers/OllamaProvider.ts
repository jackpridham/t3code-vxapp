import type { OllamaSettings, ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import { Effect, Equal, Layer, Stream } from "effect";

import { listOllamaConfiguredModels, resolveOllamaRuntimeConfig } from "../ollamaConfig.ts";
import { getOllamaAgentSupport, isVerifiedOllamaAgentModel } from "../ollamaModelSupport.ts";
import { listOllamaModels } from "../ollamaApi.ts";
import { buildServerProvider, providerModelsFromSettings } from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { OllamaProvider } from "../Services/OllamaProvider";
import { ServerSettingsService } from "../../serverSettings";

const PROVIDER = "ollamaLocal" as const;
const OLLAMA_PROVIDER_PROBE_TIMEOUT_MS = 4_000;

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "qwen3:8b",
    name: "Qwen3 8B",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
    agentSupport: getOllamaAgentSupport("qwen3:8b"),
  },
];

function haveSettingsChanged(previous: OllamaSettings, next: OllamaSettings): boolean {
  return !Equal.equals(previous, next);
}

function buildOllamaModels(
  settings: OllamaSettings,
  liveModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(BUILT_IN_MODELS, PROVIDER, [
    ...liveModels,
    ...listOllamaConfiguredModels(settings),
  ]).map((model) => ({
    slug: model.slug,
    name: model.name,
    isCustom: model.isCustom,
    capabilities: model.capabilities,
    agentSupport: getOllamaAgentSupport(model.slug),
  }));
}

function buildLocalAuth() {
  return {
    status: "unknown" as const,
    type: "local" as const,
    label: "Local Ollama",
  };
}

export function checkOllamaProvider(
  settings: OllamaSettings,
  options?: {
    readonly fetch?: typeof fetch;
    readonly checkedAt?: string;
  },
): Effect.Effect<ServerProvider> {
  const runtimeConfig = resolveOllamaRuntimeConfig(settings);
  const checkedAt = options?.checkedAt ?? new Date().toISOString();
  const configuredModels = buildOllamaModels(settings, []);

  if (!settings.enabled) {
    return Effect.succeed(
      buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models: configuredModels,
        probe: {
          installed: false,
          version: null,
          status: "ready",
          auth: buildLocalAuth(),
          message: `Disabled. Reachability to ${runtimeConfig.baseUrl} was not checked.`,
        },
      }),
    );
  }

  return listOllamaModels({
    baseUrl: runtimeConfig.baseUrl,
    timeoutMs: OLLAMA_PROVIDER_PROBE_TIMEOUT_MS,
    ...(options?.fetch !== undefined ? { fetch: options.fetch } : {}),
  }).pipe(
    Effect.map((liveModels) => {
      const hasDefaultModel = liveModels.includes(runtimeConfig.model);
      const defaultModelVerified = isVerifiedOllamaAgentModel(runtimeConfig.model);
      const status =
        liveModels.length === 0 || !hasDefaultModel || !defaultModelVerified
          ? ("warning" as const)
          : ("ready" as const);
      const defaultModelSupport = getOllamaAgentSupport(runtimeConfig.model);
      const message =
        liveModels.length === 0
          ? `Connected to ${runtimeConfig.baseUrl}, but no Ollama models are available.`
          : !hasDefaultModel
            ? `Connected to ${runtimeConfig.baseUrl}, but default model ${runtimeConfig.model} is not available.`
            : defaultModelVerified
              ? `Connected to ${runtimeConfig.baseUrl} with ${runtimeConfig.model}.`
              : `Connected to ${runtimeConfig.baseUrl}, but default model ${runtimeConfig.model} is not ready for Codex tool-enabled sessions. ${defaultModelSupport.message}`;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models: buildOllamaModels(settings, liveModels),
        probe: {
          installed: true,
          version: null,
          status,
          auth: buildLocalAuth(),
          message,
        },
      });
    }),
    Effect.catch((error) =>
      Effect.succeed(
        buildServerProvider({
          provider: PROVIDER,
          enabled: true,
          checkedAt,
          models: configuredModels,
          probe: {
            installed: false,
            version: null,
            status: "error",
            auth: buildLocalAuth(),
            message: `Unable to reach ${runtimeConfig.baseUrl}: ${error.message}`,
          },
        }),
      ),
    ),
  );
}

export const OllamaProviderLive = Layer.effect(
  OllamaProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const getSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.providers.ollamaLocal),
      Effect.orDie,
    );
    const streamSettings = serverSettings.streamChanges.pipe(
      Stream.map((settings) => settings.providers.ollamaLocal),
    );

    return yield* makeManagedServerProvider<OllamaSettings>({
      getSettings,
      streamSettings,
      haveSettingsChanged,
      checkProvider: getSettings.pipe(Effect.flatMap((settings) => checkOllamaProvider(settings))),
    });
  }),
);
