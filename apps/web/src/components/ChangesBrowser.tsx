import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DiffIcon,
  FileIcon,
  FolderOpenIcon,
  ListTodoIcon,
  NotebookTextIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  XIcon,
} from "lucide-react";
import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { ThreadId } from "@t3tools/contracts";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage, PersistedFileChange } from "../types";
import {
  categorizeReference,
  type ChangesPanelGroup,
  type DiscoveredFileReference,
} from "../changesDiscovery";
import { useChangesDiscovery } from "../hooks/useChangesDiscovery";
import type { CodeLineMarkerKind } from "../lib/codeDiffMarkers";
import { parseCodeDiffMarkers } from "../lib/codeDiffMarkers";
import {
  basenameOfChangesPath,
  canonicalizeChangesPathForLookup,
  isAbsoluteChangesPath,
  normalizeChangesPath,
  resolveChangesAbsolutePath,
  resolveChangesThreadRelativePath,
  stripChangesBasePath,
} from "../lib/changesPath";
import {
  buildChangesPreviewCacheKey,
  changesPreviewContentCache,
  estimateChangesPreviewContentSize,
} from "../lib/changesPreviewCache";
import { getChangeKindTextClass } from "../lib/changeKindColor";
import type { ChangesExplorerStat } from "../lib/changesExplorerTree";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import {
  checkpointDiffQueryOptions,
  checkpointFileDiffQueryOptions,
} from "../lib/providerReactQuery";
import { readWorkspaceFileContent } from "../lib/workspaceFileContent";
import type { ChangesPanelContentMode } from "../uiStateStore";
import { cn } from "../lib/utils";
import { ArtifactContent, type ContentState } from "./ArtifactPanel";
import { ChangesExplorerTree } from "./ChangesExplorerTree";
import CodeFileViewer from "./CodeFileViewer";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { useTheme } from "../hooks/useTheme";

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

const CHANGES_BROWSER_PANE_WIDTH_STORAGE_KEY = "changes_window_browser_pane_width";
const CHANGES_BROWSER_PANE_COLLAPSED_STORAGE_KEY = "changes_window_browser_pane_collapsed";
const CHANGES_BROWSER_PANE_DEFAULT_WIDTH = 320;
const CHANGES_BROWSER_PANE_MIN_WIDTH = 220;
const CHANGES_BROWSER_PANE_MAX_WIDTH = 520;

type FileChangeSnapshot = ChangesExplorerStat & {
  kind?: string | undefined;
};

function buildFileChangeSnapshotIndex(
  persistedFileChanges: readonly PersistedFileChange[],
  basePath: string | null,
): ReadonlyMap<string, FileChangeSnapshot> {
  const index = new Map<string, FileChangeSnapshot>();
  for (const change of persistedFileChanges) {
    const snapshot: FileChangeSnapshot = {
      additions: change.totalInsertions,
      deletions: change.totalDeletions,
      kind: change.kind,
    };
    const normalizedPath = canonicalizeChangesPathForLookup(change.path);
    if (normalizedPath.length > 0) {
      index.set(normalizedPath, snapshot);
    }
    if (basePath && !isAbsoluteChangesPath(change.path)) {
      const joined = resolveChangesAbsolutePath(basePath, change.path);
      index.set(canonicalizeChangesPathForLookup(joined), snapshot);
    }
  }
  return index;
}

function buildFileStatsIndex(
  persistedFileChanges: readonly PersistedFileChange[],
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

function buildFileKindIndex(
  persistedFileChanges: readonly PersistedFileChange[],
  basePath: string | null,
): ReadonlyMap<string, string | undefined> {
  const kinds = new Map<string, string | undefined>();
  for (const change of persistedFileChanges) {
    const normalizedPath = canonicalizeChangesPathForLookup(change.path);
    if (normalizedPath.length > 0) {
      kinds.set(normalizedPath, change.kind);
    }
    if (basePath && !isAbsoluteChangesPath(change.path)) {
      const joined = resolveChangesAbsolutePath(basePath, change.path);
      kinds.set(canonicalizeChangesPathForLookup(joined), change.kind);
    }
  }
  return kinds;
}

function findFileChangeSnapshot(
  snapshots: ReadonlyMap<string, FileChangeSnapshot>,
  pathValue: string | null,
): FileChangeSnapshot | null {
  if (!pathValue) {
    return null;
  }
  return snapshots.get(canonicalizeChangesPathForLookup(pathValue)) ?? null;
}

function useWorkspaceFileContentState(input: {
  threadId: string | null;
  worktreePath: string | null;
  absolutePath: string | null;
  enabled: boolean;
  mode: ChangesPanelContentMode;
}): ContentState {
  const [state, setState] = useState<ContentState>({ status: "idle" });

  useEffect(() => {
    if (!input.enabled || !input.absolutePath) {
      setState({ status: "idle" });
      return;
    }

    const cacheKey = buildChangesPreviewCacheKey({
      threadId: input.threadId,
      path: input.absolutePath,
      mode: input.mode,
    });
    const cachedContent = cacheKey ? changesPreviewContentCache.get(cacheKey) : null;
    if (cachedContent != null) {
      setState({ status: "loaded", content: cachedContent, path: input.absolutePath });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    void readWorkspaceFileContent({
      worktreePath: input.worktreePath,
      absolutePath: input.absolutePath,
    })
      .then((content) => {
        if (cancelled) {
          return;
        }
        if (cacheKey) {
          changesPreviewContentCache.set(
            cacheKey,
            content,
            estimateChangesPreviewContentSize(content),
          );
        }
        setState({ status: "loaded", content, path: input.absolutePath ?? "" });
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
  }, [input.absolutePath, input.enabled, input.mode, input.threadId, input.worktreePath]);

  return state;
}

function findSelectedFileDiffMetadata(
  patch: string | undefined,
  selectedFilePath: string | null,
): FileDiffMetadata | null {
  if (!patch || !selectedFilePath) {
    return null;
  }

  const normalizedSelectedPath = normalizeChangesPath(selectedFilePath);
  try {
    const parsedPatches = parsePatchFiles(
      patch.trim().replace(/\r\n/g, "\n"),
      buildPatchCacheKey(patch, `changes-panel:${normalizedSelectedPath}`),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    return (
      files.find((file) => {
        const name = normalizeChangesPath(file.name).replace(/^a\//, "").replace(/^b\//, "");
        const prevName = file.prevName
          ? normalizeChangesPath(file.prevName).replace(/^a\//, "").replace(/^b\//, "")
          : "";
        return name === normalizedSelectedPath || prevName === normalizedSelectedPath;
      }) ?? null
    );
  } catch {
    return null;
  }
}

function useChangesBrowserFileDiffState(input: {
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

function hasMarkers(markers: ReadonlyMap<number, CodeLineMarkerKind>): boolean {
  return markers.size > 0;
}

function groupItemsBySourceLabel(
  items: readonly DiscoveredFileReference[],
): ReadonlyArray<{ label: string | null; items: readonly DiscoveredFileReference[] }> {
  const groups: { label: string | null; items: DiscoveredFileReference[] }[] = [];
  let currentGroup: { label: string | null; items: DiscoveredFileReference[] } | null = null;

  for (const item of items) {
    const label = item.sourceGroupLabel ?? null;
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = { label, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(item);
  }

  return groups;
}

function ChangesFlatGroup(props: {
  group: ChangesPanelGroup;
  activePath: string | null;
  resolvedTheme: "light" | "dark";
  fileKindsByPath: ReadonlyMap<string, string | undefined>;
  onSelectItem: (item: DiscoveredFileReference) => void;
  onOpenItemInWindow?: ((item: DiscoveredFileReference) => void) | undefined;
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
          {groupItemsBySourceLabel(props.group.items).map((sourceGroup) => (
            <div
              key={
                sourceGroup.label
                  ? `source:${sourceGroup.label}`
                  : `ungrouped:${sourceGroup.items[0]?.resolvedPath ?? props.group.section}`
              }
              className="space-y-0.5"
            >
              {sourceGroup.label ? (
                <div className="px-3 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground/80">
                  {sourceGroup.label}
                </div>
              ) : null}
              {sourceGroup.items.map((item) => {
                const isActive = props.activePath === item.resolvedPath;
                const changeKind =
                  props.group.section === "files_changed"
                    ? props.fileKindsByPath.get(canonicalizeChangesPathForLookup(item.resolvedPath))
                    : undefined;
                return (
                  <button
                    key={`${item.section}:${item.sourceThreadId ?? "thread"}:${item.firstSeenMessageId}:${item.resolvedPath}`}
                    type="button"
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-3 text-left transition-colors",
                      sourceGroup.label ? "pl-6" : "pl-3",
                      isActive
                        ? "bg-primary/8 text-foreground"
                        : "text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
                    )}
                    onClick={() => props.onSelectItem(item)}
                    onDoubleClick={() => props.onOpenItemInWindow?.(item)}
                    title={item.sourcePath ?? item.resolvedPath}
                  >
                    <VscodeEntryIcon
                      pathValue={item.filename}
                      kind="file"
                      theme={props.resolvedTheme}
                      className="size-3.5 shrink-0"
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12px]",
                        props.group.section === "files_changed"
                          ? getChangeKindTextClass(changeKind)
                          : "text-muted-foreground/80",
                      )}
                    >
                      {item.filename}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ChangesBrowserHeader(props: {
  title: string;
  count: number;
  onClose?: (() => void) | undefined;
  showIcon?: boolean | undefined;
  onToggleBrowserPane?: (() => void) | undefined;
  browserPaneCollapsed?: boolean | undefined;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
      <div className="flex items-center gap-2">
        {props.showIcon !== false ? (
          <FolderOpenIcon className="size-4 text-muted-foreground/70" />
        ) : null}
        <span className="text-[13px] font-medium text-foreground/90">{props.title}</span>
        {props.count > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {props.count}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {props.onToggleBrowserPane ? (
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={props.onToggleBrowserPane}
            aria-label={
              props.browserPaneCollapsed ? "Expand file browser" : "Collapse file browser"
            }
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            {props.browserPaneCollapsed ? (
              <PanelLeftOpenIcon className="size-3.5" />
            ) : (
              <PanelLeftCloseIcon className="size-3.5" />
            )}
          </Button>
        ) : null}
        {props.onClose ? (
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={props.onClose}
            aria-label="Close changes panel"
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <XIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface ChangesSelectionAction {
  key: string;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  variant: "secondary" | "ghost";
}

function buildSelectionActions(input: {
  canShowDiff: boolean;
  canShowFile: boolean;
  onShowDiff: () => void;
  onShowFile: () => void;
}): ChangesSelectionAction[] {
  const actions: ChangesSelectionAction[] = [];
  if (input.canShowDiff) {
    actions.push({
      key: "show-diff",
      label: "Show diff",
      ariaLabel: "Show diff",
      onClick: input.onShowDiff,
      variant: "secondary",
    });
  }
  if (input.canShowFile) {
    actions.push({
      key: "show-file",
      label: "Show file",
      ariaLabel: "Show file",
      onClick: input.onShowFile,
      variant: "secondary",
    });
  }
  return actions;
}

function ChangesSelectionHeader(props: {
  activeItem: DiscoveredFileReference | null;
  activePath: string | null;
  basePath: string | null;
  mode: ChangesPanelContentMode;
  actions: ReadonlyArray<ChangesSelectionAction>;
}) {
  const badgeLabel =
    props.activeItem?.section === "files_changed"
      ? props.mode === "diff"
        ? "Diff viewer"
        : "Code viewer"
      : "Markdown viewer";
  const Icon = props.activeItem?.section === "files_changed" ? DiffIcon : BookOpenIcon;
  const location = props.activePath ? stripChangesBasePath(props.activePath, props.basePath) : null;
  const fileName = props.activePath
    ? basenameOfChangesPath(props.activePath)
    : "Select a file to preview";
  const sectionBadgeLabel =
    props.activePath && props.activeItem?.section === "files_changed"
      ? fileName
      : props.activeItem?.section?.replaceAll("_", " ");

  return (
    <div className="border-b border-border/70 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground/70 uppercase">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-foreground/70 shadow-xs">
              <Icon className="size-3" />
              {badgeLabel}
            </span>
            {sectionBadgeLabel ? (
              <span className="inline-flex items-center rounded-full bg-muted/70 px-2 py-1 text-muted-foreground">
                {sectionBadgeLabel}
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
          {props.actions.map((action) => (
            <Button
              key={action.key}
              size="sm"
              variant={action.variant}
              onClick={action.onClick}
              aria-label={action.ariaLabel}
            >
              {action.label}
            </Button>
          ))}
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
  contentMode: ChangesPanelContentMode;
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

export interface ChangesBrowserProps {
  title?: string | undefined;
  threadId: ThreadId | null;
  worktreePath: string | null;
  messages: readonly ChatMessage[];
  persistedFileChanges: readonly PersistedFileChange[];
  groups?: readonly ChangesPanelGroup[] | undefined;
  latestCheckpointTurnCount: number | null;
  filesChangedViewType: "list" | "tree";
  activePath: string | null;
  contentMode: ChangesPanelContentMode;
  onSelectItem: (item: DiscoveredFileReference) => void;
  onOpenItemInWindow?: ((item: DiscoveredFileReference) => void) | undefined;
  onContentModeChange: (mode: ChangesPanelContentMode) => void;
  onClose?: (() => void) | undefined;
  showPreviewPane?: boolean | undefined;
  headerShowIcon?: boolean | undefined;
  enableBrowserPaneControls?: boolean | undefined;
}

export const ChangesBrowser = memo(function ChangesBrowser({
  title = "Changes",
  threadId,
  worktreePath,
  messages,
  persistedFileChanges,
  groups: providedGroups,
  latestCheckpointTurnCount,
  filesChangedViewType,
  activePath,
  contentMode,
  onSelectItem,
  onOpenItemInWindow,
  onContentModeChange,
  onClose,
  showPreviewPane = true,
  headerShowIcon = true,
  enableBrowserPaneControls = false,
}: ChangesBrowserProps) {
  const { resolvedTheme } = useTheme();
  const [browserPaneCollapsed, setBrowserPaneCollapsed] = useState(false);
  const [browserPaneWidth, setBrowserPaneWidth] = useState(CHANGES_BROWSER_PANE_DEFAULT_WIDTH);
  const resizeStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    if (!enableBrowserPaneControls || typeof window === "undefined") {
      return;
    }

    const storedWidth = Number(window.localStorage.getItem(CHANGES_BROWSER_PANE_WIDTH_STORAGE_KEY));
    if (Number.isFinite(storedWidth)) {
      setBrowserPaneWidth(
        Math.max(
          CHANGES_BROWSER_PANE_MIN_WIDTH,
          Math.min(CHANGES_BROWSER_PANE_MAX_WIDTH, storedWidth),
        ),
      );
    }
    setBrowserPaneCollapsed(
      window.localStorage.getItem(CHANGES_BROWSER_PANE_COLLAPSED_STORAGE_KEY) === "true",
    );
  }, [enableBrowserPaneControls]);

  useEffect(() => {
    if (!enableBrowserPaneControls || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CHANGES_BROWSER_PANE_WIDTH_STORAGE_KEY, String(browserPaneWidth));
  }, [browserPaneWidth, enableBrowserPaneControls]);

  useEffect(() => {
    if (!enableBrowserPaneControls || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      CHANGES_BROWSER_PANE_COLLAPSED_STORAGE_KEY,
      browserPaneCollapsed ? "true" : "false",
    );
  }, [browserPaneCollapsed, enableBrowserPaneControls]);

  useEffect(() => {
    if (!enableBrowserPaneControls || typeof window === "undefined") {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }
      const delta = event.clientX - resizeState.startX;
      const nextWidth = Math.max(
        CHANGES_BROWSER_PANE_MIN_WIDTH,
        Math.min(CHANGES_BROWSER_PANE_MAX_WIDTH, resizeState.startWidth + delta),
      );
      setBrowserPaneWidth(nextWidth);
      if (browserPaneCollapsed && nextWidth > CHANGES_BROWSER_PANE_MIN_WIDTH) {
        setBrowserPaneCollapsed(false);
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (resizeStateRef.current?.pointerId === event.pointerId) {
        resizeStateRef.current = null;
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [browserPaneCollapsed, enableBrowserPaneControls]);
  const discoveredGroups = useChangesDiscovery(
    messages,
    persistedFileChanges,
    worktreePath ?? undefined,
  );
  const groups = providedGroups ?? discoveredGroups;
  const nonEmptyGroups = useMemo(() => groups.filter((group) => group.items.length > 0), [groups]);
  const totalCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.items.length, 0),
    [groups],
  );

  const fileChangeSnapshots = useMemo(
    () => buildFileChangeSnapshotIndex(persistedFileChanges, worktreePath),
    [persistedFileChanges, worktreePath],
  );
  const fileStatsByPath = useMemo(
    () => buildFileStatsIndex(persistedFileChanges, worktreePath),
    [persistedFileChanges, worktreePath],
  );
  const fileKindsByPath = useMemo(
    () => buildFileKindIndex(persistedFileChanges, worktreePath),
    [persistedFileChanges, worktreePath],
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
    return {
      rawRef: activePath,
      resolvedPath: activePath,
      filename: basenameOfChangesPath(activePath),
      section: categorizeReference(activePath),
      firstSeenMessageId: "standalone-selection",
    } satisfies DiscoveredFileReference;
  }, [activePath, groups]);

  const activeFileSnapshot = useMemo(
    () => findFileChangeSnapshot(fileChangeSnapshots, activePath),
    [activePath, fileChangeSnapshots],
  );
  const activeSection = activeItem?.section ?? null;
  const isCodeSelection = activeSection === "files_changed";
  const isDeletedFile = isCodeSelection && activeFileSnapshot?.kind === "deleted";
  const showPreviewWithoutCard = contentMode === "preview" && !isDeletedFile;
  const canShowDiff = isCodeSelection && (contentMode === "preview" || isDeletedFile);
  const canShowFile = isCodeSelection && contentMode === "diff";
  const activeSourceThreadId = activeItem?.sourceThreadId
    ? ThreadId.makeUnsafe(activeItem.sourceThreadId)
    : threadId;
  const activeSourceWorktreePath = activeItem?.sourceWorktreePath ?? worktreePath;
  const activeSourcePath = activeItem?.sourcePath ?? activePath;
  const activeLatestCheckpointTurnCount =
    activeItem?.sourceLatestCheckpointTurnCount ?? latestCheckpointTurnCount;
  const activeAbsolutePath = useMemo(
    () =>
      activeSourcePath
        ? resolveChangesAbsolutePath(activeSourceWorktreePath, activeSourcePath)
        : null,
    [activeSourcePath, activeSourceWorktreePath],
  );
  const selectedFileQueryPath = useMemo(
    () =>
      activeSourcePath
        ? resolveChangesThreadRelativePath(activeSourceWorktreePath, activeSourcePath)
        : null,
    [activeSourcePath, activeSourceWorktreePath],
  );

  const fileDiffState = useChangesBrowserFileDiffState({
    threadId: activeSourceThreadId,
    selectedFilePath: activePath,
    selectedFileQueryPath,
    enabled: isCodeSelection,
    latestCheckpointTurnCount: activeLatestCheckpointTurnCount,
  });
  const fullThreadDiffFallbackQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: activeSourceThreadId,
      fromTurnCount: 0,
      toTurnCount: activeLatestCheckpointTurnCount,
      cacheScope:
        isCodeSelection && selectedFileQueryPath
          ? `changes-panel:fallback:${selectedFileQueryPath}`
          : null,
      enabled:
        isCodeSelection &&
        activeSourceThreadId !== null &&
        activeLatestCheckpointTurnCount !== null &&
        selectedFileQueryPath !== null &&
        (fileDiffState.query.isError ||
          fileDiffState.query.data == null ||
          fileDiffState.diffMetadata == null),
    }),
  );

  const contentState = useWorkspaceFileContentState({
    threadId: activeSourceThreadId ?? null,
    worktreePath: activeSourceWorktreePath,
    absolutePath: activeAbsolutePath,
    enabled: !!activeAbsolutePath && !isDeletedFile && contentMode === "preview",
    mode: contentMode,
  });
  const fallbackDiffMetadata = useMemo(
    () =>
      findSelectedFileDiffMetadata(fullThreadDiffFallbackQuery.data?.diff, selectedFileQueryPath),
    [fullThreadDiffFallbackQuery.data?.diff, selectedFileQueryPath],
  );
  const fallbackMarkers = useMemo(() => {
    if (!fullThreadDiffFallbackQuery.data?.diff || !selectedFileQueryPath) {
      return new Map<number, CodeLineMarkerKind>();
    }
    const result = parseCodeDiffMarkers({
      patch: fullThreadDiffFallbackQuery.data.diff,
      path: selectedFileQueryPath,
      cacheScope: `changes-panel:fallback:${activePath ?? selectedFileQueryPath}`,
    });
    return result.status === "ready" ? result.markers : new Map<number, CodeLineMarkerKind>();
  }, [activePath, fullThreadDiffFallbackQuery.data?.diff, selectedFileQueryPath]);
  const resolvedDiffMetadata = fileDiffState.diffMetadata ?? fallbackDiffMetadata;
  const resolvedMarkers =
    hasMarkers(fileDiffState.markers) || fallbackMarkers.size === 0
      ? fileDiffState.markers
      : fallbackMarkers;

  const actions = buildSelectionActions({
    canShowDiff,
    canShowFile,
    onShowDiff: () => onContentModeChange("diff"),
    onShowFile: () => onContentModeChange("preview"),
  });

  const diffError =
    fileDiffState.query.error instanceof Error
      ? fileDiffState.query.error.message
      : fullThreadDiffFallbackQuery.error instanceof Error
        ? fullThreadDiffFallbackQuery.error.message
        : null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <ChangesBrowserHeader
        title={title}
        count={totalCount}
        onClose={onClose}
        showIcon={headerShowIcon}
        onToggleBrowserPane={
          enableBrowserPaneControls ? () => setBrowserPaneCollapsed((value) => !value) : undefined
        }
        browserPaneCollapsed={browserPaneCollapsed}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "flex min-w-0 flex-col overflow-hidden bg-background/55",
            showPreviewPane && "border-r border-border/50",
            showPreviewPane && enableBrowserPaneControls && browserPaneCollapsed && "hidden",
          )}
          style={
            showPreviewPane && enableBrowserPaneControls && !browserPaneCollapsed
              ? { width: `${browserPaneWidth}px`, minWidth: `${browserPaneWidth}px` }
              : undefined
          }
        >
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
                      key={`${group.label}:${group.section}`}
                      groups={[group]}
                      activePath={activePath}
                      activeSection={activeSection}
                      basePath={worktreePath}
                      resolvedTheme={resolvedTheme}
                      fileStatsByPath={fileStatsByPath}
                      fileKindsByPath={fileKindsByPath}
                      onSelectItem={onSelectItem}
                      onOpenItemInWindow={onOpenItemInWindow}
                    />
                  ) : (
                    <ChangesFlatGroup
                      key={`${group.label}:${group.section}`}
                      group={group}
                      activePath={activePath}
                      resolvedTheme={resolvedTheme}
                      fileKindsByPath={fileKindsByPath}
                      onSelectItem={onSelectItem}
                      onOpenItemInWindow={onOpenItemInWindow}
                    />
                  ),
                )
              )}
            </div>
          </ScrollArea>
        </div>
        {showPreviewPane && enableBrowserPaneControls && !browserPaneCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file browser"
            className="relative w-1 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-border"
            onPointerDown={(event) => {
              resizeStateRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: browserPaneWidth,
              };
            }}
          />
        ) : null}

        {showPreviewPane ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col">
              <ChangesSelectionHeader
                activeItem={activeItem}
                activePath={activePath}
                basePath={worktreePath}
                mode={contentMode}
                actions={actions}
              />
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col">
                  <div
                    className={cn(
                      "min-w-0",
                      !showPreviewWithoutCard &&
                        "rounded-[1.35rem] border border-border/70 bg-card/92 p-5 shadow-[0_22px_50px_-34px_rgba(0,0,0,0.55)] backdrop-blur-xs",
                    )}
                  >
                    <ChangesPreviewBody
                      activeItem={activeItem}
                      activePath={activePath}
                      basePath={worktreePath}
                      contentMode={contentMode}
                      contentState={contentState}
                      diffMetadata={resolvedDiffMetadata}
                      diffError={diffError}
                      isDeletedFile={!!isDeletedFile}
                      markers={resolvedMarkers}
                      onShowDiff={() => onContentModeChange("diff")}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
