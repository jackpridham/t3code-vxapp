---
name: t3-settings-workflow
description: Use when adding, changing, wiring, or debugging settings in the T3 Code repo, especially when a setting must flow through contracts, useSettings, the settings UI, and a consumer like the sidebar, chat view, or server config.
---

# T3 Settings Workflow

Use this skill when a task involves app settings in `t3code-vxapp`.

This repo already has a real settings architecture. Do not add one-off local state if the behavior is meant to be configurable.

## First Principles

- Decide whether the setting is `client-only` or `server-authoritative`.
- Prefer extending existing settings flow over adding parallel config paths.
- Keep defaults stable and explicit.
- Update restore/defaults surfaces so the setting is not "half integrated".
- Validate with:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
- Never run `bun test`. If tests are needed, use `bun run test`.

## Settings Split

There are two settings buckets:

- Client settings:
  - Persisted in local storage.
  - Defined in [packages/contracts/src/settings.ts](/home/gizmo/t3code-vxapp/packages/contracts/src/settings.ts) in `ClientSettingsSchema`.
  - Merged into app settings by [apps/web/src/hooks/useSettings.ts](/home/gizmo/t3code-vxapp/apps/web/src/hooks/useSettings.ts).
- Server settings:
  - Persisted by the server.
  - Defined in [packages/contracts/src/settings.ts](/home/gizmo/t3code-vxapp/packages/contracts/src/settings.ts) in `ServerSettings`.
  - Routed automatically by `splitPatch()` in [apps/web/src/hooks/useSettings.ts](/home/gizmo/t3code-vxapp/apps/web/src/hooks/useSettings.ts).

Rule of thumb:

- Use `client` for UI preferences, sidebar behavior, local confirmations, display toggles, local editor UX.
- Use `server` for provider config, defaults that should follow the user across clients, or settings the server must know to behave correctly.

## Normal Edit Path

When adding a new setting, check these files in roughly this order.

### 1. Schema and default

Edit [packages/contracts/src/settings.ts](/home/gizmo/t3code-vxapp/packages/contracts/src/settings.ts).

Typical work:

- Add the field to `ClientSettingsSchema` or `ServerSettings`.
- Add a decoding default.
- Export a named default constant if the default is important or reused.
- Keep the unified type working through `DEFAULT_CLIENT_SETTINGS`, `DEFAULT_SERVER_SETTINGS`, and `DEFAULT_UNIFIED_SETTINGS`.

Notes:

- Use existing schema helpers from [packages/contracts/src/baseSchemas.ts](/home/gizmo/t3code-vxapp/packages/contracts/src/baseSchemas.ts) when possible.
- For numeric settings, prefer validated schema types over raw numbers.

### 2. Migration and patch routing

Edit [apps/web/src/hooks/useSettings.ts](/home/gizmo/t3code-vxapp/apps/web/src/hooks/useSettings.ts).

Typical work:

- Add legacy migration support in `buildLegacyClientSettingsMigrationPatch()` if the repo already had older local storage keys for similar behavior.
- Do not bypass `useUpdateSettings()` unless there is a very strong reason.
- If the setting is server-side, confirm the key is part of `ServerSettings` so `splitPatch()` routes it correctly.

### 3. Settings UI

Edit [apps/web/src/components/settings/SettingsPanels.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/settings/SettingsPanels.tsx).

Typical work:

- Add a `SettingsRow`.
- Use `SettingResetButton` so the setting can be reset individually.
- Add the setting to `useSettingsRestore()` so "Restore defaults" includes it in the dirty-state list.
- Keep descriptions concrete and behavior-oriented.

Common pattern:

- Number input:
  - Keep a small local string state for the input if needed.
  - Clamp/sanitize on blur or commit.
  - Persist through `updateSettings()`.
- Boolean input:
  - Use `Switch`.

### 4. Consumer wiring

Update the feature that actually uses the setting.

Examples:

- Sidebar behavior:
  - [apps/web/src/components/Sidebar.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/Sidebar.tsx)
  - [apps/web/src/components/Sidebar.logic.ts](/home/gizmo/t3code-vxapp/apps/web/src/components/Sidebar.logic.ts)
- Thread/chat behavior:
  - [apps/web/src/components/ChatView.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/ChatView.tsx)
- Diff behavior:
  - [apps/web/src/components/DiffPanel.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/DiffPanel.tsx)

Prefer pushing reusable behavior into `*.logic.ts` when it is testable and shared.

### 5. Tests

Add or update focused tests near the touched area.

Usual places:

- [apps/web/src/hooks/useSettings.test.ts](/home/gizmo/t3code-vxapp/apps/web/src/hooks/useSettings.test.ts)
- [apps/web/src/components/Sidebar.logic.test.ts](/home/gizmo/t3code-vxapp/apps/web/src/components/Sidebar.logic.test.ts)
- Feature-specific browser or logic tests beside the consumer

Test the rule, not just the UI control.

## Good Workflow For New Settings

1. Decide client vs server.
2. Find the closest existing setting with similar persistence and UX.
3. Add schema and default.
4. Add migration if needed.
5. Add settings panel row and reset/default coverage.
6. Wire the consumer.
7. Add logic tests for the actual behavior.
8. Run `bun fmt`, `bun lint`, `bun typecheck`.

## Known Repo Patterns

### Client setting examples

Look at these for copyable patterns:

- `confirmThreadArchive`
- `confirmThreadDelete`
- `diffWordWrap`
- `sidebarProjectSortOrder`
- `sidebarThreadSortOrder`

These are all defined in [packages/contracts/src/settings.ts](/home/gizmo/t3code-vxapp/packages/contracts/src/settings.ts) and surfaced in [apps/web/src/components/settings/SettingsPanels.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/settings/SettingsPanels.tsx).

### Sidebar-specific settings

For sidebar behavior, inspect:

- [apps/web/src/components/Sidebar.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/Sidebar.tsx)
- [apps/web/src/components/Sidebar.logic.ts](/home/gizmo/t3code-vxapp/apps/web/src/components/Sidebar.logic.ts)
- [apps/web/src/components/Sidebar.logic.test.ts](/home/gizmo/t3code-vxapp/apps/web/src/components/Sidebar.logic.test.ts)

If the new setting affects visibility, folding, sorting, or derived display state, put the core rule in `Sidebar.logic.ts` and test it there.

## Footguns

- Do not add a setting to the schema and forget `useSettingsRestore()`.
- Do not add a settings row without a reset path if other comparable rows have one.
- Do not hard-code a magic number in a consumer when it should be configurable.
- Do not use a stringly-typed raw number if a schema helper already exists.
- Do not forget that `DEFAULT_UNIFIED_SETTINGS` drives reset behavior.
- Do not forget that browser tests or local-storage-backed tests may seed `DEFAULT_CLIENT_SETTINGS`.
- Do not run `bun test`.

## If You Are Dropped Into This Codebase Cold

Start here:

1. Read [packages/contracts/src/settings.ts](/home/gizmo/t3code-vxapp/packages/contracts/src/settings.ts).
2. Read [apps/web/src/hooks/useSettings.ts](/home/gizmo/t3code-vxapp/apps/web/src/hooks/useSettings.ts).
3. Read [apps/web/src/components/settings/SettingsPanels.tsx](/home/gizmo/t3code-vxapp/apps/web/src/components/settings/SettingsPanels.tsx).
4. Read the consumer you are modifying.
5. Read the closest existing test file.

If the task is "add a new toggle/number input for X", this is usually enough context to implement it safely.

## Completion Standard

Do not consider the task complete until all of these pass:

- `bun fmt`
- `bun lint`
- `bun typecheck`

If tests are relevant, use `bun run test`, never `bun test`.
