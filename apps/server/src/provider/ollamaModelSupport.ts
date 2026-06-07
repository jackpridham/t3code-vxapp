import type { ServerProviderModelAgentSupport } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";

export const VERIFIED_OLLAMA_AGENT_MODEL = "qwen3:8b";

const VERIFIED_ON = "2026-06-07";

const VERIFIED_SUPPORT_MESSAGE = `Verified for Codex tool-enabled Ollama sessions in T3 on ${VERIFIED_ON}.`;
const UNVERIFIED_SUPPORT_MESSAGE = `This Ollama model is not yet verified for Codex tool-enabled sessions in T3. Use ${VERIFIED_OLLAMA_AGENT_MODEL} for verified agent support.`;

const OLLAMA_AGENT_SUPPORT_BY_MODEL: Record<string, ServerProviderModelAgentSupport> = {
  "qwen3:8b": {
    status: "verified",
    message: VERIFIED_SUPPORT_MESSAGE,
  },
  "qwen2.5-coder:14b": {
    status: "unsupported",
    message: `Failed live Codex tool-call verification on ${VERIFIED_ON}. Use ${VERIFIED_OLLAMA_AGENT_MODEL} instead.`,
  },
  "qwen2.5-coder:7b": {
    status: "unsupported",
    message: `Failed live Codex tool-call verification on ${VERIFIED_ON}. Use ${VERIFIED_OLLAMA_AGENT_MODEL} instead.`,
  },
  "deepseek-coder-v2:16b": {
    status: "unsupported",
    message: `The live Ollama runtime reported that this model does not support tools on ${VERIFIED_ON}. Use ${VERIFIED_OLLAMA_AGENT_MODEL} instead.`,
  },
};

export function getOllamaAgentSupport(
  model: string | null | undefined,
): ServerProviderModelAgentSupport {
  const normalized = normalizeModelSlug(model, "ollamaLocal");
  if (!normalized) {
    return {
      status: "unverified",
      message: UNVERIFIED_SUPPORT_MESSAGE,
    };
  }
  return (
    OLLAMA_AGENT_SUPPORT_BY_MODEL[normalized] ?? {
      status: "unverified",
      message: UNVERIFIED_SUPPORT_MESSAGE,
    }
  );
}

export function isVerifiedOllamaAgentModel(model: string | null | undefined): boolean {
  return getOllamaAgentSupport(model).status === "verified";
}
