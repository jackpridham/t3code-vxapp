---
name: t3-skill-catalog-workflow
description: Use when adding, changing, debugging, or reviewing how T3 Code discovers, lists, inserts, parses, or displays agent skills, especially `.claude/skills`, `SKILL.md`, `//` skill suggestions, `useSkillSuggestions`, `skillCatalog`, `skillReferences`, skill prompt references, skill chips, or configured skills for an agent. Trigger on skill catalog, skill suggestions, agent skills, configured skills, `.claude/skills`, `SKILL.md`, skill mention, skill reference, skill chip, skill picker, or double-slash skills in ChatView.
---

# T3 Skill Catalog Workflow

Use this skill when the app is dealing with agent skills as selectable references or rendered chips.

The current product behavior is:

- skills are discovered from the active project or worktree `.claude/skills` directory
- only top-level directories under `.claude/skills` are selectable skills
- selecting a skill inserts `@<absolute path to SKILL.md> `
- composer and message display render that absolute path as a compact skill-name chip
- copied/sent text preserves the original absolute `@.../SKILL.md` reference

Keep those transport and display concerns separate.

## Primary Files

Skill catalog and references:

- `apps/web/src/lib/skillCatalog.ts`
- `apps/web/src/lib/skillReactQuery.ts`
- `apps/web/src/lib/skillReferences.ts`
- `apps/web/src/lib/skillReferenceDisplay.ts`

Composer integration:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/composerSuggestionItems.ts`
- `apps/web/src/components/chat/ComposerCommandMenu.tsx`
- `apps/web/src/components/ComposerPromptEditor.tsx`

Display integration:

- `apps/web/src/components/chat/SkillReferenceChip.tsx`
- `apps/web/src/components/chat/SkillIcon.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`

Workspace search path:

- `apps/web/src/lib/projectReactQuery.ts`
- `packages/contracts/src/project.ts`
- `apps/server/src/workspace/Services/WorkspaceEntries.ts`
- `apps/server/src/workspace/Layers/WorkspaceEntries.ts`
- `apps/server/src/wsServer.ts`

Tests:

- `apps/web/src/lib/skillCatalog.test.ts`
- `apps/web/src/lib/skillReferences.test.ts`
- `apps/web/src/lib/skillReactQuery.test.ts`
- `apps/web/src/components/chat/composerSuggestionItems.test.ts`
- skill-related cases in `apps/web/src/components/ChatView.browser.tsx`
- skill-reference cases in `apps/web/src/components/chat/MessagesTimeline.test.tsx`

## Catalog Boundary

Use `skillCatalog.ts` as the domain boundary.

It owns:

- resolving catalog roots from `SkillCatalogContext`
- mapping raw `ProjectEntry` rows into `SkillCatalogEntry`
- building prompt references
- parsing prompt references back into skill metadata

Do not make components construct `.claude/skills` paths directly. Do not make `ChatView` or message rendering infer skill roots.

When adding a new skill source, extend `SkillCatalogRoot` and `resolveSkillCatalogRoots()` first. Examples of future sources might include provider/user/global skills, but do not invent those sources unless the task needs them.

## Suggestion Data Flow

Current `//` flow:

```text
detectComposerTrigger()
  -> kind: "skill"
  -> useSkillSuggestions()
  -> projectSkillEntriesQueryOptions()
  -> projects.searchEntries({ cwd: <root>/.claude/skills, includeIgnored: true })
  -> toSkillCatalogEntry()
  -> buildSkillComposerItems()
  -> ComposerCommandMenu
  -> buildSkillPromptReference()
```

`useSkillSuggestions()` should be the normal browser-facing API for reusable skill lists. Components should not call `projects.searchEntries` directly for skills.

## Root And Worktree Semantics

For active chat threads, pass both:

- `projectCwd: activeProject?.cwd ?? null`
- `worktreePath: activeThread?.worktreePath ?? null`

The active root is `worktreePath ?? projectCwd`.

This preserves current behavior for worktree threads: skill discovery follows the cwd where the agent is operating.

The `provider` field exists in `SkillCatalogContext` for future provider-specific behavior. Do not branch on provider until the server/product has a real source of truth.

## Missing Directory Behavior

Missing `.claude/skills` is not an error in the UI.

`skillReactQuery.ts` intentionally treats ENOENT / missing-path errors as an empty result set. Preserve this behavior so projects without local skills do not show noisy errors.

Do not hide unrelated errors like permission denied or server failures; those should still surface through the query error path.

## Prompt Reference Rules

Use `buildSkillPromptReference(entry)` to insert a selected skill.

The inserted prompt reference should be:

```text
@/absolute/project/or/worktree/.claude/skills/<skill-name>/SKILL.md[space]
```

The `[space]` suffix represents the literal trailing space that is part of the selection UX. Keep replacement range handling in `ChatView` responsible for avoiding double spaces.

Do not change the transport format to `//skill-name` unless the provider/runtime contract changes. The absolute `@.../SKILL.md` form is what sent messages and copy behavior preserve today.

## Display Rules

Use shared display helpers:

- `resolveSkillReferenceDisplay()` for path -> display metadata
- `SkillReferenceChip` for React rendering
- `createSkillReferenceChipDomElement()` for Lexical DOM rendering

`skillReferences.ts` still owns splitting user-visible message text around skill references. Keep parsing behavior compatible with:

- Unix paths
- Windows-style paths
- trailing punctuation after `SKILL.md`
- references wrapped in punctuation

Do not show the absolute `.claude/skills/.../SKILL.md` path in normal message or composer display. Do preserve it for copying and sending.

## Server Search Considerations

Skill search reuses workspace search. That means it inherits:

- fuzzy ranking
- cache TTL behavior
- symlink indexing
- `includeIgnored: true`
- top-level directory filtering in the web skill mapper

If skill discovery must include multiple roots or provider-level skills, prefer adding a server-facing skill list contract rather than making every component merge filesystem roots. Until then, keep the browser API small and catalog-shaped.

## Tests To Add Or Update

For catalog root, mapping, and prompt reference changes:

```bash
cd apps/web
bun run test src/lib/skillCatalog.test.ts src/lib/skillReferences.test.ts
```

For query/missing directory behavior:

```bash
cd apps/web
bun run test src/lib/skillReactQuery.test.ts
```

For composer item mapping:

```bash
cd apps/web
bun run test src/components/chat/composerSuggestionItems.test.ts
```

For real browser behavior, update `ChatView.browser.tsx` skill cases when selection, sent text, or copy behavior changes.

## Completion Standard

Run the repo-required checks:

```bash
bun fmt
bun lint
bun typecheck
```

If tests are relevant, use `bun run test`, never `bun test`.

## Footguns

- Do not hand-build `.claude/skills` paths in components.
- Do not call `projects.searchEntries` directly for skill suggestions from UI components.
- Do not treat a missing `.claude/skills` directory as a user-facing error.
- Do not include nested files like `references/foo.md` as selectable skills.
- Do not drop `includeIgnored: true`; configured skills may be symlinked or ignored.
- Do not replace absolute `@.../SKILL.md` prompt references with display labels in sent/copied text.
- Do not duplicate skill chip rendering between composer and timeline.
- Do not expand provider-specific behavior without a clear source of truth.
