import * as React from "react";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import type { Project, Thread } from "../types";
import { getDisplayThreadLabelEntries } from "../lib/threadLabels";
import { cn } from "../lib/utils";
import {
  collapseThreadToCanonicalProject,
  resolveThreadSessionRootId,
} from "../lib/orchestrationMode";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 100;
export type SidebarNewThreadEnvMode = "local" | "worktree";
export type SidebarProjectKind = "project" | "orchestrator";
type SidebarProject = Pick<Project, "id" | "name" | "cwd" | "kind"> & {
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};
type SidebarThreadSortInput = Pick<Thread, "createdAt" | "updatedAt"> & {
  latestUserMessageAt?: string | null;
  messages?: ReadonlyArray<Pick<Thread["messages"][number], "createdAt" | "role">>;
};

export type ThreadTraversalDirection = "previous" | "next";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "proposedPlans" | "session"
> & {
  lastVisitedAt?: string | undefined;
};

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function buildCopyThreadIdErrorDescription(input: {
  threadId: string;
  errorMessage?: string | null | undefined;
}): string {
  const message = input.errorMessage?.trim();
  if (!message) {
    return `Thread ID: ${input.threadId}`;
  }
  return `${message}\nThread ID: ${input.threadId}`;
}

function toNormalizedCwdSegments(cwd: string): string[] {
  return cwd
    .split(/[/\\]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);
}

export function resolveSidebarProjectKind(input: {
  project: SidebarProject;
  orchestratorProjectCwds?: ReadonlySet<string> | readonly string[];
}): SidebarProjectKind {
  const { project } = input;
  if (project.kind === "orchestrator" || project.kind === "project") {
    return project.kind;
  }

  const orchestratorProjectCwds =
    input.orchestratorProjectCwds instanceof Set
      ? input.orchestratorProjectCwds
      : new Set(input.orchestratorProjectCwds ?? []);
  if (orchestratorProjectCwds.has(project.cwd)) {
    return "orchestrator";
  }

  const normalizedName = project.name.trim().toLowerCase();
  const normalizedSegments = toNormalizedCwdSegments(project.cwd);
  if (normalizedName.includes("jasper") || normalizedSegments.includes("jasper")) {
    return "orchestrator";
  }

  return "project";
}

export function partitionProjectsForSidebar<TProject extends SidebarProject>(input: {
  projects: readonly TProject[];
  orchestratorProjectCwds?: ReadonlySet<string> | readonly string[];
}): {
  orchestratorProjects: TProject[];
  regularProjects: TProject[];
} {
  const orchestratorProjects: TProject[] = [];
  const regularProjects: TProject[] = [];
  for (const project of input.projects) {
    const projectKind = resolveSidebarProjectKind(
      input.orchestratorProjectCwds === undefined
        ? { project }
        : {
            project,
            orchestratorProjectCwds: input.orchestratorProjectCwds,
          },
    );
    if (projectKind === "orchestrator") {
      orchestratorProjects.push(project);
    } else {
      regularProjects.push(project);
    }
  }
  return { orchestratorProjects, regularProjects };
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const { getId, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const itemsById = new Map(items.map((item) => [getId(item), item] as const));
  const preferredIdSet = new Set(preferredIds);
  const emittedPreferredIds = new Set<TId>();
  const ordered = preferredIds.flatMap((id) => {
    if (emittedPreferredIds.has(id)) {
      return [];
    }
    const item = itemsById.get(id);
    if (!item) {
      return [];
    }
    emittedPreferredIds.add(id);
    return [item];
  });
  const remaining = items.filter((item) => !preferredIdSet.has(getId(item)));
  return [...ordered, ...remaining];
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreads: readonly {
      id: TThreadId;
    }[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false
      ? []
      : renderedProject.renderedThreads.map((thread) => thread.id),
  );
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function getSidebarThreadLabels(
  labels: Thread["labels"] | null | undefined,
  maxLabels = 2,
): string[] {
  return getDisplayThreadLabelEntries(labels, maxLabels).map((label) => label.displayLabel);
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function isThreadActiveForFold(thread: Pick<Thread, "session">): boolean {
  return thread.session?.status === "running" || thread.session?.status === "connecting";
}

export function filterThreadsByLabels<T extends Pick<Thread, "labels">>(
  threads: readonly T[],
  selectedLabels: readonly string[],
): T[] {
  if (selectedLabels.length === 0) return [...threads];
  return threads.filter((thread) =>
    selectedLabels.every((label) => (thread.labels ?? []).includes(label)),
  );
}

export function getUniqueLabelsFromThreads(
  threads: ReadonlyArray<Pick<Thread, "labels">>,
): string[] {
  const seen = new Set<string>();
  for (const thread of threads) {
    for (const label of thread.labels ?? []) {
      const trimmed = label.trim();
      if (trimmed.length > 0) seen.add(trimmed);
    }
  }
  return [...seen].toSorted();
}

export interface OrchestrationModeRenderedProjectGroup<TThread> {
  canonicalProjectId: Project["id"];
  canonicalProjectName: string;
  threads: TThread[];
}

export function shouldUseSidebarOrchestrationMode(input: {
  projectKind: SidebarProjectKind;
  settingEnabled: boolean;
  selectedSessionRootId: Thread["id"] | null;
}): boolean {
  return (
    input.settingEnabled &&
    input.projectKind === "orchestrator" &&
    input.selectedSessionRootId !== null
  );
}

export function resolveSelectedOrchestrationSessionRootId<
  TThread extends Pick<
    Thread,
    | "id"
    | "archivedAt"
    | "createdAt"
    | "updatedAt"
    | "parentThreadId"
    | "spawnRole"
    | "spawnedBy"
    | "orchestratorThreadId"
    | "workflowId"
  >,
>(input: {
  routeThreadId: TThread["id"] | null;
  storedSelectedSessionRootId: TThread["id"] | null;
  projectRootThreads: readonly TThread[];
  threadsForResolution: readonly TThread[];
}): TThread["id"] | null {
  const validRootIds = new Set(input.projectRootThreads.map((thread) => thread.id));
  const routeRootThreadId =
    input.routeThreadId === null
      ? null
      : resolveThreadSessionRootId({
          threadId: input.routeThreadId,
          threads: input.threadsForResolution,
        });
  if (routeRootThreadId !== null && validRootIds.has(routeRootThreadId)) {
    return routeRootThreadId;
  }
  return resolveCurrentOrchestrationSessionRootId({
    storedCurrentSessionRootId: input.storedSelectedSessionRootId,
    projectRootThreads: input.projectRootThreads,
  });
}

export function resolveCurrentOrchestrationSessionRootId<
  TThread extends Pick<Thread, "id" | "archivedAt" | "createdAt" | "updatedAt">,
>(input: {
  storedCurrentSessionRootId: TThread["id"] | null;
  projectRootThreads: readonly TThread[];
}): TThread["id"] | null {
  const activeRootThread = [...input.projectRootThreads]
    .filter((thread) => thread.archivedAt === null)
    .toSorted(
      (left, right) =>
        (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) ||
        right.createdAt.localeCompare(left.createdAt),
    )[0];
  const storedRootThread =
    input.storedCurrentSessionRootId === null
      ? null
      : (input.projectRootThreads.find(
          (thread) => thread.id === input.storedCurrentSessionRootId,
        ) ?? null);
  if (storedRootThread && (storedRootThread.archivedAt === null || !activeRootThread)) {
    return storedRootThread.id;
  }
  if (activeRootThread) {
    return activeRootThread.id;
  }

  return (
    [...input.projectRootThreads].toSorted(
      (left, right) =>
        (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) ||
        right.createdAt.localeCompare(left.createdAt),
    )[0]?.id ?? null
  );
}

export function groupThreadsForOrchestrationMode<
  TThread extends Pick<
    Thread,
    "id" | "projectId" | "createdAt" | "updatedAt" | "worktreePath" | "orchestratorProjectId"
  > &
    SidebarThreadSortInput,
>(input: {
  threads: readonly TThread[];
  projects: readonly Pick<Project, "id" | "name" | "cwd" | "kind">[];
  sortOrder: SidebarThreadSortOrder;
}): OrchestrationModeRenderedProjectGroup<TThread>[] {
  const threadsByProjectId = new Map<Project["id"], TThread[]>();
  const projectNameById = new Map<Project["id"], string>();

  for (const thread of input.threads) {
    const bucket = collapseThreadToCanonicalProject({
      thread,
      projects: input.projects,
    });
    const current = threadsByProjectId.get(bucket.canonicalProjectId) ?? [];
    current.push(thread);
    threadsByProjectId.set(bucket.canonicalProjectId, current);
    projectNameById.set(bucket.canonicalProjectId, bucket.canonicalProjectName);
  }

  return [...threadsByProjectId.entries()]
    .map(([canonicalProjectId, threads]) => ({
      canonicalProjectId,
      canonicalProjectName: projectNameById.get(canonicalProjectId) ?? canonicalProjectId,
      threads: sortThreadsForSidebar(threads, input.sortOrder),
    }))
    .toSorted((left, right) => left.canonicalProjectName.localeCompare(right.canonicalProjectName));
}

export function getVisibleThreadsForProject<T extends Pick<Thread, "id" | "session">>(input: {
  threads: readonly T[];
  activeThreadId: T["id"] | undefined;
  allowActiveThreadsInFold: boolean;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: T[];
  hiddenThreads: T[];
} {
  const { activeThreadId, allowActiveThreadsInFold, isThreadListExpanded, previewLimit, threads } =
    input;
  const normalizedPreviewLimit = Math.max(0, previewLimit);
  const visibleThreadIds = new Set(
    threads.slice(0, normalizedPreviewLimit).map((thread) => thread.id),
  );

  if (activeThreadId) {
    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    if (activeThread) {
      visibleThreadIds.add(activeThread.id);
    }
  }

  if (allowActiveThreadsInFold) {
    for (const thread of threads) {
      if (isThreadActiveForFold(thread)) {
        visibleThreadIds.add(thread.id);
      }
    }
  }

  const hiddenThreads = threads.filter((thread) => !visibleThreadIds.has(thread.id));
  if (hiddenThreads.length === 0) {
    return {
      hasHiddenThreads: false,
      hiddenThreads: [],
      visibleThreads: [...threads],
    };
  }

  if (isThreadListExpanded) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: [],
      visibleThreads: [...threads],
    };
  }

  return {
    hasHiddenThreads: true,
    hiddenThreads,
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getLatestUserMessageTimestamp(thread: SidebarThreadSortInput): number {
  if (thread.latestUserMessageAt) {
    return toSortableTimestamp(thread.latestUserMessageAt) ?? Number.NEGATIVE_INFINITY;
  }

  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages ?? []) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function getThreadSortTimestamp(
  thread: SidebarThreadSortInput,
  sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

export function sortThreadsForSidebar<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt"> & SidebarThreadSortInput,
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  return threads.toSorted((left, right) => {
    const rightTimestamp = getThreadSortTimestamp(right, sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

type ActiveProjectThreadSortInput = Pick<
  Thread,
  "id" | "projectId" | "archivedAt" | "createdAt" | "updatedAt"
> &
  SidebarThreadSortInput & {
    deletedAt?: string | null | undefined;
    latestTurn?: {
      completedAt?: string | null | undefined;
    } | null;
    session?: {
      status?: string | undefined;
    } | null;
  };

export function resolveLatestActiveThreadForProject<T extends ActiveProjectThreadSortInput>(input: {
  projectId: T["projectId"];
  threads: readonly T[];
  sortOrder: SidebarThreadSortOrder;
}): T | null {
  const activeThreads = sortThreadsForSidebar(
    input.threads.filter(
      (thread) =>
        thread.projectId === input.projectId &&
        thread.archivedAt === null &&
        thread.deletedAt == null,
    ),
    input.sortOrder,
  );
  const activeSessionThread = activeThreads.find((thread) => {
    const status = thread.session?.status;
    return status !== undefined && status !== "closed";
  });
  if (activeSessionThread) {
    return activeSessionThread;
  }
  const pendingTurnThread = activeThreads.find((thread) => {
    const latestTurn = thread.latestTurn;
    return latestTurn != null && latestTurn.completedAt === null;
  });
  if (pendingTurnThread) {
    return pendingTurnThread;
  }
  return activeThreads[0] ?? null;
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & SidebarThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreadsForSidebar(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}

/** Minimal shape needed for lineage grouping — works with Thread and SidebarThreadSnapshot. */
type LineageGroupable = Pick<
  Thread,
  "id" | "createdAt" | "orchestratorThreadId" | "parentThreadId" | "spawnRole" | "workflowId"
>;

export interface ThreadLineageGroup<T extends LineageGroupable = Thread> {
  parentThread: T | null;
  parentThreadId: string;
  workers: T[];
  workflowId: string | undefined;
}

export function groupThreadsByLineage<T extends LineageGroupable>(
  threads: readonly T[],
): {
  groups: ThreadLineageGroup<T>[];
  ungrouped: T[];
} {
  const workersByParent = new Map<string, T[]>();
  const threadById = new Map<string, T>();
  const groupedThreadIds = new Set<string>();

  for (const thread of threads) {
    threadById.set(thread.id, thread);
  }

  for (const thread of threads) {
    const parentId = thread.parentThreadId ?? thread.orchestratorThreadId;
    if (parentId && thread.spawnRole === "worker") {
      const existing = workersByParent.get(parentId) ?? [];
      existing.push(thread);
      workersByParent.set(parentId, existing);
      groupedThreadIds.add(thread.id);
    }
  }

  const groups: ThreadLineageGroup<T>[] = [];
  for (const [parentId, workers] of workersByParent) {
    const parentThread = threadById.get(parentId) ?? null;
    if (parentThread) {
      groupedThreadIds.add(parentThread.id);
    }
    groups.push({
      parentThread,
      parentThreadId: parentId,
      workers: workers.toSorted(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
      workflowId: workers[0]?.workflowId,
    });
  }

  const ungrouped = threads.filter((t) => !groupedThreadIds.has(t.id));
  return { groups, ungrouped };
}

export function threadHasLineage(
  thread: Pick<
    Thread,
    "orchestratorProjectId" | "orchestratorThreadId" | "parentThreadId" | "spawnRole" | "workflowId"
  >,
): boolean {
  return !!(
    thread.orchestratorProjectId ||
    thread.orchestratorThreadId ||
    thread.parentThreadId ||
    thread.spawnRole ||
    thread.workflowId
  );
}

export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly SidebarThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & SidebarThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
