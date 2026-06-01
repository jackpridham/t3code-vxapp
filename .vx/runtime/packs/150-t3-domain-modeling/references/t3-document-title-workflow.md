---
name: t3-document-title-workflow
description: "Use the shared document-title workflow in T3 Code whenever the task involves `document.title`, browser tab labels, settings titles, chat titles, window titles, or unread/notification counts in the title. Use this whenever someone asks to change the chat tab title, settings page title, route title, or add title prefixes like unread counts. Triggers on: 'document.title', 'page title', 'browser tab title', 'window title', 'chat title', 'settings title', 'tab label', 'notification count in title', 'unread count in tab'."
allowed-tools: Read, Grep, Bash
---

# Document Title Workflow

Use this skill to keep document-title behavior centralized in `apps/web/src/lib/documentTitle.ts` instead of scattering string assembly across routes and components.

## Source Of Truth

Start in:

- `apps/web/src/lib/documentTitle.ts`

That file owns:

- `buildAppDocumentTitle`
- `resolveChatDocumentTitle`
- `resolveSettingsDocumentTitle`
- `useDocumentTitle`

## Current App Rules

### Chat routes

- orchestrator thread: `thread.title · T3 Code (Alpha)`
- all other chat threads: `project.name · thread.title · T3 Code (Alpha)`
- no active thread: `T3 Code (Alpha)`

This logic currently flows through:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/lib/documentTitle.ts`

### Settings routes

- all settings pages currently use `Settings · T3 Code (Alpha)`

This currently flows through:

- `apps/web/src/routes/settings.tsx`
- `apps/web/src/lib/documentTitle.ts`

### App bootstrap / default fallback

- default app title comes from `buildAppDocumentTitle()`

This currently flows through:

- `apps/web/src/main.tsx`
- `apps/web/src/routes/__root.tsx`

## Strong Repo Rules

- Do not hand-build chat or settings titles in route components.
- Do not add new `document.title = ...` logic in app-shell components when `documentTitle.ts` can own the rule.
- Add new title composition rules to `buildAppDocumentTitle` or a focused resolver next to it.
- If a title needs unread counts or attention markers later, extend the existing `attentionPrefix` path instead of inventing a separate prefix system.

## Allowed Exception Surface

There are still direct title writes for standalone utility windows:

- `apps/web/src/components/ArtifactPanel.tsx`
- `apps/web/src/components/ChangesPanel.tsx`

Treat those as separate window-title surfaces, not as a reason to bypass `documentTitle.ts` for the main app shell.

If those windows later need app-branded titles or shared attention-prefix behavior, move them onto the shared builder rather than copying string logic again.

## Default Workflow

### 1. Find the current title owner

Check the shared helper first:

```bash
sed -n '1,220p' apps/web/src/lib/documentTitle.ts
rg -n "document.title" apps/web/src --glob '!**/*.test.*'
```

### 2. Classify the surface

Decide which of these you are changing:

- main app shell chat title
- settings title
- app default/bootstrap title
- standalone utility window title
- future attention/unread prefix behavior

### 3. Modify the shared builder first

For main app surfaces, update one of:

- `buildAppDocumentTitle`
- `resolveChatDocumentTitle`
- `resolveSettingsDocumentTitle`

Prefer changing resolvers before changing callers.

### 4. Keep callers thin

Callers should only:

- gather local inputs like `thread`, `projectName`, or route context
- call the shared resolver
- pass the result to `useDocumentTitle`

Avoid embedding title policy in:

- `ChatView.tsx`
- settings route components
- root route setup

## Future Notification Titles

Unread or attention state should flow through `attentionPrefix` in `buildAppDocumentTitle`.

Preferred shape:

- resolve the normal title parts first
- prepend attention state through `attentionPrefix`

Example target shape:

- `(3) repo-name · worker-thread · T3 Code (Alpha)`

Do not bolt unread counts directly into chat/settings routes.

## Fast Verification Commands

```bash
sed -n '1,220p' apps/web/src/lib/documentTitle.ts
rg -n "resolveChatDocumentTitle|resolveSettingsDocumentTitle|useDocumentTitle" apps/web/src
rg -n "document.title" apps/web/src --glob '!**/*.test.*'
```

## Response Pattern

When explaining title behavior, answer in this order:

1. Shared source of truth
2. Resolver for the relevant surface
3. Caller that supplies local inputs
4. Any direct-write exceptions
5. Extension path for unread/attention prefixes

## Escalate

- Use `t3-orchestration-trace` if the title question is really about where thread or project names originate
- Use `t3-ui-state-and-projection-boundaries` if the task is deciding whether unread/attention state belongs in browser state, metadata, or projections
