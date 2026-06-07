import type { OllamaSettings } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";

export interface ResolvedOllamaRuntimeConfig {
  readonly baseUrl: string;
  readonly responsesBaseUrl: string;
  readonly model: string;
}

export function resolveOllamaBaseUrl(settings: OllamaSettings): string {
  return `${settings.protocol}://${settings.host}:${settings.port}${settings.apiPath}`;
}

export function resolveOllamaResponsesBaseUrl(settings: OllamaSettings): string {
  return `${settings.protocol}://${settings.host}:${settings.port}${settings.responsesApiPath}`;
}

export function resolveOllamaRuntimeConfig(settings: OllamaSettings): ResolvedOllamaRuntimeConfig {
  return {
    baseUrl: resolveOllamaBaseUrl(settings),
    responsesBaseUrl: resolveOllamaResponsesBaseUrl(settings),
    model: normalizeModelSlug(settings.defaultModel, "ollamaLocal") ?? settings.defaultModel,
  };
}

export function listOllamaConfiguredModels(settings: OllamaSettings): ReadonlyArray<string> {
  return [settings.defaultModel, ...settings.customModels];
}
