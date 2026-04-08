/**
 * ChangesPanel — Right-side panel showing categorized file references
 * from the current thread. Groups: Plans, Artifacts, Files Changed,
 * Changelog, Reports.
 *
 * The panel now behaves like an explorer with nested file trees and a
 * unified preview surface for markdown documents, full-file code preview,
 * and inline single-file diffs.
 */
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DiffIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  ListTodoIcon,
  NotebookTextIcon,
  XIcon,
} from "lucide-react";
import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { ChangesExplorerTree } from "./ChangesExplorerTree";
import CodeFileViewer from "./CodeFileViewer";
import { ArtifactContent, type ContentState } from "./ArtifactPanel";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { openInPreferredEditor } from "../editorPreferences";
import type { ChangesPanelGroup, DiscoveredFileReference } from "../changesDiscovery";
import { useChangesDiscovery } from "../hooks/useChangesDiscovery";
import { useSettings } from "../hooks/useSettings";
import { useStore } from "../store";
import { checkpointFileDiffQueryOptions } from "../lib/providerReactQuery";
import { readWorkspaceFileContent } from "../lib/workspaceFileContent";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import { parseCodeDiffMarkers, type CodeLineMarkerKind } from "../lib/codeDiffMarkers";
import { useTheme } from "../hooks/useTheme";
import { useUiStateStore } from "../uiStateStore";
import type { ChangesExplorerStat } from "../lib/changesExplorerTree";
import { cn } from "../lib/utils";
import { readNativeApi } from "~/nativeApi";

const LIST_SECTION_ICON = {
  plans: ListTodoIcon,
  artifacts: BookOpenIcon,
  working_memory: NotebookTextIcon,
  files_changed: DiffIcon,
  changelog: ClipboardListIcon,
  reports: FileIcon,
} as const;

const LIST_SECTION_ACCENT = {
  plans: "text-blue-400",
  artifacts: "text-purple-400",
  working_memory: "text-cyan-400",
  files_changed: "text-emerald-400",
  changelog: "text-amber-400",
  reports: "text-orange-400",
} as const;

const LIST_SECTION_COUNT_BG = {
  plans: "bg-blue-500/10 text-blue-400",
  artifacts: "bg-purple-500/10 text-purple-400",
  working_memory: "bg-cyan-500/10 text-cyan-400",
  files_changed: "bg-emerald-500/10 text-emerald-400",
  changelog: "bg-amber-500/10 text-amber-400",
  reports: "bg-orange-500/10 text-orange-400",
} as const;

function normalizePathValue(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

function isAbsolutePath(pathValue: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(pathValue);
}

function stripBasePath(pathValue: string, basePath: string | null): string {
  const normalizedPath = normalizePathValue(pathValue);
  const normalizedBase = basePath ? normalizePathValue(basePath).replace(/\/+$/, "") : null;
  if (!normalizedBase) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedBase) {
    return "";
  }
  const prefix = `${normalizedBase}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

function resolveWorkspaceAbsolutePath(worktreePath: string | null, pathValue: string): string {
  const normalizedPath = normalizePathValue(pathValue);
  if (isAbsolutePath(normalizedPath) || !worktreePath) {
    return normalizedPath;
  }
  return `${normalizePathValue(worktreePath).replace(/\/+$/, "")}/${normalizedPath}`;
}

function resolveThreadRelativePath(worktreePath: string | null, pathValue: string): string {
  const normalizedPath = normalizePathValue(pathValue);
  if (!worktreePath) {
    return normalizedPath;
  }
  const normalizedWorktree = normalizePathValue(worktreePath).replace(/\/+$/, "");
  const prefix = `${normalizedWorktree}/`;
  if (normalizedPath === normalizedWorktree) {
    return "";
  }
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return normalizedPath.replace(/^\/+/, "");
}

function basenameOf(pathValue: string): string {
  const normalized = normalizePathValue(pathValue);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

type FileChangeSnapshot = ChangesExplorerStat & {
  kind?: string | undefined;
};

function buildFileChangeSnapshotIndex(
  persistedFileChanges: readonly {
    path: string;
    kind?: string | undefined;
    totalInsertions: number;
    totalDeletions: number;
  }[],
  basePath: string | null,
): ReadonlyMap<string, FileChangeSnapshot> {
  const index = new Map<string, FileChangeSnapshot>();
  for (const change of persistedFileChanges) {
    const snapshot: FileChangeSnapshot = {
      additions: change.totalInsertions,
      deletions: change.totalDeletions,
      kind: change.kind,
    };
    const normalizedPath = normalizePathValue(change.path).replace(/\/+$/, "").toLowerCase();
    if (normalizedPath.length > 0) {
      index.set(normalizedPath, snapshot);
    }
    if (basePath && !isAbsolutePath(change.path)) {
      const joined = `${normalizePathValue(basePath).replace(/\/+$/, "")}/${normalizePathValue(change.path)}`;
      index.set(joined.replace(/\/+$/, "").toLowerCase(), snapshot);
    }
  }
  return index;
}

function buildFileStatsIndex(
  persistedFileChanges: readonly {
    path: string;
    totalInsertions: number;
    totalDeletions: number;
  }[],
  basePath: string | null,
): ReadonlyMap<string, ChangesExplorerStat | null> {
  const snapshots = buildFileChangeSnapshotIndex(persistedFileChanges, basePath);
  const stats = new Map<string, ChangesExplorerStat | null>();
  for (const [path, snapshot] of snapshots) {
    stats.set(path, {
      additions: snapshot.additions,
      deletions: snapshot.deletions,
    });
  }
  return stats;
}

function findFileChangeSnapshot(
  snapshots: ReadonlyMap<string, FileChangeSnapshot>,
  pathValue: string | null,
): FileChangeSnapshot | null {
  if (!pathValue) {
    return null;
  }
  const snapshot =
    snapshots.get(normalizePathValue(pathValue).replace(/\/+$/, "").toLowerCase()) ?? null;
  return snapshot;
}

function useWorkspaceFileContentState(input: {
  worktreePath: string | null;
  absolutePath: string | null;
  enabled: boolean;
}): ContentState {
  const [state, setState] = useState<ContentState>({ status: "idle" });

  useEffect(() => {
    if (!input.enabled || !input.absolutePath) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    void readWorkspaceFileContent({
      worktreePath: input.worktreePath,
      absolutePath: input.absolutePath,
    })
      .then((content) => {
        if (!cancelled) {
          setState({ status: "loaded", content, path: input.absolutePath ?? "" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load file.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.absolutePath, input.enabled, input.worktreePath]);

  return state;
}

function findSelectedFileDiffMetadata(
  patch: string | undefined,
  selectedFilePath: string | null,
): FileDiffMetadata | null {
  if (!patch || !selectedFilePath) {
    return null;
  }

  const normalizedSelectedPath = normalizePathValue(selectedFilePath);
  try {
    const parsedPatches = parsePatchFiles(
      patch.trim().replace(/\r\n/g, "\n"),
      buildPatchCacheKey(patch, `changes-panel:${normalizedSelectedPath}`),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    return (
      files.find((file) => {
        const name = normalizePathValue(file.name).replace(/^a\//, "").replace(/^b\//, "");
        const prevName = file.prevName
          ? normalizePathValue(file.prevName).replace(/^a\//, "").replace(/^b\//, "")
          : "";
        return name === normalizedSelectedPath || prevName === normalizedSelectedPath;
      }) ?? null
    );
  } catch {
    return null;
  }
}

function useChangesPanelFileDiffState(input: {
  threadId: ThreadId | null;
  selectedFilePath: string | null;
  selectedFileQueryPath: string | null;
  enabled: boolean;
  latestCheckpointTurnCount: number | null;
}) {
  const query = useQuery(
    checkpointFileDiffQueryOptions({
      threadId: input.threadId,
      path: input.selectedFileQueryPath,
      fromTurnCount: 0,
      toTurnCount: input.latestCheckpointTurnCount,
      cacheScope: input.selectedFilePath ? `changes-panel:${input.selectedFilePath}` : null,
      enabled:
        input.enabled &&
        input.threadId !== null &&
        input.selectedFileQueryPath !== null &&
        input.latestCheckpointTurnCount !== null,
    }),
  );

  const diffMetadata = useMemo(
    () => findSelectedFileDiffMetadata(query.data?.diff, input.selectedFileQueryPath),
    [input.selectedFileQueryPath, query.data?.diff],
  );
  const markers = useMemo(() => {
    if (!query.data?.diff || !input.selectedFileQueryPath) {
      return new Map<number, CodeLineMarkerKind>();
    }
    const result = parseCodeDiffMarkers({
      patch: query.data.diff,
      path: input.selectedFileQueryPath,
      cacheScope: `changes-panel:${input.selectedFilePath ?? input.selectedFileQueryPath}`,
    });
    return result.status === "ready" ? result.markers : new Map<number, CodeLineMarkerKind>();
  }, [input.selectedFilePath, input.selectedFileQueryPath, query.data?.diff]);

  return { query, diffMetadata, markers };
}

function ChangesFlatGroup(props: {
  group: ChangesPanelGroup;
  activePath: string | null;
  onSelectItem: (item: DiscoveredFileReference) => void;
}) {
  const Icon = LIST_SECTION_ICON[props.group.section];
  const accentClass = LIST_SECTION_ACCENT[props.group.section];
  const countClass = LIST_SECTION_COUNT_BG[props.group.section];
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Collapsible open={!collapsed}>
      <CollapsibleTrigger
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className={cn("flex size-5 shrink-0 items-center justify-center", accentClass)}>
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </span>
        <Icon className={cn("size-3.5 shrink-0", accentClass)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">
          {props.group.label}
        </span>
        {props.group.items.length > 0 ? (
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
              countClass,
            )}
          >
            {props.group.items.length}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-0.5 pb-1 pl-3">
          {props.group.items.map((item) => {
            const isActive = props.activePath === item.resolvedPath;
            return (
              <button
                key={`${item.section}:${item.resolvedPath}`}
                type="button"
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                  isActive
                    ? "bg-primary/8 text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
                )}
                onClick={() => props.onSelectItem(item)}
                title={item.resolvedPath}
              >
                <FileTextIcon className="size-3 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate text-[12px]">{item.filename}</span>
              </button>
            );
          })}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ChangesPanelHeader(props: { title: string; count: number; onClose: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
      <div className="flex items-center gap-2">
        <FolderOpenIcon className="size-4 text-muted-foreground/70" />
        <span className="text-[13px] font-medium text-foreground/90">{props.title}</span>
        {props.count > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {props.count}
          </span>
        ) : null}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={props.onClose}
        aria-label="Close changes panel"
        className="text-muted-foreground/50 hover:text-foreground/70"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function ChangesSelectionHeader(props: {
  activeItem: DiscoveredFileReference | null;
  activePath: string | null;
  basePath: string | null;
  mode: "preview" | "diff";
  canShowDiff: boolean;
  canShowFile: boolean;
  onShowDiff: () => void;
  onShowFile: () => void;
  onOpenInEditor: () => void;
}) {
  const badgeLabel =
    props.activeItem?.section === "files_changed"
      ? props.mode === "diff"
        ? "Diff viewer"
        : "Code viewer"
      : "Markdown viewer";
  const Icon = props.activeItem?.section === "files_changed" ? DiffIcon : BookOpenIcon;
  const location = props.activePath ? stripBasePath(props.activePath, props.basePath) : null;
  const fileName = props.activePath ? basenameOf(props.activePath) : "Select a file to preview";

  return (
    <div className="border-b border-border/70 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground/70 uppercase">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-foreground/70 shadow-xs">
              <Icon className="size-3" />
              {badgeLabel}
            </span>
            {props.activeItem?.section ? (
              <span className="inline-flex items-center rounded-full bg-muted/70 px-2 py-1 text-muted-foreground">
                {props.activeItem.section.replaceAll("_", " ")}
              </span>
            ) : null}
            {props.mode === "diff" ? (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-primary">
                diff
              </span>
            ) : null}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {fileName}
            </h2>
            {location ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">{location}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {props.canShowDiff ? (
            <Button size="sm" variant="secondary" onClick={props.onShowDiff} aria-label="Show diff">
              Show diff
            </Button>
          ) : null}
          {props.canShowFile ? (
            <Button size="sm" variant="secondary" onClick={props.onShowFile} aria-label="Show file">
              Show file
            </Button>
          ) : null}
          {props.activePath ? (
            <Button
              size="icon-xs"
              variant="ghost"
              title="Open in editor"
              aria-label="Open in editor"
              onClick={props.onOpenInEditor}
              className="size-8"
            >
              <ArrowUpRightIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChangesPreviewEmptyState() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/60 text-muted-foreground">
        <BookOpenIcon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground/80">Select a file to preview.</p>
        <p className="text-sm text-muted-foreground">
          Markdown files render here, and code files open in the full-file viewer.
        </p>
      </div>
    </div>
  );
}

function ChangesDeletedFileState(props: { onShowDiff: () => void }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/92 p-5 shadow-sm">
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground/85">This file was deleted.</p>
        <p className="text-sm text-muted-foreground">
          The current file is not available on disk. Open diff mode to inspect the patch.
        </p>
      </div>
      <div className="mt-4">
        <Button size="sm" variant="secondary" onClick={props.onShowDiff}>
          Show diff
        </Button>
      </div>
    </div>
  );
}

function SingleFileDiffView(props: { fileDiff: FileDiffMetadata }) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);

  return (
    <DiffWorkerPoolProvider>
      <FileDiff
        fileDiff={props.fileDiff}
        options={{
          theme: diffThemeName,
          themeType: resolvedTheme,
          disableFileHeader: true,
          overflow: "scroll",
          collapsed: false,
        }}
      />
    </DiffWorkerPoolProvider>
  );
}

function ChangesPreviewBody(props: {
  activeItem: DiscoveredFileReference | null;
  activePath: string | null;
  basePath: string | null;
  contentMode: "preview" | "diff";
  contentState: ContentState;
  diffMetadata: FileDiffMetadata | null;
  diffError: string | null;
  isDeletedFile: boolean;
  markers: ReadonlyMap<number, CodeLineMarkerKind>;
  onShowDiff: () => void;
}) {
  if (!props.activePath || !props.activeItem) {
    return <ChangesPreviewEmptyState />;
  }

  if (props.activeItem.section !== "files_changed") {
    return <ArtifactContent state={props.contentState} cwd={props.basePath ?? undefined} />;
  }

  if (props.isDeletedFile) {
    if (props.contentMode === "diff" && props.diffMetadata) {
      return <SingleFileDiffView fileDiff={props.diffMetadata} />;
    }
    return <ChangesDeletedFileState onShowDiff={props.onShowDiff} />;
  }

  if (props.contentMode === "diff") {
    if (props.diffMetadata) {
      return <SingleFileDiffView fileDiff={props.diffMetadata} />;
    }
    return (
      <div className="rounded-2xl border border-border/70 bg-card/92 p-5 text-sm text-muted-foreground shadow-sm">
        {props.diffError ?? "Loading diff..."}
      </div>
    );
  }

  return (
    <CodeFileViewer
      path={props.activePath}
      content={props.contentState.status === "loaded" ? props.contentState.content : ""}
      markers={props.markers}
      loading={props.contentState.status === "loading"}
      error={props.contentState.status === "error" ? props.contentState.message : null}
    />
  );
}

interface ChangesPanelProps {}

export const ChangesPanel = memo(function ChangesPanel(_: ChangesPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const filesChangedViewType = settings.changesPanelFilesChangedViewType;
  const changesPanelOpen = useUiStateStore((state) => state.changesPanelOpen);
  const activePath = useUiStateStore((state) => state.changesPanelActivePath);
  const activeSection = useUiStateStore((state) => state.changesPanelActiveSection);
  const contentMode = useUiStateStore((state) => state.changesPanelContentMode);
  const closePanel = useUiStateStore((state) => state.closeChangesPanel);
  const setActivePath = useUiStateStore((state) => state.setChangesPanelActivePath);
  const setActiveSection = useUiStateStore((state) => state.setChangesPanelActiveSection);
  const setContentMode = useUiStateStore((state) => state.setChangesPanelContentMode);

  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useStore((store) =>
    routeThreadId ? store.threads.find((thread) => thread.id === routeThreadId) : undefined,
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeProjectId ? store.projects.find((project) => project.id === activeProjectId) : undefined,
  );
  const cwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const messages = activeThread?.messages ?? EMPTY_MESSAGES;
  const persistedFileChanges = activeThread?.persistedFileChanges ?? EMPTY_PERSISTED;

  const groups = useChangesDiscovery(messages, persistedFileChanges, cwd ?? undefined);
  const nonEmptyGroups = useMemo(() => groups.filter((group) => group.items.length > 0), [groups]);
  const totalCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.items.length, 0),
    [groups],
  );

  const fileChangeSnapshots = useMemo(
    () => buildFileChangeSnapshotIndex(persistedFileChanges, cwd),
    [cwd, persistedFileChanges],
  );
  const fileStatsByPath = useMemo(
    () => buildFileStatsIndex(persistedFileChanges, cwd),
    [cwd, persistedFileChanges],
  );
  const activeItem = useMemo(() => {
    if (!activePath) {
      return null;
    }
    for (const group of groups) {
      const item = group.items.find((entry) => entry.resolvedPath === activePath);
      if (item) {
        return item;
      }
    }
    return null;
  }, [activePath, groups]);

  const activeFileSnapshot = useMemo(
    () => findFileChangeSnapshot(fileChangeSnapshots, activePath),
    [activePath, fileChangeSnapshots],
  );
  const isCodeSelection = activeItem?.section === "files_changed";
  const isDeletedFile = isCodeSelection && activeFileSnapshot?.kind === "deleted";
  const canShowDiff = isCodeSelection && (contentMode === "preview" || isDeletedFile);
  const canShowFile = isCodeSelection && contentMode === "diff";
  const activeAbsolutePath = useMemo(
    () => (activePath ? resolveWorkspaceAbsolutePath(cwd, activePath) : null),
    [activePath, cwd],
  );
  const selectedFileQueryPath = useMemo(
    () => (activePath ? resolveThreadRelativePath(cwd, activePath) : null),
    [activePath, cwd],
  );

  const latestCheckpointTurnCount = useMemo(() => {
    if (!activeThread) {
      return null;
    }
    const turnCounts = activeThread.turnDiffSummaries
      .map((summary) => summary.checkpointTurnCount)
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return null;
    }
    return Math.max(...turnCounts);
  }, [activeThread]);

  const fileDiffState = useChangesPanelFileDiffState({
    threadId: activeThread?.id ?? null,
    selectedFilePath: activePath,
    selectedFileQueryPath,
    enabled: isCodeSelection,
    latestCheckpointTurnCount,
  });

  const contentState = useWorkspaceFileContentState({
    worktreePath: cwd,
    absolutePath: activeAbsolutePath,
    enabled: !!activeAbsolutePath && !isDeletedFile,
  });

  const selectedFileMarkers = useMemo(() => fileDiffState.markers, [fileDiffState.markers]);

  const handleSelectItem = useCallback(
    (item: DiscoveredFileReference) => {
      setActivePath(item.resolvedPath);
      setActiveSection(item.section);
      setContentMode("preview");
    },
    [setActivePath, setActiveSection, setContentMode],
  );

  const handleShowDiff = useCallback(() => {
    setContentMode("diff");
  }, [setContentMode]);

  const handleShowFile = useCallback(() => {
    setContentMode("preview");
  }, [setContentMode]);

  const handleOpenInEditor = useCallback(() => {
    if (!activeAbsolutePath) {
      return;
    }
    const api = readNativeApi();
    if (!api) {
      return;
    }
    void openInPreferredEditor(api, activeAbsolutePath);
  }, [activeAbsolutePath]);

  if (!changesPanelOpen) {
    return null;
  }

  const diffError =
    fileDiffState.query.error instanceof Error ? fileDiffState.query.error.message : null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <ChangesPanelHeader title="Changes" count={totalCount} onClose={closePanel} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-col overflow-hidden border-r border-border/50 bg-background/55">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              {nonEmptyGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-[13px] text-muted-foreground/40">No file references found.</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/30">
                    References will appear as the conversation progresses.
                  </p>
                </div>
              ) : (
                nonEmptyGroups.map((group) =>
                  group.section === "files_changed" && filesChangedViewType === "tree" ? (
                    <ChangesExplorerTree
                      key={group.section}
                      groups={[group]}
                      activePath={activePath}
                      activeSection={activeSection}
                      basePath={cwd}
                      resolvedTheme={resolvedTheme}
                      fileStatsByPath={fileStatsByPath}
                      onSelectItem={handleSelectItem}
                    />
                  ) : (
                    <ChangesFlatGroup
                      key={group.section}
                      group={group}
                      activePath={activePath}
                      onSelectItem={handleSelectItem}
                    />
                  ),
                )
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <ChangesSelectionHeader
              activeItem={activeItem}
              activePath={activePath}
              basePath={cwd}
              mode={contentMode}
              canShowDiff={canShowDiff}
              canShowFile={canShowFile}
              onShowDiff={handleShowDiff}
              onShowFile={handleShowFile}
              onOpenInEditor={handleOpenInEditor}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-3">
                <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground/75">
                  <FileTextIcon className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {activeItem?.resolvedPath
                      ? stripBasePath(activeItem.resolvedPath, cwd)
                      : "Select a file to preview the document."}
                  </span>
                </div>
                <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-card/92 p-5 shadow-[0_22px_50px_-34px_rgba(0,0,0,0.55)] backdrop-blur-xs">
                  <ChangesPreviewBody
                    activeItem={activeItem}
                    activePath={activePath}
                    basePath={cwd}
                    contentMode={contentMode}
                    contentState={contentState}
                    diffMetadata={fileDiffState.diffMetadata}
                    diffError={diffError}
                    isDeletedFile={isDeletedFile}
                    markers={selectedFileMarkers}
                    onShowDiff={handleShowDiff}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const EMPTY_MESSAGES: readonly [] = [];
const EMPTY_PERSISTED: readonly [] = [];
