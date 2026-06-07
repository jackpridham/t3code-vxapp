---
name: t3-readonly-file-viewer-workflow
description: Use when adding, changing, or debugging read-only file viewing in T3 Code, especially markdown artifact detail views, absolute artifact paths, NativeApi projects.readFile, workspace read helpers, ChatMarkdown rendering, CodeFileViewer reuse, or deciding whether a new read-only server RPC is needed. Trigger on markdown viewer, artifact content, read file, absolute path, file viewer, ChatMarkdown, CodeFileViewer, or read-only RPC.
---

# T3 Read-Only File Viewer Workflow

Use this skill when the browser needs to display file content without editing it.

Prefer existing read paths and renderers. Add new server API only when an existing path cannot safely express the file being read.

## Primary Files

Rendering references:

- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/components/ArtifactPanel.tsx`
- `apps/web/src/components/CodeFileViewer.tsx`

Read helpers and APIs:

- `apps/web/src/lib/workspaceFileContent.ts`
- `apps/web/src/wsNativeApi.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/ws.ts`
- `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts`
- `apps/server/src/workspace/Services/WorkspaceFileSystem.ts`
- `apps/server/src/wsServer.ts`

Artifact consumers:

- `apps/web/src/components/artifacts/ArtifactDetailPage.tsx`
- `apps/web/src/lib/artifactPreloadCache.ts`
- `apps/web/src/lib/scratchArtifactLinks.ts`
- `apps/web/src/markdown-links.ts`

## Existing Read Path

The browser should read through NativeApi, not direct filesystem access.

Existing path:

```text
readWorkspaceFileContent()
  -> readNativeApi()
  -> api.projects.readFile({ cwd, relativePath })
  -> WS_METHODS.projectsReadFile
  -> WorkspaceFileSystem.readFile()
```

`WorkspaceFileSystem.readFile()` resolves relative paths within `cwd`, rejects escape paths, and enforces `PROJECT_READ_FILE_MAX_BYTES`.

## Absolute Path Handling

Artifact metadata can include absolute paths outside the target app workspace, often under a shared knowledge/artifact store.

For an absolute file path:

1. If it is under the known worktree path, use worktree root as `cwd` and the relative subpath as `relativePath`.
2. Otherwise, use the file parent directory as `cwd` and basename as `relativePath`.
3. Keep the server-side workspace path guard in place.

This lets existing read APIs handle absolute artifact paths without adding broad filesystem access.

## When To Add A New RPC

Add the smallest read-only RPC only if:

- the target path cannot be represented safely as `cwd` + `relativePath`
- the server must authorize a path family that is not a workspace
- the UI needs metadata not available from `projects.readFile`

If adding an RPC:

- Put schemas in `packages/contracts/src/server.ts` or `project.ts`, depending on ownership.
- Add NativeApi/WS method types in `packages/contracts/src/ipc.ts` and `packages/contracts/src/ws.ts`.
- Route it in `apps/server/src/wsServer.ts`.
- Keep it read-only.
- Validate path input and max file size.
- Return structured errors that do not leak excessive filesystem detail.

Do not broaden write APIs to solve read-only viewing.

## Markdown Rendering

For markdown:

- Prefer `ChatMarkdown`.
- Use `variant="document"` for readable standalone documents.
- Pass `cwd` when file links should resolve relative to the document/workspace.
- Reuse existing code highlighting behavior rather than implementing a second highlighter.

Good document layout:

```tsx
<header>title and metadata</header>
<ChatMarkdown text={content} cwd={cwd} variant="document" />
```

The markdown body should not look like an embedded preview. Avoid cards inside cards.

For artifact detail markdown, force a fresh disk read when the page opens:

- Resolve the artifact metadata path to an absolute path first.
- Use a React Query key that includes the target id and absolute path.
- Call `readWorkspaceFileContent()` from the query function.
- Use `staleTime: 0` and `refetchOnMount: "always"`.
- Display the content query's `dataUpdatedAt` as the content refreshed time.

This lets cached metadata appear immediately while making the file body trustworthy after edits on disk.

## Chat File Links To Artifacts

`ChatMarkdown` handles normal file links by resolving them and opening the preferred editor. The exception is a linked markdown file inside an exact `@Scratch` path segment.

For `@Scratch` artifact links:

- Keep detection in `apps/web/src/lib/scratchArtifactLinks.ts`.
- Let `apps/web/src/markdown-links.ts` accept `@` in path segments so relative scratch links are recognized.
- The segment after `@Scratch` is the app target id.
- The markdown filename, without `.md`, is the fallback artifact route slug.
- If local artifact preload metadata contains a matching path, prefer the cached artifact metadata slug.
- Return a normal `<a href="/artifacts/...">` for artifact links; do not intercept them as editor-open file links.

## Code Rendering

For source files, inspect `CodeFileViewer` before building a new viewer. Preserve existing highlighting, line handling, and overflow behavior where possible.

Use horizontal scrolling for long code lines rather than wrapping unless the feature explicitly requests wrap behavior.

## Error And Loading States

Handle:

- missing NativeApi
- missing file path
- file not found
- file too large
- read permission/path guard failure
- empty content

Keep user-facing errors concise. Preserve detailed server errors in logs where available.

## Validation

For a real artifact detail view, verify a direct URL to a known markdown artifact:

```text
/artifacts/api/ai-workspace-live-recurring-quotes-api-audit
```

For final repo completion:

```bash
bun fmt
bun lint
bun typecheck
```

If tests are relevant, use `bun run test`, never `bun test`.

## Footguns

- Do not read files directly from browser code.
- Do not add a write-capable API for a read-only viewer.
- Do not assume artifact paths live under the target repo workspace.
- Do not fetch every artifact body during preload.
- Do not duplicate markdown rendering components unless existing components cannot satisfy the use case.
- Do not let the markdown container block page scrolling.
- Do not let `@Scratch` artifact links fall through to editor-open behavior after they have resolved to `/artifacts/...`.
- Do not reuse stale file query data on artifact detail mount when the backing file may have changed.
