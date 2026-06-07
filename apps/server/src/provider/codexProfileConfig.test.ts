import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CODEX_PROFILE_NAME,
  DEFAULT_OLLAMA_CODEX_PROFILE_NAME,
  type CodexSettings,
  type OllamaSettings,
} from "@t3tools/contracts";
import {
  buildManagedCodexAppServerConfigOverrides,
  buildManagedOllamaCodexProfile,
  buildManagedOpenAICodexProfile,
  MANAGED_OLLAMA_PROVIDER_ID,
  OLLAMA_LOCAL_WEB_SEARCH_MODE,
  resolveManagedCodexProfileName,
  resolveManagedOllamaCodexProfileName,
} from "./codexProfileConfig.ts";
import { resolveOllamaRuntimeConfig } from "./ollamaConfig.ts";

const codexSettings: CodexSettings = {
  enabled: true,
  binaryPath: "codex",
  homePath: "/Users/me/.codex-openai",
  profileName: "t3-openai",
  customModels: [],
};

const ollamaSettings: OllamaSettings = {
  enabled: true,
  protocol: "http",
  host: "192.168.10.12",
  port: 11435,
  apiPath: "/api",
  responsesApiPath: "/v1",
  codexBinaryPath: "codex",
  codexHomePath: "/Users/me/.codex-ollama",
  codexProfileName: "t3-ollama-gpu",
  defaultModel: "qwen3:8b",
  customModels: [],
};

it("renders a managed openai codex profile", () => {
  const profile = buildManagedOpenAICodexProfile({ model: "gpt-5.4" });

  assert.include(profile, 'model_provider = "openai"');
  assert.include(profile, 'model = "gpt-5.4"');
});

it("renders a managed ollama codex profile against the gpu endpoint", () => {
  const profile = buildManagedOllamaCodexProfile(resolveOllamaRuntimeConfig(ollamaSettings));

  assert.include(profile, 'model = "qwen3:8b"');
  assert.include(profile, `web_search = "${OLLAMA_LOCAL_WEB_SEARCH_MODE}"`);
  assert.include(profile, `model_provider = "${MANAGED_OLLAMA_PROVIDER_ID}"`);
  assert.include(profile, "[features]");
  assert.include(profile, "multi_agent = false");
  assert.include(profile, 'base_url = "http://192.168.10.12:11435/v1/"');
  assert.include(profile, 'wire_api = "responses"');
});

it("builds app-server config overrides for the managed ollama provider", () => {
  const overrides = buildManagedCodexAppServerConfigOverrides({
    provider: "ollamaLocal",
    ollamaSettings: { ...ollamaSettings, defaultModel: "qwen3:14b" },
  });

  assert.deepStrictEqual(overrides, [
    'model="qwen3:14b"',
    `web_search="${OLLAMA_LOCAL_WEB_SEARCH_MODE}"`,
    "features.multi_agent=false",
    `model_provider="${MANAGED_OLLAMA_PROVIDER_ID}"`,
    `model_providers.${MANAGED_OLLAMA_PROVIDER_ID}.name="Ollama GPU"`,
    `model_providers.${MANAGED_OLLAMA_PROVIDER_ID}.base_url="http://192.168.10.12:11435/v1/"`,
    `model_providers.${MANAGED_OLLAMA_PROVIDER_ID}.wire_api="responses"`,
  ]);
});

it("builds app-server config overrides for the managed openai provider", () => {
  const overrides = buildManagedCodexAppServerConfigOverrides({
    provider: "codex",
    codexSettings,
    model: "gpt-5.4",
  });

  assert.deepStrictEqual(overrides, ['model_provider="openai"', 'model="gpt-5.4"']);
});

it("resolves explicit managed profile names from settings", () => {
  assert.equal(resolveManagedCodexProfileName(codexSettings), "t3-openai");
  assert.equal(resolveManagedOllamaCodexProfileName(ollamaSettings), "t3-ollama-gpu");
});

it("falls back to default managed profile names when settings are blank", () => {
  assert.equal(
    resolveManagedCodexProfileName({ ...codexSettings, profileName: "" }),
    DEFAULT_CODEX_PROFILE_NAME,
  );
  assert.equal(
    resolveManagedOllamaCodexProfileName({ ...ollamaSettings, codexProfileName: "" }),
    DEFAULT_OLLAMA_CODEX_PROFILE_NAME,
  );
});
