# Codex Ollama Profile Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `ollamaLocal` through the Codex harness with a GPU-backed Ollama profile, while keeping OpenAI Codex and Ollama Codex isolated and usable side by side inside T3.

**Architecture:** Reuse one Codex app-server runtime for both coding-agent providers instead of maintaining a separate raw-HTTP Ollama agent path. Keep `codex` as the OpenAI-backed Codex provider and migrate `ollamaLocal` to a Codex-backed provider variant that launches the same Codex binary with a T3-managed Ollama profile, isolated `CODEX_HOME`, and optional separate binary override. Preserve the existing direct Ollama HTTP helpers only for model discovery, readiness checks, and lightweight git/text generation where they remain simpler and faster than going through Codex.

**Tech Stack:** TypeScript, Effect, Codex app-server (`@openai/codex`), Ollama HTTP APIs (`/api/*` and `/v1/*`), SQLite-backed server settings/runtime state, React/Vite, Vitest, Playwright browser tests, `bun run test`, `bun fmt`, `bun lint`, `bun typecheck`

---

## Scope Note

This is still one cohesive plan, not three unrelated projects. The user-facing feature is singular: “T3 can run Codex/OpenAI and Codex/Ollama side by side, with Ollama using the LAN GPU API and the full T3 pipeline working end to end.”

## Working Defaults

- OpenAI Codex remains provider kind `codex`.
- Ollama Codex remains provider kind `ollamaLocal`.
- Primary isolation mechanism: separate `CODEX_HOME` values plus separate profile names.
- Optional extra isolation: separate Codex binary path for `ollamaLocal`.
- Verified GPU endpoint from this session:
  - raw Ollama API: `http://192.168.10.12:11435/api`
  - OpenAI-compatible Ollama API for Codex profiles: `http://192.168.10.12:11435/v1/`
- Default Ollama model for the profile: `qwen3:8b`

## Planned File Structure

- Modify: `packages/contracts/src/settings.ts`
  - Add explicit Codex profile settings for `codex` and `ollamaLocal`.
  - Add a distinct Ollama OpenAI-compatible path setting for Codex (`responsesApiPath`).
- Modify: `apps/server/src/serverSettings.ts`
  - Preserve nested patch semantics for the new profile settings.
- Modify: `apps/server/src/serverSettings.test.ts`
  - Lock new defaults and patch-merge behavior down.
- Create: `apps/server/src/provider/codexProfileConfig.ts`
  - Build deterministic OpenAI and Ollama Codex profile text and resolve per-provider launch config.
- Create: `apps/server/src/provider/codexProfileConfig.test.ts`
  - Test profile rendering, path normalization, and default separation.
- Modify: `apps/server/src/provider/codexAppServer.ts`
  - Allow `--profile` app-server startup/probing, not only plain `CODEX_HOME`.
- Create: `apps/server/src/provider/Layers/makeCodexBackedAdapter.ts`
  - Shared adapter factory for provider kinds that use Codex app-server.
- Modify: `apps/server/src/provider/Layers/CodexAdapter.ts`
  - Switch to the shared Codex-backed adapter factory.
- Modify: `apps/server/src/provider/Layers/OllamaAdapter.ts`
  - Replace raw `/api/chat` session runtime with the Codex-backed adapter variant.
- Modify: `apps/server/src/provider/Layers/CodexProvider.ts`
  - Make Codex provider health/profile reads profile-aware.
- Modify: `apps/server/src/provider/Layers/OllamaProvider.ts`
  - Report `ollamaLocal` readiness as “Codex binary usable + GPU API reachable + profile materializable + model present”.
- Modify: `apps/server/src/provider/ollamaConfig.ts`
  - Resolve both `/api` and `/v1` URLs from the same host/port settings.
- Modify: `apps/server/src/provider/ollamaApi.ts`
  - Keep raw `/api` probing and model listing for health and text generation.
- Modify: `apps/server/src/git/Layers/OllamaTextGeneration.ts`
  - Keep git/title/branch generation aligned with the GPU Ollama settings.
- Modify: `apps/server/src/git/Layers/RoutingTextGeneration.ts`
  - Ensure `ollamaLocal` still routes correctly after the runtime migration.
- Modify: `apps/web/src/components/chat/ProviderModelPicker.tsx`
  - Keep OpenAI Codex and Ollama Codex visually separate and selectable.
- Modify: `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
  - Add browser assertions for the two-provider experience.
- Modify: `apps/server/integration/providerService.integration.test.ts`
  - Prove side-by-side provider recovery, launch, and isolation.
- Modify: `apps/server/integration/orchestrationEngine.integration.test.ts`
  - Prove T3 thread flow still works when `ollamaLocal` is Codex-backed.
- Modify: `apps/server/integration/ollamaLocal.live.integration.test.ts`
  - Turn the live suite into a Codex-backed Ollama profile suite.
- Create: `scripts/e2e/ollamaCodexProfileSmoke.ts`
  - Playwright smoke against the real running app, selecting `ollamaLocal` and confirming UI/runtime success.
- Modify: `package.json`
  - Add an explicit root e2e smoke script.
- Modify: `.agents/skills/t3-local-model-provider-workflow/SKILL.md`
  - Replace the “raw Ollama chat runtime” mental model with the new Codex-backed profile architecture.

## Design Rules

- Do not introduce a second agent harness for Ollama. Codex is the harness.
- Do not require a second Codex install by default. Support a second binary path only as an override.
- Do not overload SQLite with duplicated conversation transcripts. Let Codex own its internal thread state inside its own `CODEX_HOME`; keep T3’s normal orchestration and thread projections unchanged.
- Do not route git/text generation through Codex app-server unless a test proves the direct Ollama path is insufficient. The direct non-streaming Ollama path is lower-latency and already exists.
- Do not depend on Ollama CLI on the T3 host. T3 should materialize Codex profile files itself.

### Task 1: Add Explicit Profile Settings For OpenAI Codex And Ollama Codex

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Modify: `apps/server/src/serverSettings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/serverSettings.test.ts
it.effect("decodes codex and ollama codex profile settings", () =>
  Effect.sync(() => {
    const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

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
  }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/serverSettings.test.ts`

Expected: FAIL because `profileName`, `responsesApiPath`, `codexBinaryPath`, `codexHomePath`, and `codexProfileName` are not part of the settings schemas yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/contracts/src/settings.ts
export const DEFAULT_OLLAMA_PORT = 11435;
export const DEFAULT_OLLAMA_API_PATH = "/api";
export const DEFAULT_OLLAMA_RESPONSES_API_PATH = "/v1";
export const DEFAULT_OLLAMA_CODEX_HOME = "~/.codex-ollama";
export const DEFAULT_OLLAMA_CODEX_PROFILE_NAME = "t3-ollama-gpu";
export const DEFAULT_CODEX_PROFILE_NAME = "t3-openai";

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  profileName: TrimmedString.pipe(Schema.withDecodingDefault(() => DEFAULT_CODEX_PROFILE_NAME)),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});

export const OllamaSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  protocol: OllamaProtocol.pipe(Schema.withDecodingDefault(() => DEFAULT_OLLAMA_PROTOCOL)),
  host: makeOllamaHostSetting(),
  port: makeOllamaPortSetting(),
  apiPath: makeOllamaApiPathSetting(),
  responsesApiPath: makeOllamaResponsesApiPathSetting(),
  codexBinaryPath: makeBinaryPathSetting("codex"),
  codexHomePath: TrimmedString.pipe(Schema.withDecodingDefault(() => DEFAULT_OLLAMA_CODEX_HOME)),
  codexProfileName: TrimmedString.pipe(
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_CODEX_PROFILE_NAME),
  ),
  defaultModel: makeOllamaModelSetting(),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test apps/server/src/serverSettings.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/settings.ts apps/server/src/serverSettings.test.ts
git commit -m "feat: add explicit codex profile settings for openai and ollama"
```

### Task 2: Materialize T3-Managed Codex Profiles For OpenAI And GPU Ollama

**Files:**

- Create: `apps/server/src/provider/codexProfileConfig.ts`
- Create: `apps/server/src/provider/codexProfileConfig.test.ts`
- Modify: `apps/server/src/provider/ollamaConfig.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/provider/codexProfileConfig.test.ts
it("renders a managed ollama codex profile against the GPU endpoint", () => {
  const profile = buildManagedOllamaCodexProfile({
    protocol: "http",
    host: "192.168.10.12",
    port: 11435,
    responsesApiPath: "/v1",
    profileName: "t3-ollama-gpu",
    model: "qwen3:8b",
  });

  expect(profile).toContain('model = "qwen3:8b"');
  expect(profile).toContain('model_provider = "t3-ollama-gpu-provider"');
  expect(profile).toContain('base_url = "http://192.168.10.12:11435/v1/"');
  expect(profile).toContain('wire_api = "responses"');
});

it("renders a managed openai codex profile", () => {
  const profile = buildManagedOpenAiCodexProfile({
    profileName: "t3-openai",
    model: "gpt-5.4",
  });

  expect(profile).toContain('model_provider = "openai"');
  expect(profile).toContain('model = "gpt-5.4"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/provider/codexProfileConfig.test.ts`

Expected: FAIL because `codexProfileConfig.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/provider/codexProfileConfig.ts
export const MANAGED_OLLAMA_PROVIDER_ID = "t3-ollama-gpu-provider";

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function buildManagedOpenAiCodexProfile(input: {
  readonly profileName: string;
  readonly model: string;
}): string {
  return [`model_provider = "openai"`, `model = "${input.model}"`, ""].join("\n");
}

export function buildManagedOllamaCodexProfile(input: {
  readonly protocol: "http" | "https";
  readonly host: string;
  readonly port: number;
  readonly responsesApiPath: string;
  readonly profileName: string;
  readonly model: string;
}): string {
  const baseUrl = ensureTrailingSlash(
    `${input.protocol}://${input.host}:${input.port}${input.responsesApiPath}`,
  );
  return [
    `model = "${input.model}"`,
    `model_provider = "${MANAGED_OLLAMA_PROVIDER_ID}"`,
    "",
    `[model_providers.${MANAGED_OLLAMA_PROVIDER_ID}]`,
    `name = "Ollama GPU"`,
    `base_url = "${baseUrl}"`,
    `wire_api = "responses"`,
    "",
  ].join("\n");
}

export function resolveOllamaResponsesBaseUrl(input: {
  readonly protocol: "http" | "https";
  readonly host: string;
  readonly port: number;
  readonly responsesApiPath: string;
}): string {
  return ensureTrailingSlash(
    `${input.protocol}://${input.host}:${input.port}${input.responsesApiPath}`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test apps/server/src/provider/codexProfileConfig.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/codexProfileConfig.ts \
  apps/server/src/provider/codexProfileConfig.test.ts \
  apps/server/src/provider/ollamaConfig.ts
git commit -m "feat: add managed codex profile builders for openai and ollama"
```

### Task 3: Make Codex App-Server Launch And Probe Profile-Aware

**Files:**

- Modify: `apps/server/src/provider/codexAppServer.ts`
- Modify: `apps/server/src/provider/Layers/CodexProvider.ts`
- Test: `apps/server/src/provider/Layers/ProviderRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/provider/Layers/ProviderRegistry.test.ts
it.effect("passes --profile when codex provider settings include profileName", () =>
  Effect.gen(function* () {
    const spawned: Array<ReadonlyArray<string>> = [];

    const status = yield* getCodexSnapshotWithSpawner({
      settings: {
        providers: {
          codex: {
            enabled: true,
            binaryPath: "codex",
            homePath: "/tmp/codex-openai",
            profileName: "t3-openai",
          },
        },
      },
      onSpawn: ({ args }) => {
        spawned.push(args);
        return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
      },
    });

    assert.equal(status.provider, "codex");
    assert.deepEqual(spawned[0], ["--version"]);
    assert.equal(
      spawned.some((args) => args.includes("--profile")),
      true,
    );
  }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/provider/Layers/ProviderRegistry.test.ts`

Expected: FAIL because Codex probes and app-server startup do not know about profile names.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/provider/codexAppServer.ts
function buildCodexAppServerArgs(input?: { readonly profileName?: string }) {
  return input?.profileName ? ["--profile", input.profileName, "app-server"] : ["app-server"];
}

export async function probeCodexAccount(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly profileName?: string;
  readonly signal?: AbortSignal;
}): Promise<CodexAccountSnapshot> {
  const child = spawn(input.binaryPath, buildCodexAppServerArgs(input), {
    env: {
      ...process.env,
      ...(input.homePath ? { CODEX_HOME: expandHomePath(input.homePath) } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  // existing implementation continues unchanged
}

// apps/server/src/provider/Layers/CodexProvider.ts
const codexSettings = settings.providers.codex;
const account =
  yield *
  Effect.promise(() =>
    probeCodexAccount({
      binaryPath: codexSettings.binaryPath,
      homePath: codexSettings.homePath,
      profileName: codexSettings.profileName,
    }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test apps/server/src/provider/Layers/ProviderRegistry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/codexAppServer.ts \
  apps/server/src/provider/Layers/CodexProvider.ts \
  apps/server/src/provider/Layers/ProviderRegistry.test.ts
git commit -m "feat: make codex launch and probe profile-aware"
```

### Task 4: Extract A Shared Codex-Backed Adapter Factory

**Files:**

- Create: `apps/server/src/provider/Layers/makeCodexBackedAdapter.ts`
- Modify: `apps/server/src/provider/Layers/CodexAdapter.ts`
- Test: `apps/server/src/provider/Layers/CodexAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/provider/Layers/CodexAdapter.test.ts
it.effect("passes the configured profile name into codex session runtime startup", () =>
  Effect.gen(function* () {
    const captured: Array<CodexSessionRuntimeOptions> = [];
    const adapter = yield* makeCodexAdapter({
      makeRuntime: (input) => {
        captured.push(input);
        return fakeRuntime();
      },
    });

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: "codex",
      runtimeMode: "full-access",
      modelSelection: createModelSelection("codex", "gpt-5.4"),
    });

    assert.equal(captured[0]?.profileName, "t3-openai");
  }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts`

Expected: FAIL because `CodexSessionRuntimeOptions` and the current adapter path do not carry profile names.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/provider/Layers/makeCodexBackedAdapter.ts
export interface CodexBackedLaunchConfig {
  readonly provider: ProviderKind;
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly profileName?: string;
}

export const makeCodexBackedAdapter = (input: {
  readonly provider: ProviderKind;
  readonly getLaunchConfig: Effect.Effect<CodexBackedLaunchConfig>;
  readonly makeRuntime?: typeof makeCodexSessionRuntime;
}) => {
  // factor the common logic currently duplicated inside CodexAdapter:
  // - startSession
  // - sendTurn
  // - interruptTurn
  // - event fanout
  // - runtime error mapping
};

// apps/server/src/provider/Layers/CodexAdapter.ts
export const CodexAdapterLive = Layer.effect(
  CodexAdapter,
  makeCodexBackedAdapter({
    provider: "codex",
    getLaunchConfig: serverSettingsService.getSettings.pipe(
      Effect.map((settings) => ({
        provider: "codex" as const,
        binaryPath: settings.providers.codex.binaryPath,
        homePath: settings.providers.codex.homePath || undefined,
        profileName: settings.providers.codex.profileName || undefined,
      })),
    ),
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/Layers/makeCodexBackedAdapter.ts \
  apps/server/src/provider/Layers/CodexAdapter.ts \
  apps/server/src/provider/Layers/CodexAdapter.test.ts
git commit -m "refactor: share codex-backed adapter runtime wiring"
```

### Task 5: Migrate `ollamaLocal` From Raw HTTP Chat Runtime To The Codex Harness

**Files:**

- Modify: `apps/server/src/provider/Layers/OllamaAdapter.ts`
- Modify: `apps/server/src/provider/Services/OllamaAdapter.ts`
- Modify: `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- Test: `apps/server/src/provider/Layers/OllamaAdapter.test.ts`
- Test: `apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/provider/Layers/OllamaAdapter.test.ts
it.effect("starts ollamaLocal through codex app-server with the managed ollama profile", () =>
  Effect.gen(function* () {
    const captured: Array<CodexSessionRuntimeOptions> = [];
    const adapter = yield* makeOllamaAdapter({
      makeRuntime: (input) => {
        captured.push(input);
        return fakeRuntime();
      },
    });

    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: "ollamaLocal",
      runtimeMode: "full-access",
    });

    assert.equal(captured[0]?.binaryPath, "/opt/codex/bin/codex");
    assert.equal(captured[0]?.homePath, "/Users/me/.codex-ollama");
    assert.equal(captured[0]?.profileName, "t3-ollama-gpu");
    assert.equal(captured[0]?.model, "qwen3:8b");
  }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test apps/server/src/provider/Layers/OllamaAdapter.test.ts apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts`

Expected: FAIL because `OllamaAdapter` still uses the direct `/api/chat` session runtime and has no Codex profile launch config.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/provider/Layers/OllamaAdapter.ts
export const OllamaAdapterLive = Layer.effect(
  OllamaAdapter,
  makeCodexBackedAdapter({
    provider: "ollamaLocal",
    getLaunchConfig: serverSettingsService.getSettings.pipe(
      Effect.map((settings) => ({
        provider: "ollamaLocal" as const,
        binaryPath: settings.providers.ollamaLocal.codexBinaryPath,
        homePath: settings.providers.ollamaLocal.codexHomePath || undefined,
        profileName: settings.providers.ollamaLocal.codexProfileName || undefined,
      })),
    ),
    defaultModelFromSettings: serverSettingsService.getSettings.pipe(
      Effect.map((settings) => settings.providers.ollamaLocal.defaultModel),
    ),
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test apps/server/src/provider/Layers/OllamaAdapter.test.ts apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/Layers/OllamaAdapter.ts \
  apps/server/src/provider/Services/OllamaAdapter.ts \
  apps/server/src/provider/Layers/ProviderAdapterRegistry.ts \
  apps/server/src/provider/Layers/OllamaAdapter.test.ts \
  apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts
git commit -m "feat: run ollamaLocal through codex app-server profiles"
```

### Task 6: Keep Provider Health, Model Discovery, And Git/Text Generation Aligned

**Files:**

- Modify: `apps/server/src/provider/ollamaConfig.ts`
- Modify: `apps/server/src/provider/Layers/OllamaProvider.ts`
- Modify: `apps/server/src/provider/Layers/OllamaProvider.test.ts`
- Modify: `apps/server/src/git/Layers/OllamaTextGeneration.ts`
- Modify: `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- Modify: `apps/server/src/git/Layers/OllamaTextGeneration.test.ts`
- Modify: `apps/server/src/git/Layers/RoutingTextGeneration.test.ts`
- Modify: `apps/web/src/components/chat/ProviderModelPicker.tsx`
- Modify: `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/provider/Layers/OllamaProvider.test.ts
it.effect("reports ollamaLocal ready only when codex binary and gpu api are both usable", () =>
  Effect.gen(function* () {
    const snapshot = yield* checkOllamaProvider({
      enabled: true,
      protocol: "http",
      host: "192.168.10.12",
      port: 11435,
      apiPath: "/api",
      responsesApiPath: "/v1",
      codexBinaryPath: "codex",
      codexHomePath: "/tmp/.codex-ollama",
      codexProfileName: "t3-ollama-gpu",
      defaultModel: "qwen3:8b",
      customModels: [],
    });

    assert.equal(snapshot.provider, "ollamaLocal");
    assert.equal(snapshot.installed, true);
  }),
);

// apps/web/src/components/chat/ProviderModelPicker.browser.tsx
it("renders Codex and Ollama as distinct selectable providers", async () => {
  render(
    <ProviderModelPicker
      provider="codex"
      model="gpt-5.4"
      lockedProvider={null}
      providers={[
        readyProvider("codex", ["gpt-5.4"]),
        readyProvider("ollamaLocal", ["qwen3:8b"]),
      ]}
      modelOptionsByProvider={{
        codex: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
        claudeAgent: [],
        ollamaLocal: [{ slug: "qwen3:8b", name: "Qwen3 8B" }],
      }}
      onProviderModelChange={vi.fn()}
    />,
  );

  expect(await screen.findByText("Codex")).toBeTruthy();
  expect(await screen.findByText("Ollama")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/server/src/provider/Layers/OllamaProvider.test.ts apps/server/src/git/Layers/OllamaTextGeneration.test.ts apps/server/src/git/Layers/RoutingTextGeneration.test.ts`

Run: `bun run test:browser src/components/chat/ProviderModelPicker.browser.tsx`

Expected: FAIL because the provider snapshot does not yet reflect the Codex-backed Ollama profile settings and the browser assertions do not match the final dual-provider experience.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/provider/ollamaConfig.ts
export function resolveOllamaApiBaseUrl(settings: OllamaSettings): string {
  return `${settings.protocol}://${settings.host}:${settings.port}${settings.apiPath}`;
}

export function resolveOllamaResponsesBaseUrlFromSettings(settings: OllamaSettings): string {
  return `${settings.protocol}://${settings.host}:${settings.port}${settings.responsesApiPath}`;
}

// apps/server/src/provider/Layers/OllamaProvider.ts
const runtimeConfig = {
  apiBaseUrl: resolveOllamaApiBaseUrl(settings),
  responsesBaseUrl: resolveOllamaResponsesBaseUrlFromSettings(settings),
  defaultModel: settings.defaultModel,
};

// keep the probe path lightweight:
// 1. verify codex binary exists with --version
// 2. verify /api/tags responds within timeout
// 3. verify default model exists
// 4. report local auth, not OpenAI auth

// apps/server/src/git/Layers/OllamaTextGeneration.ts
const baseUrl = resolveOllamaApiBaseUrl(settings.providers.ollamaLocal);
const model = input.modelSelection?.model ?? settings.providers.ollamaLocal.defaultModel;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/server/src/provider/Layers/OllamaProvider.test.ts apps/server/src/git/Layers/OllamaTextGeneration.test.ts apps/server/src/git/Layers/RoutingTextGeneration.test.ts`

Run: `bun run test:browser src/components/chat/ProviderModelPicker.browser.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/ollamaConfig.ts \
  apps/server/src/provider/Layers/OllamaProvider.ts \
  apps/server/src/provider/Layers/OllamaProvider.test.ts \
  apps/server/src/git/Layers/OllamaTextGeneration.ts \
  apps/server/src/git/Layers/RoutingTextGeneration.ts \
  apps/server/src/git/Layers/OllamaTextGeneration.test.ts \
  apps/server/src/git/Layers/RoutingTextGeneration.test.ts \
  apps/web/src/components/chat/ProviderModelPicker.tsx \
  apps/web/src/components/chat/ProviderModelPicker.browser.tsx
git commit -m "feat: align ollama provider health and text generation with codex profiles"
```

### Task 7: Add Integration Coverage For Dual-Provider Launch, Recovery, And Live GPU Ollama

**Files:**

- Modify: `apps/server/integration/providerService.integration.test.ts`
- Modify: `apps/server/integration/orchestrationEngine.integration.test.ts`
- Modify: `apps/server/integration/ollamaLocal.live.integration.test.ts`
- Modify: `apps/server/integration/OrchestrationEngineHarness.integration.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/integration/providerService.integration.test.ts
it.effect("can start codex and ollamaLocal side by side with isolated codex homes", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      serverSettings: {
        providers: {
          codex: {
            homePath: "/tmp/codex-openai",
            profileName: "t3-openai",
          },
          ollamaLocal: {
            codexHomePath: "/tmp/codex-ollama",
            codexProfileName: "t3-ollama-gpu",
            host: "192.168.10.12",
            port: 11435,
            responsesApiPath: "/v1",
            defaultModel: "qwen3:8b",
          },
        },
      },
    });

    const openAi = yield* harness.startProviderThread({ provider: "codex" });
    const ollama = yield* harness.startProviderThread({ provider: "ollamaLocal" });

    assert.notStrictEqual(openAi.session.cwd, undefined);
    assert.notStrictEqual(ollama.session.cwd, undefined);
    assert.notStrictEqual(openAi.runtimeHomePath, ollama.runtimeHomePath);
  }),
);

// apps/server/integration/ollamaLocal.live.integration.test.ts
it.live.skipIf(!LIVE_OLLAMA_TESTS_ENABLED)(
  "starts ollamaLocal through codex app-server and completes a real turn",
  () => Effect.scoped(/* real GPU endpoint + real codex app-server turn */),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/server/integration/providerService.integration.test.ts apps/server/integration/orchestrationEngine.integration.test.ts`

Run: `OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test apps/server/integration/ollamaLocal.live.integration.test.ts`

Expected: FAIL because `ollamaLocal` is not yet launched through Codex, the integration harness does not capture provider-specific launch homes/profiles, and the live suite still assumes the raw HTTP adapter.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/integration/ollamaLocal.live.integration.test.ts
const LIVE_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://192.168.10.12:11435/api";
const LIVE_OLLAMA_RESPONSES_BASE_URL =
  process.env.OLLAMA_CODEX_BASE_URL ?? "http://192.168.10.12:11435/v1/";

// Start a real ollamaLocal provider session through the Codex-backed adapter,
// assert assistant text arrives, then assert thread persistence still works.

// apps/server/integration/providerService.integration.test.ts
// Extend harness assertions so provider-specific CODEX_HOME/profile values
// are observable in tests.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/server/integration/providerService.integration.test.ts apps/server/integration/orchestrationEngine.integration.test.ts`

Run: `OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_CODEX_BASE_URL=http://192.168.10.12:11435/v1/ OLLAMA_MODEL=qwen3:8b bun run test apps/server/integration/ollamaLocal.live.integration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/integration/providerService.integration.test.ts \
  apps/server/integration/orchestrationEngine.integration.test.ts \
  apps/server/integration/ollamaLocal.live.integration.test.ts \
  apps/server/integration/OrchestrationEngineHarness.integration.ts
git commit -m "test: cover codex-backed ollama local integration and live gpu turns"
```

### Task 8: Add Browser E2E Smoke And Update The Local-Model Skill

**Files:**

- Create: `scripts/e2e/ollamaCodexProfileSmoke.ts`
- Modify: `package.json`
- Modify: `.agents/skills/t3-local-model-provider-workflow/SKILL.md`

- [ ] **Step 1: Write the failing smoke script and docs assertions**

```ts
// scripts/e2e/ollamaCodexProfileSmoke.ts
import { chromium } from "playwright";

const APP_URL = process.env.T3_APP_URL ?? "http://127.0.0.1:7421/";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 120000 });

  await page.getByRole("button", { name: /gpt|qwen|codex|ollama/i }).click();
  await page.getByText("Ollama").click();
  await page.getByText("Qwen3 8B").click();

  await page.getByRole("textbox").fill("Reply with exactly: smoke-ok");
  await page.keyboard.press("Enter");

  await page.getByText(/smoke-ok/i, { exact: false }).waitFor({ timeout: 120000 });
  await browser.close();
}

void main();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run scripts/e2e/ollamaCodexProfileSmoke.ts`

Expected: FAIL before implementation because the live app still launches `ollamaLocal` through the old runtime path or the selection flow is not yet fully wired end to end.

- [ ] **Step 3: Wire the script and update the skill**

```json
// package.json
{
  "scripts": {
    "test:e2e:ollama-profile": "bun run scripts/e2e/ollamaCodexProfileSmoke.ts"
  }
}
```

```md
<!-- .agents/skills/t3-local-model-provider-workflow/SKILL.md -->

- `ollamaLocal` is Codex-backed for agent sessions; do not plan new raw `/api/chat`
  harness work unless the task is specifically about lightweight text generation.
- Health and model discovery still use Ollama `/api/*`; Codex profile runtime uses
  the OpenAI-compatible `/v1/*` endpoint.
- Keep OpenAI Codex and Ollama Codex isolated with separate `CODEX_HOME` and profile
  settings; a second Codex binary path is optional, not the default design.
```

- [ ] **Step 4: Run the smoke test and validation**

Run: `bun run test:e2e:ollama-profile`

Run: `bun fmt`

Run: `bun lint`

Run: `bun typecheck`

Expected:

- smoke script reaches the running app, selects `ollamaLocal`, and gets a real assistant reply
- `bun fmt` exits `0`
- `bun lint` exits `0`
- `bun typecheck` exits `0`

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e/ollamaCodexProfileSmoke.ts package.json .agents/skills/t3-local-model-provider-workflow/SKILL.md
git commit -m "test: add ollama codex profile smoke coverage and workflow docs"
```

## Final Validation Checklist

Run exactly these commands before marking the work complete:

```bash
bun run test apps/server/src/serverSettings.test.ts \
  apps/server/src/provider/codexProfileConfig.test.ts \
  apps/server/src/provider/Layers/CodexAdapter.test.ts \
  apps/server/src/provider/Layers/OllamaAdapter.test.ts \
  apps/server/src/provider/Layers/OllamaProvider.test.ts \
  apps/server/src/git/Layers/OllamaTextGeneration.test.ts \
  apps/server/src/git/Layers/RoutingTextGeneration.test.ts \
  apps/server/integration/providerService.integration.test.ts \
  apps/server/integration/orchestrationEngine.integration.test.ts \
  apps/server/integration/ollamaLocal.live.integration.test.ts
```

```bash
bun run test:browser src/components/chat/ProviderModelPicker.browser.tsx
```

```bash
bun run test:e2e:ollama-profile
```

```bash
bun fmt
bun lint
bun typecheck
```

## Self-Review

- Spec coverage:
  - separate Codex profiles for OpenAI and Ollama: covered by Tasks 1-3
  - T3 full pipeline integration for `ollamaLocal` alongside OpenAI: covered by Tasks 4-7
  - Ollama profile created against the GPU API: covered by Tasks 1-2 and live validation in Task 7
  - optional separate Codex install/path: covered by `providers.ollamaLocal.codexBinaryPath`
- Placeholder scan:
  - no `TBD`, `TODO`, or “similar to previous task” placeholders remain
- Type consistency:
  - `profileName` is used for `codex`
  - `codexProfileName` is used for `ollamaLocal`
  - raw Ollama health/text generation uses `/api`
  - Codex-backed Ollama runtime uses `/v1`
