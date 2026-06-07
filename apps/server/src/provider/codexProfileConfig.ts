import OS from "node:os";
import path from "node:path";
import {
  type CodexSettings,
  type OllamaSettings,
  DEFAULT_CODEX_PROFILE_NAME,
  DEFAULT_OLLAMA_CODEX_PROFILE_NAME,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import {
  resolveOllamaResponsesBaseUrl,
  resolveOllamaRuntimeConfig,
  type ResolvedOllamaRuntimeConfig,
} from "./ollamaConfig.ts";
import { expandHomePath } from "../pathExpansion.ts";

export const MANAGED_OLLAMA_PROVIDER_ID = "t3_ollama_gpu_provider";
// Local Ollama models mis-handle Codex's built-in web-search and multi-agent tool surfaces.
export const OLLAMA_LOCAL_WEB_SEARCH_MODE = "disabled";

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function resolveManagedCodexProfileName(settings: CodexSettings): string {
  return settings.profileName || DEFAULT_CODEX_PROFILE_NAME;
}

export function resolveManagedOllamaCodexProfileName(settings: OllamaSettings): string {
  return settings.codexProfileName || DEFAULT_OLLAMA_CODEX_PROFILE_NAME;
}

export function resolveManagedCodexHomePath(homePath?: string): string {
  return expandHomePath(homePath || process.env.CODEX_HOME || path.join(OS.homedir(), ".codex"));
}

export function resolveManagedCodexProfilePath(input: {
  readonly homePath?: string;
  readonly profileName: string;
}): string {
  return path.join(resolveManagedCodexHomePath(input.homePath), `${input.profileName}.config.toml`);
}

export function buildManagedOpenAICodexProfile(input: { readonly model: string }): string {
  const model = normalizeModelSlug(input.model, "codex") ?? input.model;
  return [`model_provider = "openai"`, `model = "${model}"`, ""].join("\n");
}

export function buildManagedOllamaCodexProfile(
  input: OllamaSettings | ResolvedOllamaRuntimeConfig,
): string {
  const runtimeConfig =
    "baseUrl" in input
      ? {
          baseUrl: input.baseUrl,
          responsesBaseUrl: input.responsesBaseUrl,
          model: input.model,
        }
      : resolveOllamaRuntimeConfig(input);
  const baseUrl = ensureTrailingSlash(runtimeConfig.responsesBaseUrl);
  return [
    `model = "${runtimeConfig.model}"`,
    `web_search = "${OLLAMA_LOCAL_WEB_SEARCH_MODE}"`,
    `model_provider = "${MANAGED_OLLAMA_PROVIDER_ID}"`,
    "",
    `[features]`,
    `multi_agent = false`,
    "",
    `[model_providers.${MANAGED_OLLAMA_PROVIDER_ID}]`,
    `name = "Ollama GPU"`,
    `base_url = "${baseUrl}"`,
    `wire_api = "responses"`,
    "",
  ].join("\n");
}

export function buildManagedCodexAppServerConfigOverrides(input: {
  readonly provider: "codex" | "ollamaLocal";
  readonly codexSettings?: CodexSettings;
  readonly ollamaSettings?: OllamaSettings;
  readonly model?: string;
}): ReadonlyArray<string> {
  if (input.provider === "codex") {
    const model =
      normalizeModelSlug(
        input.model ?? input.codexSettings?.customModels[0] ?? "gpt-5.4",
        "codex",
      ) ??
      input.model ??
      input.codexSettings?.customModels[0] ??
      "gpt-5.4";
    return [`model_provider="openai"`, `model="${model}"`];
  }

  const ollamaSettings = input.ollamaSettings;
  if (!ollamaSettings) {
    throw new Error("Ollama settings are required to build managed Codex app-server overrides.");
  }
  const runtimeConfig = resolveOllamaRuntimeConfig({
    ...ollamaSettings,
    defaultModel:
      normalizeModelSlug(input.model ?? ollamaSettings.defaultModel, "ollamaLocal") ??
      input.model ??
      ollamaSettings.defaultModel,
  });
  const baseUrl = ensureTrailingSlash(resolveOllamaResponsesBaseUrl(ollamaSettings));
  return [
    `model="${runtimeConfig.model}"`,
    `web_search="${OLLAMA_LOCAL_WEB_SEARCH_MODE}"`,
    `features.multi_agent=false`,
    `model_provider="${MANAGED_OLLAMA_PROVIDER_ID}"`,
    `model_providers.${MANAGED_OLLAMA_PROVIDER_ID}.name="Ollama GPU"`,
    `model_providers.${MANAGED_OLLAMA_PROVIDER_ID}.base_url="${baseUrl}"`,
    `model_providers.${MANAGED_OLLAMA_PROVIDER_ID}.wire_api="responses"`,
  ];
}

export function resolveCodexProfileContents(input: {
  readonly provider: "codex" | "ollamaLocal";
  readonly codexSettings?: CodexSettings;
  readonly ollamaSettings?: OllamaSettings;
  readonly model?: string;
}): string {
  if (input.provider === "codex") {
    const model =
      normalizeModelSlug(
        input.model ?? input.codexSettings?.customModels[0] ?? "gpt-5.4",
        "codex",
      ) ??
      input.model ??
      input.codexSettings?.customModels[0] ??
      "gpt-5.4";
    return buildManagedOpenAICodexProfile({ model });
  }

  const ollamaSettings = input.ollamaSettings;
  if (!ollamaSettings) {
    throw new Error("Ollama settings are required to build the managed Ollama Codex profile.");
  }
  const model =
    normalizeModelSlug(input.model ?? ollamaSettings.defaultModel, "ollamaLocal") ??
    input.model ??
    ollamaSettings.defaultModel;
  return buildManagedOllamaCodexProfile({
    ...resolveOllamaRuntimeConfig({ ...ollamaSettings, defaultModel: model }),
    responsesBaseUrl: resolveOllamaResponsesBaseUrl(ollamaSettings),
  });
}
