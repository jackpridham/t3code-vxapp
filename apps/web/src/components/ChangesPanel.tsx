import { ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildChangesWindowHref } from "../lib/changesWindow";
import { useSettings } from "../hooks/useSettings";
import { buildChangesWindowTarget, useChangesWindowTarget } from "../lib/changesWindowSync";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { ChangesBrowser } from "./ChangesBrowser";
import {
  collectSessionThreadIds,
  collapseThreadToCanonicalProject,
} from "../lib/orchestrationMode";
import {
  categorizeReference,
  discoverChangesReferences,
  type ChangesSectionKind,
  type DiscoveredFileReference,
} from "../changesDiscovery";
import type { ChangesPanelGroup } from "../changesDiscovery";
import type { PersistedFileChange, Project, Thread, TurnDiffSummary } from "../types";

const EMPTY_MESSAGES: readonly [] = [];
const EMPTY_PERSISTED: readonly [] = [];
const CHANGES_SECTION_LABELS: Record<ChangesSectionKind, string> = {
  plans: "Plans",
  artifacts: "Artifacts",
  working_memory: "Working Memory",
  files_changed: "Files Changed",
  changelog: "Changelog",
  reports: "Reports",
};
const CHANGES_SECTION_ORDER: readonly ChangesSectionKind[] = [
  "plans",
  "artifacts",
  "working_memory",
  "files_changed",
  "changelog",
  "reports",
];

function resolveLatestCheckpointTurnCount(
  turnDiffSummaries: readonly TurnDiffSummary[],
): number | null {
  const inferredCheckpointTurnCountByTurnId = inferCheckpointTurnCountByTurnId([
    ...turnDiffSummaries,
  ]);
  const turnCounts = turnDiffSummaries
    .map(
      (summary) =>
        summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
    )
    .filter((value): value is number => typeof value === "number");
  if (turnCounts.length === 0) {
    return null;
  }
  return Math.max(...turnCounts);
}

function sanitizeAggregatePathSegment(value: string): string {
  const segment = value.replaceAll(/[\\/]+/g, " ").trim();
  return segment.length > 0 ? segment : "Unknown Project";
}

function normalizeAggregateChangePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function buildAggregateDisplayPath(input: {
  projectName: string;
  workerTitle: string;
  sourcePath: string;
}): string {
  return [
    sanitizeAggregatePathSegment(input.projectName),
    sanitizeAggregatePathSegment(input.workerTitle),
    normalizeAggregateChangePath(input.sourcePath),
  ]
    .filter((segment) => segment.length > 0)
    .join("/");
}

function resolveThreadWorktreePath(
  thread: Pick<Thread, "projectId" | "worktreePath">,
  projectsById: ReadonlyMap<Project["id"], Pick<Project, "cwd">>,
): string | null {
  return thread.worktreePath ?? projectsById.get(thread.projectId)?.cwd ?? null;
}

export function buildOrchestratorWorkerChangesInput(input: {
  activeThread: Thread | undefined;
  threads: readonly Thread[];
  projects: readonly Project[];
}): {
  groups: readonly ChangesPanelGroup[] | undefined;
  latestCheckpointTurnCount: number | null;
  messages: readonly [];
  persistedFileChanges: readonly PersistedFileChange[];
  title: string;
  worktreePath: string | null;
} | null {
  const activeThread = input.activeThread;
  if (!activeThread || activeThread.spawnRole !== "orchestrator") {
    return null;
  }

  const sessionThreadIds = collectSessionThreadIds({
    rootThreadId: activeThread.id,
    threads: input.threads,
  });
  const projectsById = new Map(input.projects.map((project) => [project.id, project] as const));
  const groupsBySection = new Map<ChangesSectionKind, ChangesPanelGroup>();
  const persistedFileChanges: PersistedFileChange[] = [];

  function getGroup(section: ChangesSectionKind): ChangesPanelGroup {
    const existing = groupsBySection.get(section);
    if (existing) {
      return existing;
    }
    const created = {
      section,
      label: CHANGES_SECTION_LABELS[section],
      items: [],
    } satisfies ChangesPanelGroup;
    groupsBySection.set(section, created);
    return created;
  }

  for (const thread of input.threads) {
    if (thread.id === activeThread.id || !sessionThreadIds.has(thread.id)) {
      continue;
    }
    if (thread.spawnRole === "orchestrator") {
      continue;
    }

    const projectBucket = collapseThreadToCanonicalProject({
      thread,
      projects: input.projects,
    });
    const projectName = projectBucket.canonicalProjectName;
    const sourceGroupLabel = projectName;
    const sourceWorktreePath = resolveThreadWorktreePath(thread, projectsById);
    const sourceLatestCheckpointTurnCount = resolveLatestCheckpointTurnCount(
      thread.turnDiffSummaries,
    );

    for (const discoveredGroup of discoverChangesReferences(
      thread.messages,
      sourceWorktreePath ?? undefined,
    )) {
      const targetGroup = getGroup(discoveredGroup.section);
      for (const item of discoveredGroup.items) {
        const sourcePath = item.resolvedPath;
        targetGroup.items.push({
          ...item,
          resolvedPath: buildAggregateDisplayPath({
            projectName,
            workerTitle: thread.title,
            sourcePath,
          }),
          sourceThreadId: thread.id,
          sourceWorktreePath,
          sourcePath,
          sourceLatestCheckpointTurnCount,
          sourceGroupLabel,
        });
      }
    }

    for (const change of thread.persistedFileChanges) {
      const sourcePath = normalizeAggregateChangePath(change.path);
      if (sourcePath.length === 0) {
        continue;
      }

      const section = categorizeReference(sourcePath);
      const resolvedPath = buildAggregateDisplayPath({
        projectName,
        workerTitle: thread.title,
        sourcePath,
      });
      const filename = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
      getGroup(section).items.push({
        rawRef: change.path,
        resolvedPath,
        filename,
        section,
        firstSeenMessageId: change.firstTurnId,
        sourceThreadId: thread.id,
        sourceWorktreePath,
        sourcePath,
        sourceLatestCheckpointTurnCount,
        sourceGroupLabel,
      });
      persistedFileChanges.push({
        ...change,
        path: resolvedPath,
      });
    }
  }

  const groups = [...groupsBySection.values()]
    .filter((group) => group.items.length > 0)
    .toSorted((left, right) => {
      return (
        CHANGES_SECTION_ORDER.indexOf(left.section) - CHANGES_SECTION_ORDER.indexOf(right.section)
      );
    });

  return {
    groups,
    latestCheckpointTurnCount: null,
    messages: EMPTY_MESSAGES,
    persistedFileChanges,
    title: "Worker Changes",
    worktreePath: null,
  };
}

export const ChangesPanel = memo(function ChangesPanel() {
  const settings = useSettings();
  const filesChangedViewType = settings.changesPanelFilesChangedViewType;
  const activePath = useUiStateStore((state) => state.changesPanelActivePath);
  const contentMode = useUiStateStore((state) => state.changesPanelContentMode);
  const closePanel = useUiStateStore((state) => state.closeChangesPanel);
  const setActivePath = useUiStateStore((state) => state.setChangesPanelActivePath);
  const setActiveSection = useUiStateStore((state) => state.setChangesPanelActiveSection);
  const setContentMode = useUiStateStore((state) => state.setChangesPanelContentMode);
  const [, setChangesWindowTarget] = useChangesWindowTarget();

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
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const worktreePath = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  const orchestratorWorkerChangesInput = useMemo(
    () => buildOrchestratorWorkerChangesInput({ activeThread, threads, projects }),
    [activeThread, projects, threads],
  );

  const latestCheckpointTurnCount = useMemo(
    () => resolveLatestCheckpointTurnCount(activeThread?.turnDiffSummaries ?? []),
    [activeThread?.turnDiffSummaries],
  );
  const effectiveLatestCheckpointTurnCount =
    orchestratorWorkerChangesInput?.latestCheckpointTurnCount ?? latestCheckpointTurnCount;
  const effectiveMessages =
    orchestratorWorkerChangesInput?.messages ?? activeThread?.messages ?? EMPTY_MESSAGES;
  const effectivePersistedFileChanges =
    orchestratorWorkerChangesInput?.persistedFileChanges ??
    activeThread?.persistedFileChanges ??
    EMPTY_PERSISTED;
  const effectiveWorktreePath = orchestratorWorkerChangesInput?.worktreePath ?? worktreePath;
  const effectiveFilesChangedViewType = orchestratorWorkerChangesInput
    ? "list"
    : filesChangedViewType;

  const handleSelectItem = useCallback(
    (item: DiscoveredFileReference) => {
      setActivePath(item.resolvedPath);
      setActiveSection(item.section);
      setContentMode("preview");
    },
    [setActivePath, setActiveSection, setContentMode],
  );

  const handleOpenItemInWindow = useCallback(
    (item: DiscoveredFileReference) => {
      const targetThreadId = item.sourceThreadId
        ? ThreadId.makeUnsafe(item.sourceThreadId)
        : (activeThread?.id ?? routeThreadId);
      if (!targetThreadId || typeof window === "undefined") {
        return;
      }
      const targetPath = item.sourcePath ?? item.resolvedPath;

      setChangesWindowTarget(
        buildChangesWindowTarget({
          threadId: targetThreadId,
          path: targetPath,
          mode: "preview",
        }),
      );
      window.open(
        buildChangesWindowHref({
          threadId: targetThreadId,
          path: targetPath,
          mode: "preview",
        }),
        "_blank",
        "noopener,noreferrer",
      );
    },
    [activeThread?.id, routeThreadId, setChangesWindowTarget],
  );

  return (
    <ChangesBrowser
      title={orchestratorWorkerChangesInput?.title}
      threadId={activeThread?.id ?? null}
      worktreePath={effectiveWorktreePath}
      messages={effectiveMessages}
      persistedFileChanges={effectivePersistedFileChanges}
      groups={orchestratorWorkerChangesInput?.groups}
      latestCheckpointTurnCount={effectiveLatestCheckpointTurnCount}
      filesChangedViewType={effectiveFilesChangedViewType}
      activePath={activePath}
      contentMode={contentMode}
      onSelectItem={handleSelectItem}
      onOpenItemInWindow={handleOpenItemInWindow}
      onContentModeChange={setContentMode}
      onClose={closePanel}
      showPreviewPane={false}
    />
  );
});

export interface ChangesWindowProps {
  threadId: ThreadId;
  initialPath?: string | undefined;
  initialMode?: "preview" | "diff" | undefined;
}

export function ChangesWindow({ threadId, initialPath, initialMode }: ChangesWindowProps) {
  const settings = useSettings();
  const filesChangedViewType = settings.changesPanelFilesChangedViewType;
  const changesPanelWindowNavigationMode = settings.changesPanelWindowNavigationMode;
  const navigate = useNavigate();
  const [changesWindowTarget] = useChangesWindowTarget();
  const activeThread = useStore((store) => store.threads.find((thread) => thread.id === threadId));
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeProjectId ? store.projects.find((project) => project.id === activeProjectId) : undefined,
  );
  const worktreePath = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const [activePath, setActivePath] = useState<string | null>(initialPath ?? null);
  const [contentMode, setContentMode] = useState<"preview" | "diff">(initialMode ?? "preview");
  const lastAppliedTargetRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      changesPanelWindowNavigationMode !== "dynamic" ||
      !changesWindowTarget ||
      changesWindowTarget.revision === lastAppliedTargetRevisionRef.current
    ) {
      return;
    }

    lastAppliedTargetRevisionRef.current = changesWindowTarget.revision;
    void navigate({
      to: "/changes/$threadId",
      params: { threadId: changesWindowTarget.threadId },
      search: {
        ...(changesWindowTarget.path ? { path: changesWindowTarget.path } : {}),
        mode: changesWindowTarget.mode,
      },
      replace: true,
    });
  }, [changesPanelWindowNavigationMode, changesWindowTarget, navigate]);

  useEffect(() => {
    setActivePath(initialPath ?? null);
  }, [initialPath, threadId]);

  useEffect(() => {
    setContentMode(initialMode ?? "preview");
  }, [initialMode, threadId]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = activePath ? `${activePath.split("/").pop()} · Changes` : "Changes";
    }
  }, [activePath]);

  useEffect(() => {
    if (!activeThread && initialPath == null) {
      setActivePath(null);
      setContentMode(initialMode ?? "preview");
    }
  }, [activeThread, initialMode, initialPath, threadId]);

  const latestCheckpointTurnCount = useMemo(
    () => resolveLatestCheckpointTurnCount(activeThread?.turnDiffSummaries ?? []),
    [activeThread?.turnDiffSummaries],
  );

  const handleSelectItem = useCallback((item: DiscoveredFileReference) => {
    setActivePath(item.resolvedPath);
    setContentMode("preview");
  }, []);

  const handleClose = useCallback(() => {
    if (typeof window !== "undefined") {
      window.close();
    }
  }, []);

  return (
    <ChangesBrowser
      title={activeThread?.title ?? "Changes"}
      threadId={activeThread?.id ?? threadId}
      worktreePath={worktreePath}
      messages={activeThread?.messages ?? EMPTY_MESSAGES}
      persistedFileChanges={activeThread?.persistedFileChanges ?? EMPTY_PERSISTED}
      latestCheckpointTurnCount={latestCheckpointTurnCount}
      filesChangedViewType={filesChangedViewType}
      activePath={activePath}
      contentMode={contentMode}
      onSelectItem={handleSelectItem}
      onContentModeChange={setContentMode}
      onClose={handleClose}
      headerShowIcon={false}
      enableBrowserPaneControls
    />
  );
}
