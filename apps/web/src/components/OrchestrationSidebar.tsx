import {
  BotIcon,
  FolderIcon,
  HardHatIcon,
  NetworkIcon,
  PlusIcon,
  SettingsIcon,
  SquarePenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ProjectFavicon } from "./ProjectFavicon";
import { autoAnimate } from "@formkit/auto-animate";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type Ref,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProjectId,
  type DesktopUpdateState,
  type OrchestrationThreadSummary,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { isElectron } from "../env";
import { isTerminalFocused } from "../lib/terminalFocus";
import { cn, isLinuxPlatform, isMacPlatform, newCommandId } from "../lib/utils";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHints,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";

import { useThreadActions } from "../hooks/useThreadActions";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "./ui/sidebar";
import { Badge } from "./ui/badge";
import { useThreadSelectionStore } from "../threadSelectionStore";
import {
  buildCopyThreadIdErrorDescription,
  buildSidebarProgramNotificationGroups,
  filterThreadsByLabels,
  getUniqueLabelsFromThreads,
  getVisibleSidebarThreadIds,
  getVisibleThreadsForProject,
  groupThreadsForOrchestrationMode,
  groupThreadsByLineage,
  resolveAdjacentThreadId,
  isContextMenuPointerDown,
  resolveSelectedOrchestrationSessionRootId,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveSidebarProjectKind,
  resolveCurrentOrchestrationSessionRootId,
  resolveThreadStatusPill,
  getSidebarThreadLabels,
  orderItemsByPreferredIds,
  shouldUseSidebarOrchestrationMode,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  useThreadJumpHintVisibility,
  type SidebarProjectKind,
} from "./Sidebar.logic";
import { OrchestrationSessionSelector } from "./sidebar/OrchestrationSessionSelector";
import { SidebarProjectHeader } from "./sidebar/SidebarProjectHeader";
import {
  LabelFilterMenu,
  ProjectSortMenu,
  SortableProjectItem,
  type SortableProjectHandleProps,
} from "./sidebar/SidebarShared";
import { SidebarBrandHeader } from "./sidebar/SidebarBrandHeader";
import { ProgramNotificationsPanel } from "./sidebar/ProgramNotificationsPanel";
import { useOrchestrationProjectBuckets } from "./sidebar/useOrchestrationProjectBuckets";
import {
  buildPrStatusIndicator,
  buildTerminalStatusIndicator,
  type SidebarThreadPr,
  SidebarThreadRow,
  ThreadStatusLabel,
} from "./sidebar/SidebarThreadRow";
import { SidebarUpdatePill } from "./sidebar/SidebarUpdatePill";
import { useSidebarProjectController } from "./sidebar/useSidebarProjectController";
import { buildSidebarWakeSummaryByThreadId } from "./sidebar/sidebarWakeSummary";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import type { Project, Thread } from "../types";
import { resolveThreadRouteTarget } from "../lib/sidebarWindow";
import {
  buildOrchestrationModeRowDescriptor,
  buildOrchestrationSessionCatalog,
  filterProjectThreadsForOrchestrationMode,
} from "../lib/orchestrationMode";
import { getThreadOperationsIndicator, getWorkerLineageIndicator } from "../lib/workerLineage";
import {
  orchestrationProjectThreadsQueryOptions,
  orchestrationSessionThreadsQueryOptions,
} from "../lib/orchestrationReactQuery";
import {
  createNewOrchestrationSession,
  reactivateOrchestrationSession,
} from "./sidebar/orchestrationModeActions";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const EMPTY_LABEL_ARRAY: readonly string[] = [];
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

type SidebarThreadSnapshot = Pick<
  Thread,
  | "activities"
  | "archivedAt"
  | "branch"
  | "createdAt"
  | "error"
  | "id"
  | "interactionMode"
  | "latestTurn"
  | "labels"
  | "modelSelection"
  | "orchestratorProjectId"
  | "orchestratorThreadId"
  | "parentThreadId"
  | "projectId"
  | "proposedPlans"
  | "session"
  | "spawnRole"
  | "spawnedBy"
  | "title"
  | "updatedAt"
  | "workflowId"
  | "worktreePath"
  | "sessionWorkerThreadCount"
> & {
  lastVisitedAt?: string | undefined;
  latestUserMessageAt: string | null;
};

type SidebarProjectSnapshot = Project & {
  expanded: boolean;
};

const sidebarThreadSnapshotCache = new WeakMap<
  Thread,
  { lastVisitedAt?: string | undefined; snapshot: SidebarThreadSnapshot }
>();

function getLatestUserMessageAt(thread: Thread): string | null {
  let latestUserMessageAt: string | null = null;

  for (const message of thread.messages) {
    if (message.role !== "user") {
      continue;
    }
    if (latestUserMessageAt === null || message.createdAt > latestUserMessageAt) {
      latestUserMessageAt = message.createdAt;
    }
  }

  return latestUserMessageAt;
}

function toSidebarThreadSnapshot(
  thread: Thread,
  lastVisitedAt: string | undefined,
): SidebarThreadSnapshot {
  const cached = sidebarThreadSnapshotCache.get(thread);
  if (cached && cached.lastVisitedAt === lastVisitedAt) {
    return cached.snapshot;
  }

  const snapshot: SidebarThreadSnapshot = {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: thread.session,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    error: thread.error,
    latestTurn: thread.latestTurn,
    labels: thread.labels ? [...thread.labels] : undefined,
    modelSelection: thread.modelSelection,
    lastVisitedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    activities: thread.activities,
    proposedPlans: thread.proposedPlans,
    latestUserMessageAt: getLatestUserMessageAt(thread),
    orchestratorProjectId: thread.orchestratorProjectId,
    orchestratorThreadId: thread.orchestratorThreadId,
    parentThreadId: thread.parentThreadId,
    spawnRole: thread.spawnRole,
    spawnedBy: thread.spawnedBy,
    workflowId: thread.workflowId,
    sessionWorkerThreadCount: thread.sessionWorkerThreadCount,
  };
  sidebarThreadSnapshotCache.set(thread, { lastVisitedAt, snapshot });
  return snapshot;
}

function toSidebarThreadSummarySnapshot(
  thread: OrchestrationThreadSummary,
  lastVisitedAt: string | undefined,
): SidebarThreadSnapshot {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session:
      thread.session === null
        ? null
        : {
            provider: thread.session.providerName === "claudeAgent" ? "claudeAgent" : "codex",
            status:
              thread.session.status === "running"
                ? "running"
                : thread.session.status === "starting"
                  ? "connecting"
                  : thread.session.status === "ready"
                    ? "ready"
                    : thread.session.status === "error"
                      ? "error"
                      : "closed",
            orchestrationStatus: thread.session.status,
            activeTurnId: thread.session.activeTurnId ?? undefined,
            createdAt: thread.session.updatedAt,
            updatedAt: thread.session.updatedAt,
            ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
          },
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    error: null,
    latestTurn: thread.latestTurn,
    labels: thread.labels ? [...thread.labels] : undefined,
    modelSelection: thread.modelSelection,
    lastVisitedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    activities: [],
    proposedPlans: [],
    latestUserMessageAt: null,
    orchestratorProjectId: thread.orchestratorProjectId,
    orchestratorThreadId: thread.orchestratorThreadId,
    parentThreadId: thread.parentThreadId,
    spawnRole: thread.spawnRole,
    spawnedBy: thread.spawnedBy,
    workflowId: thread.workflowId,
    sessionWorkerThreadCount: thread.sessionWorkerThreadCount,
  };
}

function mergeSidebarSnapshotsFromStoreAndSummary(input: {
  storeThreads: readonly SidebarThreadSnapshot[];
  threadSummaries: readonly OrchestrationThreadSummary[];
  threadLastVisitedAtById: Record<string, string>;
}): SidebarThreadSnapshot[] {
  const mergedById = new Map<ThreadId, SidebarThreadSnapshot>();

  for (const threadSummary of input.threadSummaries) {
    mergedById.set(
      threadSummary.id,
      toSidebarThreadSummarySnapshot(
        threadSummary,
        input.threadLastVisitedAtById[threadSummary.id],
      ),
    );
  }

  for (const storeThread of input.storeThreads) {
    mergedById.set(storeThread.id, storeThread);
  }

  return [...mergedById.values()];
}

export default function OrchestrationSidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const projects = useStore((store) => store.projects);
  const programs = useStore((store) => store.programs ?? []);
  const programNotifications = useStore((store) => store.programNotifications ?? []);
  const serverThreads = useStore((store) => store.threads);
  const orchestratorWakeItems = useStore((store) => store.orchestratorWakeItems);
  const { projectExpandedById, projectOrder, threadLastVisitedAtById, labelFiltersByProject } =
    useUiStateStore(
      useShallow((store) => ({
        projectExpandedById: store.projectExpandedById,
        projectOrder: store.projectOrder,
        threadLastVisitedAtById: store.threadLastVisitedAtById,
        labelFiltersByProject: store.labelFiltersByProject,
      })),
    );
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const markProjectOrchestratorCwd = useUiStateStore((store) => store.markProjectOrchestratorCwd);
  const toggleProject = useUiStateStore((store) => store.toggleProject);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const toggleProjectLabelFilter = useUiStateStore((store) => store.toggleProjectLabelFilter);
  const clearProjectLabelFilters = useUiStateStore((store) => store.clearProjectLabelFilters);
  const orchestratorProjectCwds = useUiStateStore((store) => store.orchestratorProjectCwds);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const projectDraftThreadIdByProjectId = useComposerDraftStore(
    (store) => store.projectDraftThreadIdByProjectId,
  );
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const isStandaloneWindow = mode === "standalone";
  const appSettings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { handleNewThread } = useHandleNewThread();
  const { archiveThread, deleteThread } = useThreadActions();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadId, setConfirmingArchiveThreadId] = useState<ThreadId | null>(null);
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<ThreadId, HTMLButtonElement>());
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const selectedThreadIds = useThreadSelectionStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);
  const platform = navigator.platform;
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop;
  const defaultThreadEnvMode = appSettings.defaultThreadEnvMode;
  const sidebarThreadSortOrder = appSettings.sidebarThreadSortOrder;
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: (project) => project.id,
    });
  }, [projectOrder, projects]);
  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(
    () =>
      orderedProjects.map((project) => ({
        ...project,
        expanded: projectExpandedById[project.id] ?? true,
      })),
    [orderedProjects, projectExpandedById],
  );
  const threads = useMemo(
    () =>
      serverThreads.map((thread) =>
        toSidebarThreadSnapshot(thread, threadLastVisitedAtById[thread.id]),
      ),
    [serverThreads, threadLastVisitedAtById],
  );
  const { bucketProjectIdByProjectId, visibleRegularProjectIds } = useOrchestrationProjectBuckets({
    projects: sidebarProjects,
    orchestratorProjectCwds,
    orchestrationModeEnabled: appSettings.sidebarOrchestrationModeEnabled,
    groupWorktreesWithParentProject: appSettings.sidebarGroupWorktreesWithParentProject,
  });
  const orchestrationProjectThreadQueryProjectIds = useMemo(
    () =>
      sidebarProjects
        .filter((project) => {
          const isOrchestratorProject =
            resolveSidebarProjectKind({ project, orchestratorProjectCwds }) === "orchestrator";
          const isActiveProject =
            routeThreadId !== null &&
            (serverThreads.some(
              (thread) => thread.projectId === project.id && thread.id === routeThreadId,
            ) ||
              projectDraftThreadIdByProjectId[project.id] === routeThreadId);
          return (
            appSettings.sidebarOrchestrationModeEnabled &&
            isOrchestratorProject &&
            (project.expanded || isActiveProject)
          );
        })
        .map((project) => project.id)
        .filter((projectId, index, projectIds) => projectIds.indexOf(projectId) === index),
    [
      appSettings.sidebarOrchestrationModeEnabled,
      orchestratorProjectCwds,
      projectDraftThreadIdByProjectId,
      routeThreadId,
      serverThreads,
      sidebarProjects,
    ],
  );
  const orchestrationProjectThreadQueries = useQueries({
    queries: orchestrationProjectThreadQueryProjectIds.map((projectId) =>
      orchestrationProjectThreadsQueryOptions({
        projectId,
        includeArchived: true,
      }),
    ),
  });
  const orchestrationProjectCatalogSummariesByProjectId = useMemo(() => {
    const catalogByProjectId = new Map<ProjectId, OrchestrationThreadSummary[]>();
    for (const [index, projectId] of orchestrationProjectThreadQueryProjectIds.entries()) {
      const catalog = orchestrationProjectThreadQueries[index]?.data;
      if (!catalog) {
        continue;
      }
      catalogByProjectId.set(projectId, [...catalog]);
    }
    return catalogByProjectId;
  }, [orchestrationProjectThreadQueries, orchestrationProjectThreadQueryProjectIds]);
  const orchestrationRootCatalogByProjectId = useMemo(() => {
    const catalogByProjectId = new Map<ProjectId, SidebarThreadSnapshot[]>();
    for (const [projectId, catalog] of orchestrationProjectCatalogSummariesByProjectId) {
      catalogByProjectId.set(
        projectId,
        mergeSidebarSnapshotsFromStoreAndSummary({
          storeThreads: threads.filter((thread) => thread.projectId === projectId),
          threadSummaries: catalog,
          threadLastVisitedAtById,
        }),
      );
    }
    return catalogByProjectId;
  }, [orchestrationProjectCatalogSummariesByProjectId, threadLastVisitedAtById, threads]);
  const orchestrationSessionOptionsByProjectId = useMemo(() => {
    const optionsByProjectId = new Map<
      ProjectId,
      ReturnType<typeof buildOrchestrationSessionCatalog>
    >();
    for (const [projectId, catalog] of orchestrationRootCatalogByProjectId) {
      optionsByProjectId.set(projectId, buildOrchestrationSessionCatalog({ threads: catalog }));
    }
    return optionsByProjectId;
  }, [orchestrationRootCatalogByProjectId]);
  const orchestrationRootThreadsByProjectId = useMemo(() => {
    const rootsByProjectId = new Map<ProjectId, SidebarThreadSnapshot[]>();
    for (const [projectId, catalog] of orchestrationRootCatalogByProjectId) {
      const rootIds = new Set(
        (orchestrationSessionOptionsByProjectId.get(projectId) ?? []).map(
          (entry) => entry.rootThreadId,
        ),
      );
      rootsByProjectId.set(
        projectId,
        catalog.filter((thread) => rootIds.has(thread.id)),
      );
    }
    return rootsByProjectId;
  }, [orchestrationRootCatalogByProjectId, orchestrationSessionOptionsByProjectId]);
  const threadsForOrchestrationRootResolution = useMemo(() => {
    const threadsById = new Map<ThreadId, SidebarThreadSnapshot>();

    for (const thread of threads) {
      threadsById.set(thread.id, thread);
    }
    for (const catalog of orchestrationRootCatalogByProjectId.values()) {
      for (const thread of catalog) {
        threadsById.set(thread.id, thread);
      }
    }

    return [...threadsById.values()];
  }, [orchestrationRootCatalogByProjectId, threads]);
  const derivedSelectedOrchestrationRootByProjectId = useMemo(() => {
    const selectedRootByProjectId = new Map<ProjectId, ThreadId | null>();
    for (const project of sidebarProjects) {
      const projectKind = resolveSidebarProjectKind({ project, orchestratorProjectCwds });
      const rootThreads = orchestrationRootThreadsByProjectId.get(project.id) ?? [];
      if (projectKind !== "orchestrator" || rootThreads.length === 0) {
        selectedRootByProjectId.set(project.id, null);
        continue;
      }
      selectedRootByProjectId.set(
        project.id,
        resolveSelectedOrchestrationSessionRootId({
          routeThreadId,
          storedSelectedSessionRootId: project.currentSessionRootThreadId ?? null,
          projectRootThreads: rootThreads,
          threadsForResolution: threadsForOrchestrationRootResolution,
        }),
      );
    }
    return selectedRootByProjectId;
  }, [
    orchestratorProjectCwds,
    orchestrationRootThreadsByProjectId,
    routeThreadId,
    sidebarProjects,
    threadsForOrchestrationRootResolution,
  ]);
  const orchestrationSessionThreadQueryTargets = useMemo(
    () =>
      sidebarProjects
        .map((project) => {
          const projectKind = resolveSidebarProjectKind({ project, orchestratorProjectCwds });
          const selectedRootThreadId =
            derivedSelectedOrchestrationRootByProjectId.get(project.id) ?? null;
          const shouldLoadSession =
            appSettings.sidebarOrchestrationModeEnabled &&
            projectKind === "orchestrator" &&
            selectedRootThreadId !== null;
          return shouldLoadSession && selectedRootThreadId
            ? { projectId: project.id, rootThreadId: selectedRootThreadId }
            : null;
        })
        .filter(
          (target): target is { projectId: ProjectId; rootThreadId: ThreadId } => target !== null,
        ),
    [
      appSettings.sidebarOrchestrationModeEnabled,
      derivedSelectedOrchestrationRootByProjectId,
      orchestratorProjectCwds,
      sidebarProjects,
    ],
  );
  const orchestrationSessionThreadQueryRootIds = useMemo(
    () => [...new Set(orchestrationSessionThreadQueryTargets.map((target) => target.rootThreadId))],
    [orchestrationSessionThreadQueryTargets],
  );
  const orchestrationSessionThreadQueries = useQueries({
    queries: orchestrationSessionThreadQueryRootIds.map((rootThreadId) =>
      orchestrationSessionThreadsQueryOptions({
        rootThreadId,
        includeArchived: true,
      }),
    ),
  });
  const orchestrationSessionCatalogSummariesByRootId = useMemo(() => {
    const catalogByRootId = new Map<ThreadId, OrchestrationThreadSummary[]>();
    for (const [index, rootThreadId] of orchestrationSessionThreadQueryRootIds.entries()) {
      const catalog = orchestrationSessionThreadQueries[index]?.data;
      if (!catalog) {
        continue;
      }
      catalogByRootId.set(rootThreadId, [...catalog]);
    }
    return catalogByRootId;
  }, [orchestrationSessionThreadQueries, orchestrationSessionThreadQueryRootIds]);
  const orchestrationSessionCatalogByRootId = useMemo(() => {
    const catalogByRootId = new Map<ThreadId, SidebarThreadSnapshot[]>();
    for (const [rootThreadId, catalog] of orchestrationSessionCatalogSummariesByRootId) {
      const summaryIds = new Set(catalog.map((thread) => thread.id));
      catalogByRootId.set(
        rootThreadId,
        mergeSidebarSnapshotsFromStoreAndSummary({
          storeThreads: threads.filter((thread) => summaryIds.has(thread.id)),
          threadSummaries: catalog,
          threadLastVisitedAtById,
        }),
      );
    }
    return catalogByRootId;
  }, [orchestrationSessionCatalogSummariesByRootId, threadLastVisitedAtById, threads]);
  const threadsForOrchestrationResolution = useMemo(() => {
    const threadsById = new Map<ThreadId, SidebarThreadSnapshot>();

    for (const thread of threadsForOrchestrationRootResolution) {
      threadsById.set(thread.id, thread);
    }
    for (const catalog of orchestrationSessionCatalogByRootId.values()) {
      for (const thread of catalog) {
        threadsById.set(thread.id, thread);
      }
    }

    return [...threadsById.values()];
  }, [orchestrationSessionCatalogByRootId, threadsForOrchestrationRootResolution]);
  const orchestrationProjectCatalogStateByProjectId = useMemo(() => {
    const stateByProjectId = new Map<
      ProjectId,
      {
        isLoading: boolean;
        errorMessage: string | null;
      }
    >();
    for (const [index, projectId] of orchestrationProjectThreadQueryProjectIds.entries()) {
      const query = orchestrationProjectThreadQueries[index];
      stateByProjectId.set(projectId, {
        isLoading: query?.isLoading ?? false,
        errorMessage: query?.error instanceof Error ? query.error.message : null,
      });
    }
    return stateByProjectId;
  }, [orchestrationProjectThreadQueries, orchestrationProjectThreadQueryProjectIds]);
  const orchestrationSessionCatalogStateByProjectId = useMemo(() => {
    const stateByProjectId = new Map<
      ProjectId,
      {
        isLoading: boolean;
        errorMessage: string | null;
      }
    >();
    const sessionQueryByRootId = new Map<
      ThreadId,
      (typeof orchestrationSessionThreadQueries)[number]
    >();
    for (const [index, rootThreadId] of orchestrationSessionThreadQueryRootIds.entries()) {
      const query = orchestrationSessionThreadQueries[index];
      if (query) {
        sessionQueryByRootId.set(rootThreadId, query);
      }
    }
    for (const target of orchestrationSessionThreadQueryTargets) {
      const query = sessionQueryByRootId.get(target.rootThreadId);
      stateByProjectId.set(target.projectId, {
        isLoading: query?.isLoading ?? false,
        errorMessage: query?.error instanceof Error ? query.error.message : null,
      });
    }
    return stateByProjectId;
  }, [
    orchestrationSessionThreadQueries,
    orchestrationSessionThreadQueryRootIds,
    orchestrationSessionThreadQueryTargets,
  ]);
  const orchestratorWakeSummaryByThreadId = useMemo(
    () => buildSidebarWakeSummaryByThreadId(orchestratorWakeItems),
    [orchestratorWakeItems],
  );
  const programNotificationGroups = useMemo(
    () => buildSidebarProgramNotificationGroups({ programs, notifications: programNotifications }),
    [programs, programNotifications],
  );
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const routeTerminalOpen = routeThreadId
    ? selectThreadTerminalState(terminalStateByThreadId, routeThreadId).terminalOpen
    : false;
  const sidebarShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: routeTerminalOpen,
      },
    }),
    [platform, routeTerminalOpen],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, SidebarThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const dismissMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  const navigateToSelectedThread = useCallback(
    async (threadId: ThreadId) => {
      dismissMobileSidebar();
      await navigate(resolveThreadRouteTarget(pathname, threadId));
    },
    [dismissMobileSidebar, navigate, pathname],
  );

  const persistCurrentOrchestrationSessionRoot = useCallback(
    async (projectId: ProjectId, rootThreadId: ThreadId | null) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        currentSessionRootThreadId: rootThreadId,
      });
    },
    [],
  );

  const handleSelectOrchestrationSession = useCallback(
    async (projectId: ProjectId, targetRootThreadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Unable to switch orchestration session",
          description: "The browser connection to the T3 control plane is not ready.",
        });
        return;
      }

      try {
        const projectRootThreads = await queryClient.fetchQuery({
          ...orchestrationProjectThreadsQueryOptions({
            projectId,
            includeArchived: true,
          }),
          staleTime: 0,
        });
        const targetRootThread = projectRootThreads.find(
          (thread) => thread.id === targetRootThreadId,
        );
        if (!targetRootThread) {
          await persistCurrentOrchestrationSessionRoot(projectId, targetRootThreadId);
          await navigateToSelectedThread(targetRootThreadId);
          return;
        }

        const activeRootThreadId =
          [...projectRootThreads]
            .filter((thread) => thread.archivedAt === null)
            .toSorted(
              (left, right) =>
                right.updatedAt.localeCompare(left.updatedAt) ||
                right.createdAt.localeCompare(left.createdAt),
            )[0]?.id ?? null;

        if (activeRootThreadId === targetRootThreadId && targetRootThread.archivedAt === null) {
          await persistCurrentOrchestrationSessionRoot(projectId, targetRootThreadId);
          await navigateToSelectedThread(targetRootThreadId);
          return;
        }

        const activeSessionThreads =
          activeRootThreadId === null
            ? []
            : await queryClient.fetchQuery({
                ...orchestrationSessionThreadsQueryOptions({
                  rootThreadId: activeRootThreadId,
                  includeArchived: true,
                }),
                staleTime: 0,
              });
        const targetSessionThreads = await queryClient.fetchQuery({
          ...orchestrationSessionThreadsQueryOptions({
            rootThreadId: targetRootThreadId,
            includeArchived: true,
          }),
          staleTime: 0,
        });

        await reactivateOrchestrationSession({
          api,
          queryClient,
          projectId,
          activeRootThreadId,
          targetRootThreadId,
          activeSessionThreads,
          targetSessionThreads,
          projectRootThreads,
          syncServerReadModel: useStore.getState().syncServerReadModel,
          navigateToThread: navigateToSelectedThread,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to switch orchestration session",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [navigateToSelectedThread, persistCurrentOrchestrationSessionRoot, queryClient],
  );

  const handleCreateOrchestrationSession = useCallback(
    async (projectId: ProjectId) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      const project = projects.find((candidateProject) => candidateProject.id === projectId);
      if (!project) {
        return;
      }

      try {
        await createNewOrchestrationSession({
          api,
          queryClient,
          projectId,
          projectName: project.name,
          projectModelSelection: project.defaultModelSelection ?? {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          syncServerReadModel: useStore.getState().syncServerReadModel,
          navigateToThread: navigateToSelectedThread,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to create orchestration session",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [navigateToSelectedThread, projects, queryClient],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error, ctx) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: buildCopyThreadIdErrorDescription({
          threadId: ctx.threadId,
          errorMessage: error instanceof Error ? error.message : "An error occurred.",
        }),
      });
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path?: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const {
    addProjectError,
    addingProject,
    canAddProject,
    isAddingProject,
    isPickingFolder,
    newCwd,
    newProjectKind,
    newOrchestratorName,
    addProjectInputRef,
    setAddingProject,
    setAddProjectError,
    setNewCwd,
    setNewOrchestratorName,
    handleAddProject,
    handlePickFolder,
    handleStartAddProject,
    handleProjectContextMenu,
    handleSidebarNewThread,
    openOrCreateOrchestratorSession,
    attemptArchiveThread,
  } = useSidebarProjectController({
    projects,
    threads: serverThreads,
    orchestratorProjectCwds,
    sidebarThreadSortOrder,
    defaultThreadEnvMode,
    defaultNewThreadEnvMode: appSettings.defaultThreadEnvMode,
    shouldBrowseForProjectImmediately,
    navigateToSelectedThread: async (threadId) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      await navigate(resolveThreadRouteTarget(pathname, threadId));
    },
    handleNewThread,
    archiveThread,
    getDraftThreadByProjectId,
    clearComposerDraftForThread,
    clearProjectDraftThreadId,
    markProjectOrchestratorCwd,
    copyPathToClipboard: (value, data) => copyPathToClipboard(value, data ?? {}),
    persistCurrentOrchestrationSessionRoot: async (projectId, rootThreadId) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        currentSessionRootThreadId: rootThreadId,
      });
    },
  });
  const shouldShowAddProjectForm =
    addingProject && (!shouldBrowseForProjectImmediately || newProjectKind !== "project");
  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const threadWorkspacePath =
        thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "mark-unread", label: "Mark unread" },
          { id: "copy-path", label: "Copy Path" },
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to copy.",
          });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(threadId, { threadId });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadId);
    },
    [
      appSettings.confirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      markThreadUnread,
      projectCwdById,
      threads,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const ids = [...selectedThreadIds];
      if (ids.length === 0) return;
      const count = ids.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const id of ids) {
          const thread = threads.find((candidate) => candidate.id === id);
          markThreadUnread(id, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedIds = new Set<ThreadId>(ids);
      for (const id of ids) {
        await deleteThread(id, { deletedThreadIds: deletedIds });
      }
      removeFromSelection(ids);
    },
    [
      appSettings.confirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadIds,
      threads,
    ],
  );

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadId);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadId, orderedProjectThreadIds);
        return;
      }

      // Plain click — clear selection, set anchor for future shift-clicks, and navigate
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      void navigateToSelectedThread(threadId);
    },
    [
      clearSelection,
      navigateToSelectedThread,
      rangeSelectTo,
      selectedThreadIds.size,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const navigateToThread = useCallback(
    (threadId: ThreadId) => {
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      void navigateToSelectedThread(threadId);
    },
    [clearSelection, navigateToSelectedThread, selectedThreadIds.size, setSelectionAnchor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.id === active.id);
      const overProject = sidebarProjects.find((project) => project.id === over.id);
      if (!activeProject || !overProject) return;
      reorderProjects(activeProject.id, overProject.id);
    },
    [appSettings.sidebarProjectSortOrder, reorderProjects, sidebarProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [appSettings.sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  const handleProjectTitlePointerDownCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        // Keep context-menu gestures from arming the sortable drag sensor.
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [],
  );

  const visibleThreads = useMemo(
    () => threads.filter((thread) => thread.archivedAt === null),
    [threads],
  );
  const currentOrchestrationSessionRootIds = useMemo(() => {
    const rootIds = new Set<ThreadId>();
    for (const project of sidebarProjects) {
      if (resolveSidebarProjectKind({ project, orchestratorProjectCwds }) !== "orchestrator") {
        continue;
      }
      const rootThreads = orchestrationRootThreadsByProjectId.get(project.id) ?? [];
      const rootThreadId = resolveCurrentOrchestrationSessionRootId({
        storedCurrentSessionRootId: project.currentSessionRootThreadId ?? null,
        projectRootThreads: rootThreads,
      });
      if (rootThreadId !== null) {
        rootIds.add(rootThreadId);
      }
    }
    return rootIds;
  }, [orchestratorProjectCwds, orchestrationRootThreadsByProjectId, sidebarProjects]);
  const visibleThreadsWithSelectedSessions = useMemo(() => {
    const threadsById = new Map<ThreadId, SidebarThreadSnapshot>();

    for (const thread of visibleThreads) {
      threadsById.set(thread.id, thread);
    }
    for (const rootThreadId of currentOrchestrationSessionRootIds) {
      const sessionThreads = orchestrationSessionCatalogByRootId.get(rootThreadId) ?? [];
      for (const thread of sessionThreads) {
        if (thread.archivedAt === null) {
          threadsById.set(thread.id, thread);
        }
      }
    }

    return [...threadsById.values()];
  }, [currentOrchestrationSessionRootIds, orchestrationSessionCatalogByRootId, visibleThreads]);
  const visibleSidebarProjects = useMemo(
    () =>
      sidebarProjects.filter((project) => {
        const projectKind = resolveSidebarProjectKind({ project, orchestratorProjectCwds });
        return (
          projectKind === "executive" ||
          projectKind === "orchestrator" ||
          visibleRegularProjectIds.has(project.id)
        );
      }),
    [orchestratorProjectCwds, sidebarProjects, visibleRegularProjectIds],
  );
  const bucketedVisibleThreadsForSorting = useMemo(
    () =>
      visibleThreadsWithSelectedSessions.map((thread) => ({
        ...thread,
        projectId: bucketProjectIdByProjectId.get(thread.projectId) ?? thread.projectId,
      })),
    [bucketProjectIdByProjectId, visibleThreadsWithSelectedSessions],
  );
  const sortedProjects = useMemo(
    () =>
      sortProjectsForSidebar(
        visibleSidebarProjects,
        bucketedVisibleThreadsForSorting,
        appSettings.sidebarProjectSortOrder,
      ),
    [appSettings.sidebarProjectSortOrder, bucketedVisibleThreadsForSorting, visibleSidebarProjects],
  );
  const isManualProjectSorting = appSettings.sidebarProjectSortOrder === "manual";
  const renderedProjects = useMemo(
    () =>
      sortedProjects.map((project) => {
        const projectKind = resolveSidebarProjectKind({ project, orchestratorProjectCwds });
        const isOrchestratorProject = projectKind === "orchestrator";
        const projectThreads = sortThreadsForSidebar(
          visibleThreadsWithSelectedSessions.filter((thread) =>
            isOrchestratorProject
              ? thread.projectId === project.id
              : (bucketProjectIdByProjectId.get(thread.projectId) ?? thread.projectId) ===
                project.id,
          ),
          appSettings.sidebarThreadSortOrder,
        );
        const selectedOrchestrationSessionRootId =
          derivedSelectedOrchestrationRootByProjectId.get(project.id) ?? null;
        const orchestrationSessionOptions =
          orchestrationSessionOptionsByProjectId.get(project.id) ?? [];
        const orchestrationSessionThreads =
          selectedOrchestrationSessionRootId === null
            ? null
            : (orchestrationSessionCatalogByRootId.get(selectedOrchestrationSessionRootId) ?? null);
        const orchestrationModeLoading =
          orchestrationProjectCatalogStateByProjectId.get(project.id)?.isLoading === true ||
          orchestrationSessionCatalogStateByProjectId.get(project.id)?.isLoading === true;
        const orchestrationModeErrorMessage =
          orchestrationProjectCatalogStateByProjectId.get(project.id)?.errorMessage ??
          orchestrationSessionCatalogStateByProjectId.get(project.id)?.errorMessage ??
          null;
        const usesOrchestrationMode =
          orchestrationModeErrorMessage === null &&
          orchestrationSessionThreads !== null &&
          shouldUseSidebarOrchestrationMode({
            projectKind,
            settingEnabled: appSettings.sidebarOrchestrationModeEnabled,
            selectedSessionRootId: selectedOrchestrationSessionRootId,
          });
        const usesProjectBucketMode =
          !isOrchestratorProject && appSettings.sidebarOrchestrationModeEnabled;
        const projectThreadsForDisplay = usesProjectBucketMode
          ? filterProjectThreadsForOrchestrationMode({
              threads: projectThreads,
              selectedSessionRootIds: currentOrchestrationSessionRootIds,
              threadsForResolution: threadsForOrchestrationResolution,
              projects,
              workerActivityFilter: appSettings.sidebarWorkerActivityFilter,
              workerLineageFilter: appSettings.sidebarWorkerLineageFilter,
              workerVisibilityScope: appSettings.sidebarWorkerVisibilityScope,
            })
          : projectThreads;
        const displayThreads =
          usesOrchestrationMode && orchestrationSessionThreads !== null
            ? sortThreadsForSidebar(orchestrationSessionThreads, appSettings.sidebarThreadSortOrder)
            : projectThreadsForDisplay;
        const threadStatuses = new Map(
          displayThreads.map((thread) => [
            thread.id,
            resolveThreadStatusPill({
              thread,
              hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
              hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
            }),
          ]),
        );
        const projectStatus = resolveProjectStatusIndicator(
          displayThreads.map((thread) => threadStatuses.get(thread.id) ?? null),
        );
        const activeThreadId = routeThreadId ?? undefined;
        const availableProjectLabels = getUniqueLabelsFromThreads(displayThreads);
        const activeProjectLabelFilters = labelFiltersByProject[project.id];
        const filteredProjectThreads =
          activeProjectLabelFilters && activeProjectLabelFilters.length > 0
            ? (() => {
                const matched = filterThreadsByLabels(displayThreads, activeProjectLabelFilters);
                if (
                  activeThreadId !== undefined &&
                  !matched.some((thread) => thread.id === activeThreadId)
                ) {
                  const pinned = displayThreads.find((thread) => thread.id === activeThreadId);
                  return pinned ? [...matched, pinned] : matched;
                }
                return matched;
              })()
            : displayThreads;
        const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
        const pinnedCollapsedThread =
          !project.expanded && activeThreadId
            ? (displayThreads.find((thread) => thread.id === activeThreadId) ?? null)
            : null;
        const shouldShowThreadPanel =
          !isOrchestratorProject && (project.expanded || pinnedCollapsedThread !== null);
        const {
          hasHiddenThreads,
          hiddenThreads,
          visibleThreads: visibleProjectThreads,
        } = getVisibleThreadsForProject({
          threads: filteredProjectThreads,
          activeThreadId,
          allowActiveThreadsInFold: appSettings.allowActiveThreadsInFold,
          isThreadListExpanded,
          previewLimit: appSettings.maxProjectThreadsBeforeFolding,
        });
        const hiddenThreadStatus = resolveProjectStatusIndicator(
          hiddenThreads.map((thread) => threadStatuses.get(thread.id) ?? null),
        );
        const orderedProjectThreadIds = filteredProjectThreads.map((thread) => thread.id);
        const baseRenderedThreads = pinnedCollapsedThread
          ? [pinnedCollapsedThread]
          : visibleProjectThreads;
        const orchestrationModeGroups = usesOrchestrationMode
          ? groupThreadsForOrchestrationMode({
              threads: baseRenderedThreads,
              projects,
              sortOrder: appSettings.sidebarThreadSortOrder,
            })
          : [];
        const renderedThreads = baseRenderedThreads;
        const showEmptyThreadState = project.expanded && filteredProjectThreads.length === 0;
        const showOrchestrationSessionEmptyState =
          usesOrchestrationMode &&
          project.expanded &&
          selectedOrchestrationSessionRootId !== null &&
          filteredProjectThreads.every(
            (thread) => thread.id === selectedOrchestrationSessionRootId,
          );
        const { groups: lineageGroups, ungrouped: ungroupedThreads } = usesProjectBucketMode
          ? { groups: [], ungrouped: renderedThreads }
          : groupThreadsByLineage(renderedThreads);

        return {
          availableProjectLabels,
          activeProjectLabelFilters: activeProjectLabelFilters ?? null,
          hasHiddenThreads,
          hiddenThreadStatus,
          isOrchestratorProject,
          lineageGroups,
          orchestrationModeErrorMessage,
          orchestrationModeGroups,
          orchestrationModeLoading,
          orchestrationSessionOptions,
          orderedProjectThreadIds,
          project,
          projectStatus,
          projectThreads,
          renderedThreads,
          selectedOrchestrationSessionRootId,
          showEmptyThreadState,
          showOrchestrationSessionEmptyState,
          shouldShowThreadPanel,
          isThreadListExpanded,
          threadStatuses,
          ungroupedThreads,
          usesProjectBucketMode,
          usesOrchestrationMode,
        };
      }),
    [
      appSettings.allowActiveThreadsInFold,
      appSettings.sidebarOrchestrationModeEnabled,
      appSettings.sidebarWorkerActivityFilter,
      appSettings.sidebarWorkerLineageFilter,
      appSettings.sidebarWorkerVisibilityScope,
      bucketProjectIdByProjectId,
      currentOrchestrationSessionRootIds,
      appSettings.maxProjectThreadsBeforeFolding,
      appSettings.sidebarThreadSortOrder,
      derivedSelectedOrchestrationRootByProjectId,
      expandedThreadListsByProject,
      labelFiltersByProject,
      orchestratorProjectCwds,
      orchestrationProjectCatalogStateByProjectId,
      orchestrationSessionCatalogByRootId,
      orchestrationSessionCatalogStateByProjectId,
      orchestrationSessionOptionsByProjectId,
      projects,
      routeThreadId,
      sortedProjects,
      threadsForOrchestrationResolution,
      visibleThreadsWithSelectedSessions,
    ],
  );
  const executiveRenderedProjects = useMemo(
    () =>
      renderedProjects.filter(
        (renderedProject) =>
          resolveSidebarProjectKind({
            project: renderedProject.project,
            orchestratorProjectCwds,
          }) === "executive",
      ),
    [orchestratorProjectCwds, renderedProjects],
  );
  const orchestratorRenderedProjects = useMemo(
    () =>
      renderedProjects.filter(
        (renderedProject) =>
          resolveSidebarProjectKind({
            project: renderedProject.project,
            orchestratorProjectCwds,
          }) === "orchestrator",
      ),
    [orchestratorProjectCwds, renderedProjects],
  );
  const regularRenderedProjects = useMemo(
    () =>
      renderedProjects.filter(
        (renderedProject) =>
          resolveSidebarProjectKind({
            project: renderedProject.project,
            orchestratorProjectCwds,
          }) === "project",
      ),
    [orchestratorProjectCwds, renderedProjects],
  );
  const orderedRenderedProjects = useMemo(
    () => [
      ...executiveRenderedProjects,
      ...orchestratorRenderedProjects,
      ...regularRenderedProjects,
    ],
    [executiveRenderedProjects, orchestratorRenderedProjects, regularRenderedProjects],
  );
  const visibleSidebarThreadIds = useMemo(
    () => getVisibleSidebarThreadIds(orderedRenderedProjects),
    [orderedRenderedProjects],
  );
  const threadJumpCommandById = useMemo(() => {
    const mapping = new Map<ThreadId, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadId] of visibleSidebarThreadIds.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadId, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadIds]);
  const threadJumpThreadIds = useMemo(
    () => [...threadJumpCommandById.keys()],
    [threadJumpCommandById],
  );
  const threadJumpLabelById = useMemo(() => {
    const mapping = new Map<ThreadId, string>();
    for (const [threadId, command] of threadJumpCommandById) {
      const label = shortcutLabelForCommand(keybindings, command, sidebarShortcutLabelOptions);
      if (label) {
        mapping.set(threadId, label);
      }
    }
    return mapping;
  }, [keybindings, sidebarShortcutLabelOptions, threadJumpCommandById]);
  const orderedSidebarThreadIds = visibleSidebarThreadIds;

  useEffect(() => {
    const getShortcutContext = () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeTerminalOpen,
    });

    const onWindowKeyDown = (event: KeyboardEvent) => {
      updateThreadJumpHintsVisibility(
        shouldShowThreadJumpHints(event, keybindings, {
          platform,
          context: getShortcutContext(),
        }),
      );

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: getShortcutContext(),
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadId = resolveAdjacentThreadId({
          threadIds: orderedSidebarThreadIds,
          currentThreadId: routeThreadId,
          direction: traversalDirection,
        });
        if (!targetThreadId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(targetThreadId);
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadId = threadJumpThreadIds[jumpIndex];
      if (!targetThreadId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(targetThreadId);
    };

    const onWindowKeyUp = (event: KeyboardEvent) => {
      updateThreadJumpHintsVisibility(
        shouldShowThreadJumpHints(event, keybindings, {
          platform,
          context: getShortcutContext(),
        }),
      );
    };

    const onWindowBlur = () => {
      updateThreadJumpHintsVisibility(false);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("keyup", onWindowKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("keyup", onWindowKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [
    keybindings,
    navigateToThread,
    orderedSidebarThreadIds,
    platform,
    routeTerminalOpen,
    routeThreadId,
    threadJumpThreadIds,
    updateThreadJumpHintsVisibility,
  ]);

  function renderProjectItem(
    renderedProject: (typeof renderedProjects)[number],
    projectKind: SidebarProjectKind,
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const {
      availableProjectLabels,
      activeProjectLabelFilters,
      hasHiddenThreads,
      hiddenThreadStatus,
      lineageGroups,
      orchestrationModeErrorMessage,
      orchestrationModeGroups,
      orchestrationModeLoading,
      orchestrationSessionOptions,
      orderedProjectThreadIds,
      project,
      projectStatus,
      projectThreads,
      selectedOrchestrationSessionRootId,
      threadStatuses,
      ungroupedThreads,
      usesProjectBucketMode,
      showEmptyThreadState,
      showOrchestrationSessionEmptyState,
      shouldShowThreadPanel,
      isThreadListExpanded,
      usesOrchestrationMode,
    } = renderedProject;
    const isOrchestratorProject = projectKind === "orchestrator";
    const isExecutiveProject = projectKind === "executive";
    const projectDraftThreadId = projectDraftThreadIdByProjectId[project.id] ?? null;
    const showInlineOrchestrationSelector =
      isOrchestratorProject && appSettings.sidebarOrchestrationModeEnabled;
    // FIXME(orchestration-sidebar): the orchestrator header active styling still does not
    // reliably light up when the URL threadId matches the Jasper/orchestrator root thread.
    // The intended behavior is: if the current route thread is the orchestrator session root,
    // the orchestrator row should render with the same visible selected treatment as an active row.
    const isOrchestratorHeaderActive =
      routeThreadId !== null &&
      (routeThreadId === selectedOrchestrationSessionRootId ||
        routeThreadId === (project.currentSessionRootThreadId ?? null));
    const isProjectActive =
      routeThreadId !== null &&
      (isOrchestratorProject
        ? isOrchestratorHeaderActive
        : routeThreadId === projectDraftThreadId ||
          projectThreads.some((thread) => thread.id === routeThreadId));
    const selectedLabels = activeProjectLabelFilters ?? EMPTY_LABEL_ARRAY;
    const renderThreadRow = (thread: (typeof projectThreads)[number]) => {
      const isActive = routeThreadId === thread.id;
      const isSelected = selectedThreadIds.has(thread.id);
      const threadLabels = getSidebarThreadLabels(thread.labels);
      const jumpLabel = threadJumpLabelById.get(thread.id) ?? null;
      const wakeSummary = orchestratorWakeSummaryByThreadId.get(thread.id) ?? null;
      const orchestratorWakeBadgeCount =
        (wakeSummary?.pendingCount ?? 0) + (wakeSummary?.deliveringCount ?? 0);
      const workerWakeState = wakeSummary?.workerState ?? null;
      const isThreadRunning =
        thread.session?.status === "running" && thread.session.activeTurnId != null;
      const threadStatus = threadStatuses.get(thread.id) ?? null;
      const prStatus = buildPrStatusIndicator(prByThreadId.get(thread.id) ?? null);
      const terminalStatus = buildTerminalStatusIndicator(
        selectThreadTerminalState(terminalStateByThreadId, thread.id).runningTerminalIds,
      );
      const workerLineageIndicator = getWorkerLineageIndicator({
        thread,
        threads: threadsForOrchestrationResolution,
        projects,
      });
      const threadOperationsIndicator = getThreadOperationsIndicator({ thread });
      const isConfirmingArchive = confirmingArchiveThreadId === thread.id && !isThreadRunning;
      const orchestrationRowDescriptor = usesProjectBucketMode
        ? buildOrchestrationModeRowDescriptor({
            thread: {
              id: thread.id,
              title: thread.title,
              labels: thread.labels,
              spawnRole: thread.spawnRole,
              modelSelection: thread.modelSelection ?? {
                provider: "codex",
                model: DEFAULT_MODEL_BY_PROVIDER.codex,
              },
            },
          })
        : null;
      const shouldRenderOrchestrationThreadRow =
        usesProjectBucketMode &&
        thread.spawnRole !== undefined &&
        orchestrationRowDescriptor !== null;

      return (
        <SidebarThreadRow
          key={thread.id}
          threadId={thread.id}
          title={thread.title}
          archivedAt={thread.archivedAt}
          createdAt={thread.createdAt}
          updatedAt={thread.updatedAt ?? null}
          isActive={isActive}
          isSelected={isSelected}
          jumpLabel={jumpLabel}
          showThreadJumpHints={showThreadJumpHints}
          threadStatus={threadStatus}
          prStatus={prStatus}
          terminalStatus={terminalStatus}
          workerLineageIndicator={workerLineageIndicator}
          threadOperationsIndicator={threadOperationsIndicator}
          isThreadRunning={isThreadRunning}
          isConfirmingArchive={isConfirmingArchive}
          confirmThreadArchive={appSettings.confirmThreadArchive}
          confirmArchiveButtonRef={(element) => {
            if (element) {
              confirmArchiveButtonRefs.current.set(thread.id, element);
            } else {
              confirmArchiveButtonRefs.current.delete(thread.id);
            }
          }}
          onMouseLeave={() => {
            setConfirmingArchiveThreadId((current) => (current === thread.id ? null : current));
          }}
          onBlurCapture={(event) => {
            const currentTarget = event.currentTarget;
            requestAnimationFrame(() => {
              if (currentTarget.contains(document.activeElement)) {
                return;
              }
              setConfirmingArchiveThreadId((current) => (current === thread.id ? null : current));
            });
          }}
          onClick={(event) => {
            handleThreadClick(event, thread.id, orderedProjectThreadIds);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            navigateToThread(thread.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (selectedThreadIds.size > 0 && selectedThreadIds.has(thread.id)) {
              void handleMultiSelectContextMenu({
                x: event.clientX,
                y: event.clientY,
              });
            } else {
              if (selectedThreadIds.size > 0) {
                clearSelection();
              }
              void handleThreadContextMenu(thread.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }
          }}
          onOpenPrLink={openPrLink}
          onRequestConfirmArchive={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setConfirmingArchiveThreadId(thread.id);
            requestAnimationFrame(() => {
              confirmArchiveButtonRefs.current.get(thread.id)?.focus();
            });
          }}
          onConfirmArchive={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setConfirmingArchiveThreadId((current) => (current === thread.id ? null : current));
            void attemptArchiveThread(thread.id);
          }}
        >
          {renamingThreadId === thread.id ? (
            <input
              ref={(el) => {
                if (el && renamingInputRef.current !== el) {
                  renamingInputRef.current = el;
                  el.focus();
                  el.select();
                }
              }}
              className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
              value={renamingTitle}
              onChange={(e) => setRenamingTitle(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  renamingCommittedRef.current = true;
                  void commitRename(thread.id, renamingTitle, thread.title);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  renamingCommittedRef.current = true;
                  cancelRename();
                }
              }}
              onBlur={() => {
                if (!renamingCommittedRef.current) {
                  void commitRename(thread.id, renamingTitle, thread.title);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : shouldRenderOrchestrationThreadRow ? (
            <>
              {thread.spawnRole === "worker" ? (
                <HardHatIcon className="size-3 shrink-0 text-amber-500" />
              ) : (
                <BotIcon className="size-3 shrink-0 text-fuchsia-500" />
              )}
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {orchestrationRowDescriptor.visibleBadges.map((badge) => (
                  <Badge
                    key={badge.key}
                    variant="outline"
                    title={`${thread.title} · ${badge.label}`}
                    className="h-4 min-w-0 max-w-24 px-1 text-[9px] font-medium leading-none text-muted-foreground/80"
                  >
                    <span className="truncate">{badge.label}</span>
                  </Badge>
                ))}
              </div>
              {orchestratorWakeBadgeCount > 0 ? (
                <Badge className="h-4 shrink-0 border-0 bg-amber-500/12 px-1 text-[9px] font-medium leading-none text-amber-600 dark:text-amber-300">
                  {wakeSummary?.deliveringCount
                    ? `${orchestratorWakeBadgeCount} active`
                    : `${orchestratorWakeBadgeCount} waiting`}
                </Badge>
              ) : null}
              {workerWakeState !== null ? (
                <Badge
                  className={cn(
                    "h-4 shrink-0 border-0 px-1 text-[9px] font-medium leading-none",
                    workerWakeState === "delivering"
                      ? "bg-sky-500/12 text-sky-600 dark:text-sky-300"
                      : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
                  )}
                >
                  {workerWakeState === "delivering" ? "waking" : "queued"}
                </Badge>
              ) : null}
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
              {threadLabels.length > 0 ? (
                <div className="flex shrink-0 items-center gap-1 overflow-hidden">
                  {threadLabels.map((label) => (
                    <Badge
                      key={label}
                      variant="outline"
                      title={label}
                      className="h-4 min-w-0 max-w-20 px-1 text-[9px] font-medium leading-none text-muted-foreground/80"
                    >
                      <span className="truncate">{label}</span>
                    </Badge>
                  ))}
                </div>
              ) : null}
              {thread.spawnRole && (
                <Badge
                  className={`h-4 shrink-0 border-0 px-1 text-[9px] font-medium leading-none ${
                    thread.spawnRole === "worker"
                      ? "bg-blue-500/10 text-blue-500"
                      : thread.spawnRole === "orchestrator"
                        ? "bg-fuchsia-500/10 text-fuchsia-500"
                        : "bg-amber-500/10 text-amber-500"
                  }`}
                >
                  {thread.spawnRole}
                </Badge>
              )}
              {orchestratorWakeBadgeCount > 0 ? (
                <Badge className="h-4 shrink-0 border-0 bg-amber-500/12 px-1 text-[9px] font-medium leading-none text-amber-600 dark:text-amber-300">
                  {wakeSummary?.deliveringCount
                    ? `${orchestratorWakeBadgeCount} active`
                    : `${orchestratorWakeBadgeCount} waiting`}
                </Badge>
              ) : null}
              {workerWakeState !== null ? (
                <Badge
                  className={cn(
                    "h-4 shrink-0 border-0 px-1 text-[9px] font-medium leading-none",
                    workerWakeState === "delivering"
                      ? "bg-sky-500/12 text-sky-600 dark:text-sky-300"
                      : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
                  )}
                >
                  {workerWakeState === "delivering" ? "waking" : "queued"}
                </Badge>
              ) : null}
            </>
          )}
        </SidebarThreadRow>
      );
    };
    const projectIcon = isOrchestratorProject ? (
      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
        <BotIcon className="size-3" />
      </span>
    ) : isExecutiveProject ? (
      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
        <NetworkIcon className="size-3" />
      </span>
    ) : (
      <ProjectFavicon cwd={project.cwd} />
    );

    return (
      <>
        <SidebarProjectHeader
          {...(isManualProjectSorting && dragHandleProps?.setActivatorNodeRef
            ? {
                activatorRef: dragHandleProps.setActivatorNodeRef as Ref<HTMLButtonElement>,
              }
            : {})}
          isActive={isProjectActive}
          expanded={project.expanded}
          isOrchestratorProject={isOrchestratorProject}
          isManualProjectSorting={isManualProjectSorting}
          projectName={project.name}
          projectStatus={projectStatus}
          projectIcon={projectIcon}
          buttonClassName={cn(
            isOrchestratorProject ? "ml-3 px-2" : "px-2",
            isOrchestratorProject && isOrchestratorHeaderActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : undefined,
            showInlineOrchestrationSelector ? "pr-16" : undefined,
          )}
          buttonProps={
            isManualProjectSorting && dragHandleProps
              ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners }
              : undefined
          }
          onPointerDownCapture={handleProjectTitlePointerDownCapture}
          onClick={(event) => handleProjectTitleClick(event, project.id, projectKind)}
          onKeyDown={(event) => handleProjectTitleKeyDown(event, project.id, projectKind)}
          onContextMenu={(event) => {
            event.preventDefault();
            suppressProjectClickForContextMenuRef.current = true;
            void handleProjectContextMenu(project.id, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          {showInlineOrchestrationSelector ? (
            <div
              className="absolute inset-y-0 right-1.5 flex items-center"
              data-thread-selection-safe
            >
              <OrchestrationSessionSelector
                projectName={project.name}
                selectedRootThreadId={selectedOrchestrationSessionRootId}
                sessionOptions={orchestrationSessionOptions}
                isLoading={orchestrationModeLoading}
                iconOnly
                onSelectSession={(rootThreadId) => {
                  void handleSelectOrchestrationSession(project.id, rootThreadId);
                }}
                onCreateSession={() => {
                  void handleCreateOrchestrationSession(project.id);
                }}
              />
            </div>
          ) : null}
          {!isOrchestratorProject ? (
            <LabelFilterMenu
              availableLabels={availableProjectLabels}
              selectedLabels={selectedLabels}
              onToggleLabel={(label) => toggleLabelFilter(project.id, label)}
              onClearLabels={() => clearLabelFilters(project.id)}
            />
          ) : null}
          {!isOrchestratorProject ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuAction
                    render={
                      <button
                        type="button"
                        aria-label={`Create new thread in ${project.name}`}
                        data-testid="new-thread-button"
                      />
                    }
                    showOnHover
                    className="top-1 right-1.5 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleSidebarNewThread(project.id, {
                        envMode: resolveSidebarNewThreadEnvMode({
                          defaultEnvMode: appSettings.defaultThreadEnvMode,
                        }),
                      });
                    }}
                  >
                    <SquarePenIcon className="size-3.5" />
                  </SidebarMenuAction>
                }
              />
              <TooltipPopup side="top">
                {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </SidebarProjectHeader>

        {!isOrchestratorProject ? (
          <SidebarMenuSub
            ref={attachThreadListAutoAnimateRef}
            className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0"
          >
            {showInlineOrchestrationSelector && orchestrationModeErrorMessage ? (
              <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                <p className="px-2 py-0.5 text-[10px] text-destructive">
                  {orchestrationModeErrorMessage}
                </p>
              </SidebarMenuSubItem>
            ) : null}
            {selectedLabels.length > 0 && project.expanded && (
              <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                <div
                  data-thread-selection-safe
                  className="flex flex-wrap items-center gap-1 px-2 py-0.5"
                >
                  {selectedLabels.map((label) => (
                    <button
                      key={label}
                      type="button"
                      data-thread-selection-safe
                      onClick={() => toggleLabelFilter(project.id, label)}
                      className="inline-flex h-4 items-center gap-0.5 rounded-full border border-primary/40 bg-primary/8 px-1.5 text-[9px] font-medium text-primary transition-colors hover:bg-primary/16 cursor-pointer"
                    >
                      <span>{label}</span>
                      <span aria-hidden="true" className="leading-none">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              </SidebarMenuSubItem>
            )}
            {shouldShowThreadPanel &&
            usesOrchestrationMode &&
            showOrchestrationSessionEmptyState ? (
              <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                <div
                  data-thread-selection-safe
                  className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60"
                >
                  <span>
                    {selectedLabels.length > 0
                      ? "No workers match the active filters"
                      : "No workers dispatched in this session yet"}
                  </span>
                </div>
              </SidebarMenuSubItem>
            ) : null}
            {shouldShowThreadPanel && showEmptyThreadState ? (
              <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                <div
                  data-thread-selection-safe
                  className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60"
                >
                  <span>
                    {selectedLabels.length > 0
                      ? "No threads match the active filters"
                      : "No threads yet"}
                  </span>
                </div>
              </SidebarMenuSubItem>
            ) : null}
            {shouldShowThreadPanel && usesOrchestrationMode ? (
              <>
                {orchestrationModeGroups.map((group) => (
                  <Fragment key={group.canonicalProjectId}>
                    {orchestrationModeGroups.length > 1 ? (
                      <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                        <div
                          data-thread-selection-safe
                          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-[0.12em]"
                        >
                          <ProjectFavicon
                            cwd={
                              projects.find(
                                (candidateProject) =>
                                  candidateProject.id === group.canonicalProjectId,
                              )?.cwd ?? project.cwd
                            }
                            className="size-3 rounded-sm"
                          />
                          <span className="truncate">{group.canonicalProjectName}</span>
                          <span className="text-[9px] text-muted-foreground/60">
                            {group.threads.length}
                          </span>
                        </div>
                      </SidebarMenuSubItem>
                    ) : null}
                    {group.threads.map((thread) => renderThreadRow(thread))}
                  </Fragment>
                ))}
              </>
            ) : shouldShowThreadPanel ? (
              <>
                {lineageGroups.map((group) => (
                  <Fragment key={group.parentThreadId}>
                    {group.parentThread ? (
                      renderThreadRow(group.parentThread)
                    ) : (
                      <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
                        <div
                          data-thread-selection-safe
                          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-muted-foreground/60"
                        >
                          <NetworkIcon className="size-3 shrink-0" />
                          <span className="truncate" title={group.parentThreadId}>
                            {group.parentThreadId}
                          </span>
                        </div>
                      </SidebarMenuSubItem>
                    )}
                    <div className="ml-3 border-l border-border/50 pl-1">
                      {group.workers.map((worker) => renderThreadRow(worker))}
                    </div>
                  </Fragment>
                ))}
                {ungroupedThreads.map((thread) => renderThreadRow(thread))}
              </>
            ) : null}

            {project.expanded && hasHiddenThreads && !isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  data-thread-selection-safe
                  size="sm"
                  className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                  onClick={() => {
                    expandThreadListForProject(project.id);
                  }}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {hiddenThreadStatus && (
                      <ThreadStatusLabel status={hiddenThreadStatus} compact />
                    )}
                    <span>Show more</span>
                  </span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
            {project.expanded && hasHiddenThreads && isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  data-thread-selection-safe
                  size="sm"
                  className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                  onClick={() => {
                    collapseThreadListForProject(project.id);
                  }}
                >
                  <span>Show less</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        ) : null}
      </>
    );
  }

  const openCurrentOrchestratorSession = useCallback(
    async (projectId: ProjectId) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      const projectRootThreads = orchestrationRootThreadsByProjectId.get(projectId) ?? [];
      const storedRootThread =
        project?.currentSessionRootThreadId === undefined
          ? null
          : (projectRootThreads.find(
              (thread) => thread.id === project.currentSessionRootThreadId,
            ) ?? null);
      const activeRootThread =
        [...projectRootThreads]
          .filter((thread) => thread.archivedAt === null)
          .toSorted(
            (left, right) =>
              (right.updatedAt ?? right.createdAt).localeCompare(
                left.updatedAt ?? left.createdAt,
              ) || right.createdAt.localeCompare(left.createdAt),
          )[0] ?? null;
      const currentRootThreadId =
        storedRootThread?.archivedAt === null
          ? storedRootThread.id
          : (activeRootThread?.id ?? storedRootThread?.id ?? null);

      if (currentRootThreadId !== null) {
        if (project?.currentSessionRootThreadId !== currentRootThreadId) {
          await persistCurrentOrchestrationSessionRoot(projectId, currentRootThreadId);
        }
        await navigateToSelectedThread(currentRootThreadId);
        return;
      }

      await openOrCreateOrchestratorSession(projectId);
    },
    [
      navigateToSelectedThread,
      openOrCreateOrchestratorSession,
      orchestrationRootThreadsByProjectId,
      persistCurrentOrchestrationSessionRoot,
      projects,
    ],
  );

  const handleProjectTitleClick = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      projectId: ProjectId,
      projectKind: SidebarProjectKind,
    ) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        // Consume the synthetic click emitted after a drag release.
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      if (projectKind === "orchestrator") {
        void openCurrentOrchestratorSession(projectId);
        return;
      }
      toggleProject(projectId);
    },
    [clearSelection, openCurrentOrchestratorSession, selectedThreadIds.size, toggleProject],
  );

  const handleProjectTitleKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLButtonElement>,
      projectId: ProjectId,
      projectKind: SidebarProjectKind,
    ) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      if (projectKind === "orchestrator") {
        void openCurrentOrchestratorSession(projectId);
        return;
      }
      toggleProject(projectId);
    },
    [openCurrentOrchestratorSession, toggleProject],
  );

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, selectedThreadIds.size]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", sidebarShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", sidebarShortcutLabelOptions);

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const toggleLabelFilter = useCallback(
    (projectId: ProjectId, label: string) => {
      toggleProjectLabelFilter(projectId, label);
    },
    [toggleProjectLabelFilter],
  );

  const clearLabelFilters = useCallback(
    (projectId: ProjectId) => {
      clearProjectLabelFilters(projectId);
    },
    [clearProjectLabelFilters],
  );

  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={isStandaloneWindow} />

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <SidebarContent className="gap-0">
            {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
              <SidebarGroup className="px-2 pt-2 pb-0">
                <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
                  <TriangleAlertIcon />
                  <AlertTitle>Intel build on Apple Silicon</AlertTitle>
                  <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
                  {desktopUpdateButtonAction !== "none" ? (
                    <AlertAction>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={desktopUpdateButtonDisabled}
                        onClick={handleDesktopUpdateButtonClick}
                      >
                        {desktopUpdateButtonAction === "download"
                          ? "Download ARM build"
                          : "Install ARM build"}
                      </Button>
                    </AlertAction>
                  ) : null}
                </Alert>
              </SidebarGroup>
            ) : null}
            <SidebarGroup className="px-2 py-2">
              <div className="mb-2 flex items-center justify-between pl-2 pr-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Workspace
                </span>
                <div className="flex items-center gap-1">
                  <ProjectSortMenu
                    projectSortOrder={appSettings.sidebarProjectSortOrder}
                    threadSortOrder={appSettings.sidebarThreadSortOrder}
                    onProjectSortOrderChange={(sortOrder) => {
                      updateSettings({ sidebarProjectSortOrder: sortOrder });
                    }}
                    onThreadSortOrderChange={(sortOrder) => {
                      updateSettings({ sidebarThreadSortOrder: sortOrder });
                    }}
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={
                            shouldShowAddProjectForm && newProjectKind === "project"
                              ? "Cancel add project"
                              : "Add project"
                          }
                          aria-pressed={shouldShowAddProjectForm && newProjectKind === "project"}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() => handleStartAddProject("project")}
                        >
                          <PlusIcon
                            className={`size-3.5 transition-transform duration-150 ${
                              shouldShowAddProjectForm && newProjectKind === "project"
                                ? "rotate-45"
                                : "rotate-0"
                            }`}
                          />
                          <span className="text-[11px] font-medium">Project</span>
                        </button>
                      }
                    />
                    <TooltipPopup side="right">
                      {shouldShowAddProjectForm && newProjectKind === "project"
                        ? "Cancel add project"
                        : "Add project"}
                    </TooltipPopup>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={
                            shouldShowAddProjectForm && newProjectKind === "executive"
                              ? "Cancel add CTO"
                              : "Add CTO"
                          }
                          aria-pressed={shouldShowAddProjectForm && newProjectKind === "executive"}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() => handleStartAddProject("executive")}
                        >
                          <NetworkIcon
                            className={`size-3.5 transition-transform duration-150 ${
                              shouldShowAddProjectForm && newProjectKind === "executive"
                                ? "scale-110"
                                : "scale-100"
                            }`}
                          />
                          <span className="text-[11px] font-medium">CTO</span>
                        </button>
                      }
                    />
                    <TooltipPopup side="right">
                      {shouldShowAddProjectForm && newProjectKind === "executive"
                        ? "Cancel add CTO"
                        : "Add CTO"}
                    </TooltipPopup>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={
                            shouldShowAddProjectForm && newProjectKind === "orchestrator"
                              ? "Cancel add orchestrator"
                              : "Add orchestrator"
                          }
                          aria-pressed={
                            shouldShowAddProjectForm && newProjectKind === "orchestrator"
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() => handleStartAddProject("orchestrator")}
                        >
                          <BotIcon
                            className={`size-3.5 transition-transform duration-150 ${
                              shouldShowAddProjectForm && newProjectKind === "orchestrator"
                                ? "scale-110"
                                : "scale-100"
                            }`}
                          />
                          <span className="text-[11px] font-medium">Orchestrator</span>
                        </button>
                      }
                    />
                    <TooltipPopup side="right">
                      {shouldShowAddProjectForm && newProjectKind === "orchestrator"
                        ? "Cancel add orchestrator"
                        : "Add orchestrator"}
                    </TooltipPopup>
                  </Tooltip>
                </div>
              </div>
              {shouldShowAddProjectForm && (
                <div className="mb-2 px-1">
                  {isElectron && (
                    <button
                      type="button"
                      className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void handlePickFolder(newProjectKind)}
                      disabled={isPickingFolder || isAddingProject}
                    >
                      <FolderIcon className="size-3.5" />
                      {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                    </button>
                  )}
                  {newProjectKind === "orchestrator" && (
                    <input
                      className="mb-1.5 min-w-0 w-full rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                      placeholder="Orchestrator name"
                      value={newOrchestratorName}
                      onChange={(event) => {
                        setNewOrchestratorName(event.target.value);
                        setAddProjectError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setAddingProject(false);
                          setAddProjectError(null);
                          setNewCwd("");
                          setNewOrchestratorName("");
                        }
                      }}
                      autoFocus
                    />
                  )}
                  <div className="flex gap-1.5">
                    <input
                      ref={addProjectInputRef}
                      className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                        addProjectError
                          ? "border-red-500/70 focus:border-red-500"
                          : "border-border focus:border-ring"
                      }`}
                      placeholder={
                        newProjectKind === "orchestrator"
                          ? "/path/to/orchestrator"
                          : newProjectKind === "executive"
                            ? "/path/to/cto"
                            : "/path/to/project"
                      }
                      value={newCwd}
                      onChange={(event) => {
                        setNewCwd(event.target.value);
                        setAddProjectError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleAddProject(newProjectKind);
                        if (event.key === "Escape") {
                          setAddingProject(false);
                          setAddProjectError(null);
                          setNewCwd("");
                          setNewOrchestratorName("");
                        }
                      }}
                      autoFocus={newProjectKind === "project"}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                      onClick={() => handleAddProject(newProjectKind)}
                      disabled={!canAddProject}
                    >
                      {isAddingProject
                        ? "Adding..."
                        : newProjectKind === "orchestrator"
                          ? "Add orchestrator"
                          : newProjectKind === "executive"
                            ? "Add CTO"
                            : "Add project"}
                    </button>
                  </div>
                  {addProjectError && (
                    <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">
                      {addProjectError}
                    </p>
                  )}
                </div>
              )}
            </SidebarGroup>

            <ProgramNotificationsPanel groups={programNotificationGroups} />

            <SidebarGroup className="px-2 py-2">
              <div className="mb-1 flex items-center gap-1.5 pl-2 pr-1.5">
                <NetworkIcon className="size-3.5 text-emerald-600/85 dark:text-emerald-300/80" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Executive
                </span>
              </div>
              {isManualProjectSorting ? (
                <DndContext
                  sensors={projectDnDSensors}
                  collisionDetection={projectCollisionDetection}
                  modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                  onDragStart={handleProjectDragStart}
                  onDragEnd={handleProjectDragEnd}
                  onDragCancel={handleProjectDragCancel}
                >
                  <SidebarMenu>
                    <SortableContext
                      items={executiveRenderedProjects.map(
                        (renderedProject) => renderedProject.project.id,
                      )}
                      strategy={verticalListSortingStrategy}
                    >
                      {executiveRenderedProjects.map((renderedProject) => (
                        <SortableProjectItem
                          key={renderedProject.project.id}
                          projectId={renderedProject.project.id}
                        >
                          {(dragHandleProps) =>
                            renderProjectItem(renderedProject, "executive", dragHandleProps)
                          }
                        </SortableProjectItem>
                      ))}
                    </SortableContext>
                  </SidebarMenu>
                </DndContext>
              ) : (
                <SidebarMenu ref={attachProjectListAutoAnimateRef}>
                  {executiveRenderedProjects.map((renderedProject) => (
                    <SidebarMenuItem key={renderedProject.project.id} className="rounded-md">
                      {renderProjectItem(renderedProject, "executive", null)}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
              {executiveRenderedProjects.length === 0 && !shouldShowAddProjectForm && (
                <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
                  No CTO workspace yet
                </div>
              )}
            </SidebarGroup>

            <SidebarGroup className="px-2 py-2">
              <div className="mb-1 flex items-center gap-1.5 pl-2 pr-1.5">
                <BotIcon className="size-3.5 text-fuchsia-500/85 dark:text-fuchsia-300/80" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Orchestrators
                </span>
              </div>
              {isManualProjectSorting ? (
                <DndContext
                  sensors={projectDnDSensors}
                  collisionDetection={projectCollisionDetection}
                  modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                  onDragStart={handleProjectDragStart}
                  onDragEnd={handleProjectDragEnd}
                  onDragCancel={handleProjectDragCancel}
                >
                  <SidebarMenu>
                    <SortableContext
                      items={orchestratorRenderedProjects.map(
                        (renderedProject) => renderedProject.project.id,
                      )}
                      strategy={verticalListSortingStrategy}
                    >
                      {orchestratorRenderedProjects.map((renderedProject) => (
                        <SortableProjectItem
                          key={renderedProject.project.id}
                          projectId={renderedProject.project.id}
                        >
                          {(dragHandleProps) =>
                            renderProjectItem(renderedProject, "orchestrator", dragHandleProps)
                          }
                        </SortableProjectItem>
                      ))}
                    </SortableContext>
                  </SidebarMenu>
                </DndContext>
              ) : (
                <SidebarMenu ref={attachProjectListAutoAnimateRef}>
                  {orchestratorRenderedProjects.map((renderedProject) => (
                    <SidebarMenuItem key={renderedProject.project.id} className="rounded-md">
                      {renderProjectItem(renderedProject, "orchestrator", null)}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
              {orchestratorRenderedProjects.length === 0 && !shouldShowAddProjectForm && (
                <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
                  No orchestrators yet
                </div>
              )}
            </SidebarGroup>

            <SidebarGroup className="px-2 py-2 pt-0">
              <div className="mb-1 flex items-center gap-1.5 pl-2 pr-1.5">
                <FolderIcon className="size-3.5 text-muted-foreground/70" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Projects
                </span>
              </div>
              {isManualProjectSorting ? (
                <DndContext
                  sensors={projectDnDSensors}
                  collisionDetection={projectCollisionDetection}
                  modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                  onDragStart={handleProjectDragStart}
                  onDragEnd={handleProjectDragEnd}
                  onDragCancel={handleProjectDragCancel}
                >
                  <SidebarMenu>
                    <SortableContext
                      items={regularRenderedProjects.map(
                        (renderedProject) => renderedProject.project.id,
                      )}
                      strategy={verticalListSortingStrategy}
                    >
                      {regularRenderedProjects.map((renderedProject) => (
                        <SortableProjectItem
                          key={renderedProject.project.id}
                          projectId={renderedProject.project.id}
                        >
                          {(dragHandleProps) =>
                            renderProjectItem(renderedProject, "project", dragHandleProps)
                          }
                        </SortableProjectItem>
                      ))}
                    </SortableContext>
                  </SidebarMenu>
                </DndContext>
              ) : (
                <SidebarMenu ref={attachProjectListAutoAnimateRef}>
                  {regularRenderedProjects.map((renderedProject) => (
                    <SidebarMenuItem key={renderedProject.project.id} className="rounded-md">
                      {renderProjectItem(renderedProject, "project", null)}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}

              {regularRenderedProjects.length === 0 && !shouldShowAddProjectForm && (
                <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
                  No projects yet
                </div>
              )}
            </SidebarGroup>
          </SidebarContent>

          <SidebarSeparator />
          {!isStandaloneWindow ? (
            <SidebarFooter className="p-2">
              <SidebarUpdatePill />
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                    onClick={() => void navigate({ to: "/settings" })}
                  >
                    <SettingsIcon className="size-3.5" />
                    <span className="text-xs">Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          ) : null}
        </>
      )}
    </>
  );
}
