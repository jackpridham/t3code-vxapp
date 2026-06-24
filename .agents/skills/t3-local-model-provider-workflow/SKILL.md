---
name: t3-local-model-provider-workflow
description: Use when adding, changing, debugging, or reviewing T3 Code local-model or self-hosted provider support, especially Ollama, host/IP or endpoint settings, provider-backed model lists, local model defaults, adapter HTTP wiring, provider snapshots, provider picker integration, or live integration tests for local inference backends. Trigger on local model, Ollama, self-hosted model, LAN model server, model endpoint, host/IP, port, API path, provider expansion, add provider kind, local inference, or provider-backed `/model` behavior.
---

# T3 Local Model Provider Workflow

Use this skill when the work touches local or self-hosted model providers in T3. The current concrete example is `ollamaLocal`, but the same workflow should be followed for future providers like other OpenAI-compatible local backends.

The important boundary in this repo:

- contracts define the provider kind, settings shape, and model-selection types
- server settings own provider configuration and defaults
- provider snapshot services report availability and model lists
- provider adapters own actual request/runtime behavior
- web settings and composer/picker flows must consume the same provider truth

Do not solve a local-model task by hardcoding endpoint or model values in the adapter unless the task explicitly says to keep it fixed.

Important current reality:

- `ollamaLocal` is no longer only a direct `/api/chat` adapter concern
- production coding-agent behavior is Codex-backed, with Ollama used as the model provider behind Codex
- direct Ollama HTTP still matters for provider health/model discovery and non-agent text-generation paths
- `codex app-server` does not support `--profile`; managed app-server launches must use `CODEX_HOME` isolation plus `-c` config overrides
- for standalone Codex-backed threads, Codex itself loads project instruction and skill surfaces from the runtime `cwd`; T3 does not need to inline those files into every `turn/start`
- T3 currently fingerprints `AGENTS.md` and `CLAUDE.md` to decide when a provider session must restart, but the actual project-instruction payload still comes from Codex's own runtime layering
- native standalone Codex skill discovery is repo `.agents/skills` plus user/system skill locations, and T3's browser-side catalog now prefers that same root while still parsing legacy `.claude/skills` references

## Standalone Codex Boundary

When the task is about what a live `ollamaLocal` agent thread actually saw, separate these layers explicitly:

- T3-managed provider launch state
- Codex-managed project instructions and native skills
- browser-only T3 composer skill UX

Current confirmed behavior in this repo:

- T3 injects collaboration-mode `developer_instructions` into `turn/start`
- T3 records instruction-surface changes from `AGENTS.md` and `CLAUDE.md` as a restart boundary
- Codex persists the effective runtime context in its rollout JSONL under the provider-specific `CODEX_HOME`
- persisted rollouts are the best proof source for whether `AGENTS.md` was actually loaded
- `skills/list` from `codex app-server` is the best proof source for native standalone skill availability

If a user says a standalone thread "did not get AGENTS" or "had no skills", do not infer from the model's self-report alone. Inspect:

- the managed `CODEX_HOME/config.toml` trust entry for the target repo
- the rollout JSONL for a synthetic `# AGENTS.md instructions for <cwd>` message
- `config/read` output from the same managed `codex app-server` launch
- `skills/list` output for the target `cwd`

Do not assume legacy `.claude/skills` paths are available to standalone Codex turns just because old messages or older repos may still reference them.

## Primary Files

Shared contracts and model selection:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/shared/src/model.ts`

Server provider wiring:

- `apps/server/src/serverSettings.ts`
- `apps/server/src/provider/ollamaConfig.ts`
- `apps/server/src/provider/ollamaApi.ts`
- `apps/server/src/provider/ollamaChat.ts`
- `apps/server/src/provider/codexAppServer.ts`
- `apps/server/src/provider/codexProfileConfig.ts`
- `apps/server/src/provider/Layers/OllamaProvider.ts`
- `apps/server/src/provider/Layers/OllamaAdapter.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/serverLayers.ts`

Git/text generation:

- `apps/server/src/git/Layers/OllamaTextGeneration.ts`
- `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- `apps/server/src/git/Services/TextGeneration.ts`

Web settings and picker flow:

- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/hooks/useSettings.ts`
- `apps/web/src/modelSelection.ts`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.tsx`
- `apps/web/src/session-logic.ts`

Tests:

- `apps/server/src/serverSettings.test.ts`
- `apps/server/src/provider/Layers/OllamaAdapter.test.ts`
- `apps/server/src/provider/Layers/OllamaProvider.test.ts`
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`
- `apps/server/src/provider/codexProfileConfig.test.ts`
- `apps/server/integration/ollamaLocal.live.integration.test.ts`
- `apps/server/integration/orchestrationEngine.integration.test.ts`
- `scripts/live-ollama-codex-selection-smoke.ts`

## Default Workflow

### 1. Classify the change first

Decide which layer the request actually belongs to:

- provider kind / contract expansion
- settings and defaults
- provider snapshot / model list
- runtime adapter transport behavior
- orchestration history replay / recovery behavior
- git or thread text-generation routing
- picker or `/model` integration
- live integration verification

Do not start in the UI if the real change is contract or server-authoritative config.

### 2. Keep provider configuration server-authoritative

For local-model providers, endpoint and default-model configuration should usually live in `ServerSettings`, not client-only state.

Use structured fields when possible:

- protocol
- host or IP
- port
- API path
- default model
- custom model list

Prefer deriving a runtime base URL from those fields in one server helper instead of duplicating string concatenation in multiple files.

### 3. Wire model truth through the provider snapshot

The provider snapshot is the shared source for:

- ready/error/disabled state
- warning state when the endpoint is reachable but not fully usable
- visible model list
- checked timestamp
- status message shown in settings

If you add a new default model or provider-backed model source, update the snapshot layer so the web picker and settings page see the same truth.

### 4. Make adapter behavior read effective config at the right time

For local-model HTTP adapters:

- read effective runtime config from `ServerSettingsService`
- apply config to new turns without requiring a server restart unless the protocol demands it
- keep in-flight turns stable once started
- keep unsupported behavior explicit instead of silently ignoring it
- if orchestration owns the durable chat history, prefer replaying authoritative thread messages over trusting adapter-local memory after restart
- preserve the session model across steady-state turns unless a per-turn override is explicitly requested

For Codex-backed local-model providers:

- keep the provider identity and model selection in T3 contracts/settings
- use direct Ollama HTTP only for health/model discovery or explicit non-agent request paths
- launch `codex app-server` with managed `-c` overrides rather than `--profile`
- isolate managed Codex state with provider-specific `CODEX_HOME`
- keep app-server config keys CLI-safe; if you create a managed provider id for dotted `-c model_providers.<id>...` paths, avoid ids that will break dotted key parsing

If both a provider snapshot and an adapter need the same endpoint/model derivation, extract a small helper in `apps/server/src/provider/`.

### 5. Keep picker and `/model` behavior coherent

When adding or changing local-model support, verify:

- provider is in the contracts and `session-logic.ts`
- provider model options are available in `modelSelection.ts`
- picker UI uses the provider snapshot models
- composer/provider registry handles provider-specific options correctly
- disabling the provider behaves consistently with text-generation selection fallback
- warning-status providers are treated differently from hard failures if the UI should still allow model selection

### 6. Keep orchestration replay authoritative

If the provider does not have a durable remote session model and instead expects full message history per turn:

- build replay history from authoritative orchestration thread messages, not adapter-local process memory
- exclude the triggering user message when the adapter separately appends the current turn input
- exclude transient streaming assistant rows and blank text rows from replay history
- thread the same replay contract through owner-mediated turn starts and normal thread turn starts
- prefer history-replay session recovery only after the real adapter consumes authoritative replay history correctly

### 7. Prefer live tests for connectivity and focused unit tests for shape

Use focused tests for:

- settings normalization and patching
- provider snapshot messages and models
- adapter request URL/body behavior
- authoritative conversation history construction
- settings changes affecting later turns
- text-generation routing and non-streaming `/chat` behavior
- managed Codex config generation for Ollama
- app-server launch argument construction for Codex-backed Ollama sessions

Use the live integration test when you need proof against the real local backend. If it fails, separate these cases explicitly before changing production code:

- endpoint unreachable from this host/network
- endpoint reachable but model missing
- endpoint reachable but request/response contract mismatch
- adapter/runtime bug in T3
- Codex app-server launch contract mismatch, especially unsupported flags like `--profile`

Direct probes that help isolate this quickly:

```bash
curl --max-time 10 http://<host>:<port>/api/tags
```

```bash
curl --max-time 30 http://<host>:<port>/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:8b","stream":false,"messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
```

When the provider is Codex-backed, live proof should also include a real T3 turn, not only direct Ollama reachability. Prefer:

```bash
T3_BASE_URL=http://127.0.0.1:7421 \
OLLAMA_BASE_URL=http://<host>:<port>/api \
OLLAMA_MODEL=qwen3:8b \
bun run scripts/live-ollama-codex-selection-smoke.ts
```

That proves:

- the real provider picker can select `ollamaLocal`
- T3 launches the Codex-backed local-model runtime correctly
- the resulting turn settles and persists assistant output

## Validation

Always run:

```bash
bun fmt
bun lint
bun typecheck
```

Focused server tests:

```bash
cd apps/server
bun run test src/serverSettings.test.ts
bun run test src/provider/Layers/OllamaAdapter.test.ts
bun run test src/provider/Layers/OllamaProvider.test.ts
bun run test src/provider/Layers/CodexAdapter.test.ts
bun run test src/provider/ollamaChat.test.ts
bun run test src/provider/codexProfileConfig.test.ts
bun run test src/git/Layers/OllamaTextGeneration.test.ts
bun run test src/git/Layers/RoutingTextGeneration.test.ts
```

Live endpoint verification when needed:

```bash
cd apps/server
bun run test integration/ollamaLocal.live.integration.test.ts
```

Never run `bun test`.

## Footguns

- Do not leave endpoint or model values hardcoded in both the adapter and the provider snapshot.
- Do not put provider endpoint settings in client-only local storage.
- Do not update the settings UI without extending `ServerSettingsPatch` and defaults.
- Do not expose a provider in the picker without wiring its contract/model-selection path.
- Do not build model lists separately in the web app when the provider snapshot should own them.
- Do not forget that provider status and model lists refresh through `ProviderRegistry`, not ad hoc UI state.
- Do not assume local-model providers behave like Codex or Claude process-backed adapters; keep the transport shape provider-specific.
- Do not assume a Codex-backed local-model provider can be launched the same way as the Codex CLI profile UX; `codex app-server` has a different flag surface.
- Do not enable history-replay recovery for a local-model adapter until the adapter actually consumes authoritative replay history on every recovered turn.
- Do not treat a warning-status provider as automatically unusable; warning can still mean reachable with selectable live models.
- Do not assume live integration failures mean the adapter is broken; verify direct LAN reachability from the current host first.
