---
name: t3-provider-kind-expansion-workflow
description: Use when adding, changing, debugging, or reviewing a T3 Code provider kind end to end, especially a new provider enum value, provider contracts, adapter and provider registry wiring, server snapshot services, provider picker integration, model-selection support, and focused tests across server and web. Trigger on add provider, new provider kind, provider expansion, add adapter, provider registry, provider picker, provider model selection, or end-to-end provider wiring.
---

# T3 Provider Kind Expansion Workflow

Use this skill when the task is not just "change a setting" or "fix one adapter," but "add or expand a provider kind across the T3 stack."

Examples:

- add a new provider like `ollamaLocal`
- expand an existing provider so it becomes selectable in thread creation and settings
- add a server snapshot service plus runtime adapter for a provider
- wire a provider through model selection, registries, and tests

This skill is about the full vertical slice:

- contracts
- server settings
- provider snapshot service
- adapter runtime
- registries and server layers
- web picker and model-selection plumbing
- focused tests

## Primary Files

Provider contracts and selection types:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/projectHooks.ts`
- `packages/shared/src/model.ts`
- `packages/shared/src/projectHooks.ts`

Server provider runtime:

- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Services/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/serverLayers.ts`

Provider-specific server files:

- `apps/server/src/provider/Layers/*Adapter.ts`
- `apps/server/src/provider/Layers/*Provider.ts`
- `apps/server/src/provider/Services/*Adapter.ts`
- `apps/server/src/provider/Services/*Provider.ts`

Web integration:

- `apps/web/src/session-logic.ts`
- `apps/web/src/modelSelection.ts`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/composerDraftStore.ts`
- `apps/web/src/store.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`

Tests:

- `apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts`
- provider-specific adapter/provider tests
- relevant web tests around model selection or picker behavior

## Default Workflow

### 1. Add the provider kind to shared contracts first

Before touching UI or runtime wiring, add the provider kind everywhere the repo models provider identity:

- provider kind unions / schemas
- model selection unions
- provider display names
- project-hook provider filters if relevant
- any shared normalization helpers

If contracts do not know the provider exists, downstream wiring will become inconsistent fast.

### 2. Decide whether the provider needs both a snapshot service and an adapter

In this repo, most providers have two server-side shapes:

- a provider snapshot service for availability, auth/install state, and model lists
- a runtime adapter for actual turn/session behavior

Do not assume only one is needed.

If a provider is selectable in the UI, it usually needs:

- snapshot service for provider status and model availability
- adapter service for runtime turn execution
- registration in both registries

### 3. Register the provider in the right order

End-to-end provider expansion usually requires updates to:

- provider contracts
- provider snapshot service
- provider adapter service
- adapter registry
- provider registry
- server layer assembly

Also check any session-directory or persistence logic that branches on provider kind.

### 4. Wire the web selection path completely

For a provider to be usable in new threads, it is not enough to add a backend adapter.

Verify all of these:

- `session-logic.ts` exposes the provider as selectable
- `ProviderModelPicker.tsx` has an icon and menu entry
- `modelSelection.ts` can resolve defaults and custom models
- `composerProviderRegistry.tsx` knows the provider’s option/capability behavior
- `composerDraftStore.ts` and related state accept the provider kind
- settings UI can enable/disable and configure it if the provider is configurable

### 5. Prefer repo patterns over custom abstractions

When adding a provider:

- mirror existing `Codex` / `Claude` / `Ollama` split where appropriate
- only extract shared helpers when at least two providers need the same logic
- keep provider-specific request logic inside the provider layer, not in generic registries

For configurable local/self-hosted providers, use the provider settings flow rather than adding ad hoc env-var-only or hardcoded behavior.

### 6. Test the slice, not just the leaf file

Minimum expectations for a new provider kind:

- contracts/typecheck catches the new provider everywhere it must exist
- adapter registry resolves it
- provider registry includes it
- provider-specific adapter tests cover request/runtime behavior
- provider-specific snapshot tests cover status/model behavior
- web model-selection or picker behavior is covered if the provider is user-selectable

If the provider talks to a real backend over network, add a live integration test when useful, even if it is expected to fail until the external dependency is online.

## Validation

Always run:

```bash
bun fmt
bun lint
bun typecheck
```

Then run focused tests for the touched slice, for example:

```bash
cd apps/server
bun run test src/provider/Layers/ProviderAdapterRegistry.test.ts
bun run test src/provider/Layers/ProviderRegistry.test.ts
bun run test src/provider/Layers/<ProviderName>Adapter.test.ts
bun run test src/provider/Layers/<ProviderName>Provider.test.ts
```

Never run `bun test`.

## Footguns

- Do not add a provider to the runtime adapter layer but forget the snapshot/provider registry path.
- Do not add the provider to the picker without adding it to contracts and draft/store normalization.
- Do not hardcode provider display or model-selection behavior in one component if shared model selection already owns it.
- Do not forget enable/disable fallback behavior for text-generation model selection when the provider is configurable.
- Do not stop at unit tests for one file when the feature is an end-to-end provider expansion.
