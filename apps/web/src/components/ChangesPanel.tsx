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
import type { DiscoveredFileReference } from "../changesDiscovery";
import type { TurnDiffSummary } from "../types";

const EMPTY_MESSAGES: readonly [] = [];
const EMPTY_PERSISTED: readonly [] = [];

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
  const worktreePath = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  const latestCheckpointTurnCount = useMemo(
    () => resolveLatestCheckpointTurnCount(activeThread?.turnDiffSummaries ?? []),
    [activeThread?.turnDiffSummaries],
  );

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
      const targetThreadId = activeThread?.id ?? routeThreadId;
      if (!targetThreadId || typeof window === "undefined") {
        return;
      }

      setChangesWindowTarget(
        buildChangesWindowTarget({
          threadId: targetThreadId,
          path: item.resolvedPath,
          mode: "preview",
        }),
      );
      window.open(
        buildChangesWindowHref({
          threadId: targetThreadId,
          path: item.resolvedPath,
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
      threadId={activeThread?.id ?? null}
      worktreePath={worktreePath}
      messages={activeThread?.messages ?? EMPTY_MESSAGES}
      persistedFileChanges={activeThread?.persistedFileChanges ?? EMPTY_PERSISTED}
      latestCheckpointTurnCount={latestCheckpointTurnCount}
      filesChangedViewType={filesChangedViewType}
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
