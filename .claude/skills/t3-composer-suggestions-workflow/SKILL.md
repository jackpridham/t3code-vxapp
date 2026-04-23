---
name: t3-composer-suggestions-workflow
description: Use when adding, changing, debugging, or reviewing T3 Code chat composer suggestions, ChatView input behavior, @ file mentions, // skill mentions, / slash commands, /model selection, ComposerCommandMenu, ComposerPromptEditor, composer trigger detection, prompt replacement, or keyboard navigation in the composer. Trigger on ChatView composer, composer menu, mention picker, file mention, skill mention, double slash, slash command, model command, prompt editor, Lexical composer, inline composer chip, or `detectComposerTrigger`.
---

# T3 Composer Suggestions Workflow

Use this skill when the chat composer recognizes a token, shows a suggestion menu, inserts a prompt reference, or renders an inline composer chip.

The composer has a few separate concerns. Keep them separate when making changes:

- trigger detection: pure text/cursor logic
- suggestion data: React Query hooks or local item builders
- menu rendering: `ComposerCommandMenu`
- prompt mutation: replacement ranges and cursor updates
- inline display: Lexical mention nodes and chips

## Primary Files

Core trigger and prompt logic:

- `apps/web/src/composer-logic.ts`
- `apps/web/src/composer-editor-mentions.ts`
- `apps/web/src/components/ComposerPromptEditor.tsx`
- `apps/web/src/components/composerInlineChip.ts`

Chat composer wiring:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/ComposerCommandMenu.tsx`
- `apps/web/src/components/chat/composerSuggestionItems.ts`
- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.tsx`

Data hooks used by suggestions:

- `apps/web/src/lib/projectReactQuery.ts`
- `apps/web/src/lib/skillReactQuery.ts`
- `apps/web/src/lib/providerReactQuery.ts`

Tests:

- `apps/web/src/composer-logic.test.ts`
- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/chat/composerSuggestionItems.test.ts`
- nearby `*.browser.tsx` tests for provider/model picker behavior

## Current Trigger Model

`detectComposerTrigger(text, cursor)` owns token recognition:

- `@query` -> path suggestions
- `//query` -> skill suggestions
- `/query` at line start -> slash command suggestions
- `/model query` at line start -> model suggestions

Do not add trigger parsing directly in `ChatView` or UI components. Extend `composer-logic.ts` first, then wire the UI around the new trigger kind.

Cursor values are tricky because the editor collapses inline mention nodes to a single visible character while prompt text stores expanded references. Use existing helpers:

- `expandCollapsedComposerCursor`
- `collapseExpandedComposerCursor`
- `clampCollapsedComposerCursor`
- `isCollapsedCursorAdjacentToInlineToken`

## Suggestion Source Rules

Prefer source-specific helpers over inline mapping in `ChatView`.

Existing item builders live in:

- `apps/web/src/components/chat/composerSuggestionItems.ts`

Use or extend:

- `buildPathComposerItems`
- `buildSkillComposerItems`
- `buildSlashCommandComposerItems`
- `buildModelComposerItems`

If adding a new suggestion type, add a source builder and focused tests beside it. Keep `ChatView` responsible for orchestration, not per-source item shaping.

## React Query Rules

Use shared query option or hook helpers for remote data.

Good patterns:

- file/path suggestions: `projectSearchEntriesQueryOptions`
- skill suggestions: `useSkillSuggestions`
- provider/model data: server config/provider helpers already consumed by `ChatView`

Query keys must include every input that changes the result. Use `enabled` to avoid fetching when the trigger kind is inactive, but do not use `enabled` to hide incomplete cache keys.

When passing optional values into option helpers under `exactOptionalPropertyTypes`, omit absent properties instead of passing explicit `undefined`.

## Prompt Replacement Rules

Selection replacement happens around the active trigger range.

In `ChatView`, inspect:

- `resolveActiveComposerTrigger`
- `onSelectComposerItem`
- `extendReplacementRangeForTrailingSpace`
- `applyPromptReplacement`

Rules:

- Re-read the active editor snapshot before applying a selection.
- Use the current trigger range from `resolveActiveComposerTrigger()`, not stale state from render.
- Preserve the trailing-space behavior so selecting an item does not create double spaces.
- For prompt references, use source helpers like `buildSkillPromptReference()` instead of hand-building strings in `ChatView`.
- After a successful selection, clear `composerHighlightedItemId`.

## Menu Behavior

`ComposerCommandMenu` is intentionally generic. Keep source-specific labels and descriptions in item builders unless the menu itself needs a reusable rendering capability.

When changing keyboard behavior, inspect:

- `composerMenuItemsRef`
- `activeComposerMenuItemRef`
- `nudgeComposerMenuHighlight`
- `onComposerCommandKey`

Cover ArrowUp, ArrowDown, Enter, Tab, and Escape when behavior changes.

## Inline Composer Display

`ComposerPromptEditor` uses Lexical custom nodes for inline tokens.

For `@...` references:

- parsing starts in `composer-editor-mentions.ts`
- node rendering is in `ComposerPromptEditor.tsx`
- shared chip classes are in `composerInlineChip.ts`

Do not implement a second inline-token parser in the editor component. Update `composer-editor-mentions.ts` or shared reference helpers.

## Validation

At minimum:

```bash
bun fmt
bun lint
bun typecheck
```

For trigger/replacement logic, add or update focused tests:

```bash
cd apps/web
bun run test src/composer-logic.test.ts
```

For menu item mapping:

```bash
cd apps/web
bun run test src/components/chat/composerSuggestionItems.test.ts
```

For full browser interaction, prefer existing browser tests in `ChatView.browser.tsx` when the change affects real clicking, typing, or sending.

Never run `bun test`; use `bun run test`.

## Footguns

- Do not put trigger parsing in `ChatView`.
- Do not map source entries to menu items inline in `ChatView` when a builder helper can own it.
- Do not mutate prompt text without checking the latest editor snapshot.
- Do not forget collapsed-vs-expanded cursor conversion around inline tokens.
- Do not break `//` versus `/` distinction; `//plan` is a skill query, not `/plan`.
- Do not change selected skill/file prompt text without checking sent-message copy behavior.
- Do not create source-specific rendering branches in `ComposerCommandMenu` unless the item union needs a new reusable type.
- Do not bypass `bun fmt`, `bun lint`, and `bun typecheck`.
