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

## Primary Files

Shared contracts and model selection:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/shared/src/model.ts`

Server provider wiring:

- `apps/server/src/serverSettings.ts`
- `apps/server/src/provider/ollamaConfig.ts`
- `apps/server/src/provider/Layers/OllamaProvider.ts`
- `apps/server/src/provider/Layers/OllamaAdapter.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/serverLayers.ts`

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
- `apps/server/integration/ollamaLocal.live.integration.test.ts`

## Default Workflow

### 1. Classify the change first

Decide which layer the request actually belongs to:

- provider kind / contract expansion
- settings and defaults
- provider snapshot / model list
- runtime adapter transport behavior
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

If both a provider snapshot and an adapter need the same endpoint/model derivation, extract a small helper in `apps/server/src/provider/`.

### 5. Keep picker and `/model` behavior coherent

When adding or changing local-model support, verify:

- provider is in the contracts and `session-logic.ts`
- provider model options are available in `modelSelection.ts`
- picker UI uses the provider snapshot models
- composer/provider registry handles provider-specific options correctly
- disabling the provider behaves consistently with text-generation selection fallback

### 6. Prefer live tests for connectivity and focused unit tests for shape

Use focused tests for:

- settings normalization and patching
- provider snapshot messages and models
- adapter request URL/body behavior
- settings changes affecting later turns

Use the live integration test when you need proof against the real local backend. It is acceptable for that test to fail while the external endpoint is intentionally offline.

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
