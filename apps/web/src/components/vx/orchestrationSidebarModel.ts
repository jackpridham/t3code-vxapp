import type {
  OrchestratorWakeItem,
  OrchestrationThreadSummary,
  ServerAgentsVxappSidebarAttentionItem,
  ServerAgentsVxappSidebarProgram,
  ServerAgentsVxappSidebarProgramNotification,
  ServerAgentsVxappSidebarThreadLink,
  ServerGetAgentsVxappSidebarGraphResult,
  ThreadId,
} from "@t3tools/contracts";
import { collapseThreadToCanonicalProject } from "~/lib/orchestrationMode";
import type { CtoAttentionItem, Program, ProgramNotification, Project, Thread } from "~/types";

export type SidebarNotificationSection = "attention" | "program-update";
export type SidebarWorkerWakeState = "pending" | "delivering" | null;
export type SidebarWorkerRuntimeState =
  | "inspectable"
  | "pending-worktree"
  | "transient"
  | "stale-lineage";

export interface SidebarNotificationItem {
  id: string;
  executiveProjectId: string | null;
  executiveThreadId: string | null;
  programId: string | null;
  kind: string;
  queuedAt: string | null;
  section: SidebarNotificationSection;
  severity: "critical" | "warning" | "info";
  sourceThreadId: string | null;
  summary: string;
}

export interface SidebarWorkerNode {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string;
  provenanceLabel: string;
  runtimeState: SidebarWorkerRuntimeState;
  runtimeStateMessage: string | null;
  thread: Thread | null;
  title: string;
  wakeState: SidebarWorkerWakeState;
  worktreePathHint: string | null;
}

export interface SidebarOrchestratorNode {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string | null;
  thread: Thread | null;
  title: string;
  workerCount: number;
  workers: SidebarWorkerNode[];
}

export interface SidebarProgramNode {
  attentionCount: number;
  executiveProjectId: string | null;
  executiveThreadId: string | null;
  id: string;
  orchestrator: SidebarOrchestratorNode | null;
  status: string;
  title: string;
}

export interface SidebarExecutiveNode {
  id: string;
  label: string;
  projectId: string | null;
  programs: SidebarProgramNode[];
  threadId: string | null;
  notifications: SidebarNotificationItem[];
}

export interface OrchestrationSidebarDiagnostics {
  divergentProgramIds: string[];
  missingProgramIds: string[];
  missingProjectIds: string[];
  missingThreadIds: string[];
  staleMirror: boolean;
}

export interface OrchestrationSidebarModel {
  diagnostics: OrchestrationSidebarDiagnostics;
  executives: SidebarExecutiveNode[];
  source: ServerGetAgentsVxappSidebarGraphResult["source"] | "t3";
}

type SessionWorkerThreadSummary = Pick<
  OrchestrationThreadSummary,
  | "id"
  | "latestTurn"
  | "orchestratorProjectId"
  | "projectId"
  | "session"
  | "spawnRole"
  | "title"
  | "worktreePath"
>;

type SidebarWorkerAuthorityThread = Pick<
  Thread,
  "id" | "latestTurn" | "session" | "spawnRole" | "worktreePath"
>;

type SidebarWorkerAuthoritySummary = Pick<
  SessionWorkerThreadSummary,
  "id" | "latestTurn" | "session" | "spawnRole" | "worktreePath"
>;

type MirrorDiagnosticsLike = {
  divergentProgramIds?: readonly string[];
  missingProgramIds?: readonly string[];
  missingProjectIds?: readonly string[];
  missingThreadIds?: readonly string[];
  staleMirror?: boolean;
};

function normalizeStringIdList(value: readonly string[] | undefined): string[] {
  return Array.isArray(value) ? [...value] : [];
}

function normalizeMirrorDiagnostics(
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null,
): OrchestrationSidebarDiagnostics {
  if (sqliteGraph?.source !== "sqlite") {
    return {
      divergentProgramIds: [],
      missingProgramIds: [],
      missingProjectIds: [],
      missingThreadIds: [],
      staleMirror: false,
    };
  }
  const mirrorDiagnostics = sqliteGraph.mirrorDiagnostics as MirrorDiagnosticsLike;
  return {
    divergentProgramIds: normalizeStringIdList(mirrorDiagnostics.divergentProgramIds).toSorted(),
    missingProgramIds: normalizeStringIdList(mirrorDiagnostics.missingProgramIds).toSorted(),
    missingProjectIds: normalizeStringIdList(mirrorDiagnostics.missingProjectIds).toSorted(),
    missingThreadIds: normalizeStringIdList(mirrorDiagnostics.missingThreadIds).toSorted(),
    staleMirror: mirrorDiagnostics.staleMirror === true,
  };
}

function stripAgentPrefix(title: string | null | undefined): string | null {
  if (!title) {
    return null;
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^(worker|orchestrator)\/[^\s]+\s+/i, "").trim();
}

function toTitleCase(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function resolveRoleSessionName(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replaceAll("\\", "/");
  const match = normalized.match(/\/role-sessions\/([^/]+)\/[^/]+\/workspace$/);
  return match?.[1] ? toTitleCase(match[1]) : null;
}

function basename(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const segments = value.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

function normalizeStoreNotification(
  notification: ProgramNotification,
): SidebarNotificationItem | null {
  if (notification.state === "consumed" || notification.state === "dropped") {
    return null;
  }
  return {
    id: notification.notificationId,
    executiveProjectId: notification.executiveProjectId,
    executiveThreadId: notification.executiveThreadId,
    programId: notification.programId,
    kind: notification.kind,
    queuedAt: notification.queuedAt,
    section: "program-update",
    severity: notification.severity,
    sourceThreadId: notification.orchestratorThreadId,
    summary: notification.summary,
  };
}

function normalizeSqliteNotification(
  notification: ServerAgentsVxappSidebarProgramNotification,
): SidebarNotificationItem | null {
  if (notification.state === "consumed" || notification.state === "dropped") {
    return null;
  }
  return {
    id: notification.notificationId,
    executiveProjectId: notification.executiveProjectId,
    executiveThreadId: notification.executiveThreadId,
    programId: notification.programId,
    kind: notification.kind,
    queuedAt: notification.queuedAt,
    section: "program-update",
    severity: notification.severity,
    sourceThreadId: notification.orchestratorThreadId,
    summary: notification.summary,
  };
}

function normalizeStoreAttention(item: CtoAttentionItem): SidebarNotificationItem | null {
  if (item.state !== "required") {
    return null;
  }
  return {
    id: item.attentionId,
    executiveProjectId: item.executiveProjectId,
    executiveThreadId: item.executiveThreadId,
    programId: item.programId,
    kind: item.kind,
    queuedAt: item.queuedAt,
    section: "attention",
    severity: item.severity,
    sourceThreadId: item.sourceThreadId,
    summary: item.summary,
  };
}

function normalizeSqliteAttention(
  item: ServerAgentsVxappSidebarAttentionItem,
): SidebarNotificationItem | null {
  if (item.state !== "required") {
    return null;
  }
  return {
    id: item.attentionId,
    executiveProjectId: item.executiveProjectId,
    executiveThreadId: item.executiveThreadId,
    programId: item.programId,
    kind: item.kind,
    queuedAt: item.queuedAt,
    section: "attention",
    severity: item.severity,
    sourceThreadId: item.sourceThreadId,
    summary: item.summary,
  };
}

function getNotificationItems(input: {
  ctoAttentionItems: readonly CtoAttentionItem[];
  programNotifications: readonly ProgramNotification[];
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
}): SidebarNotificationItem[] {
  const mergedById = new Map<string, SidebarNotificationItem>();
  const addItems = (items: ReadonlyArray<SidebarNotificationItem | null>) => {
    for (const item of items) {
      if (item !== null) {
        mergedById.set(item.id, item);
      }
    }
  };

  if (shouldUseSqliteGraph(input.sqliteGraph)) {
    addItems(input.sqliteGraph.attentionItems.map(normalizeSqliteAttention));
    addItems(input.sqliteGraph.notifications.map(normalizeSqliteNotification));
  }

  addItems(input.ctoAttentionItems.map(normalizeStoreAttention));
  addItems(input.programNotifications.map(normalizeStoreNotification));

  return [...mergedById.values()];
}

function buildWakeStateByThreadId(input: {
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
  wakeItems: readonly OrchestratorWakeItem[];
}): Map<string, SidebarWorkerWakeState> {
  const stateByThreadId = new Map<string, SidebarWorkerWakeState>();

  if (shouldUseSqliteGraph(input.sqliteGraph)) {
    for (const wake of input.sqliteGraph.openWakes) {
      const workerThreadId = wake.payload?.workerThreadId;
      if (typeof workerThreadId !== "string") {
        continue;
      }
      if (wake.state === "delivering") {
        stateByThreadId.set(workerThreadId, "delivering");
        continue;
      }
      if (!stateByThreadId.has(workerThreadId)) {
        stateByThreadId.set(workerThreadId, "pending");
      }
    }
    return stateByThreadId;
  }

  for (const wake of input.wakeItems) {
    if (wake.state === "delivering") {
      stateByThreadId.set(wake.workerThreadId, "delivering");
      continue;
    }
    if (wake.state === "pending" && !stateByThreadId.has(wake.workerThreadId)) {
      stateByThreadId.set(wake.workerThreadId, "pending");
    }
  }
  return stateByThreadId;
}

function shouldUseSqliteGraph(
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null,
): sqliteGraph is ServerGetAgentsVxappSidebarGraphResult & { source: "sqlite" } {
  return (
    sqliteGraph?.source === "sqlite" &&
    normalizeMirrorDiagnostics(sqliteGraph).staleMirror === false
  );
}

function resolveProvenanceLabel(input: {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  projects: readonly Project[];
  sessionThread: SessionWorkerThreadSummary | null;
  thread: Thread | null;
}): string {
  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));

  if (input.thread) {
    return collapseThreadToCanonicalProject({
      thread: input.thread,
      projects: input.projects,
    }).canonicalProjectName;
  }

  if (input.sessionThread) {
    return collapseThreadToCanonicalProject({
      thread: input.sessionThread,
      projects: input.projects,
    }).canonicalProjectName;
  }

  if (input.fallbackThreadLink?.projectId) {
    const project = projectById.get(input.fallbackThreadLink.projectId);
    if (project) {
      const parentProject =
        project.sidebarParentProjectId && project.sidebarParentProjectId !== project.id
          ? projectById.get(project.sidebarParentProjectId)
          : null;
      return parentProject?.name ?? project.name;
    }
  }

  return (
    basename(input.fallbackThreadLink?.worktreePath) ??
    basename(input.fallbackThreadLink?.workspaceRoot) ??
    "worker"
  );
}

function buildThreadLinkById(
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null,
): Map<string, ServerAgentsVxappSidebarThreadLink> {
  return new Map(
    (shouldUseSqliteGraph(sqliteGraph) ? sqliteGraph.threadLinks : []).map(
      (thread) => [thread.threadId, thread] as const,
    ),
  );
}

function buildLiveThreadById(input: { threads: readonly Thread[] }): Map<string, Thread> {
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  return threadById;
}

function getProgramList(input: {
  programs: readonly Program[];
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
}): ReadonlyArray<Program | ServerAgentsVxappSidebarProgram> {
  if (shouldUseSqliteGraph(input.sqliteGraph) && input.sqliteGraph.programs.length > 0) {
    return input.sqliteGraph.programs;
  }
  return input.programs;
}

export function resolveSidebarRootThreadIds(input: {
  programs: readonly Program[];
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
}): ThreadId[] {
  return [
    ...new Set(
      getProgramList(input)
        .map((program) => program.currentOrchestratorThreadId)
        .filter((threadId): threadId is ThreadId => threadId !== null),
    ),
  ];
}

function isTransientWorkerThread(
  thread: SidebarWorkerAuthorityThread | SidebarWorkerAuthoritySummary,
): boolean {
  if (thread.worktreePath) {
    return false;
  }
  const sessionStatus = thread.session?.status ?? null;
  const latestTurnState = thread.latestTurn?.state ?? null;
  const sessionLooksDormant =
    sessionStatus === null ||
    sessionStatus === "idle" ||
    sessionStatus === "ready" ||
    sessionStatus === "stopped" ||
    sessionStatus === "interrupted";
  return sessionLooksDormant && latestTurnState === null;
}

function classifyWorkerRuntime(input: {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  sessionThread: SessionWorkerThreadSummary | null;
  thread: Thread | null;
}): Pick<SidebarWorkerNode, "runtimeState" | "runtimeStateMessage"> {
  const authoritativeThread = input.thread ?? input.sessionThread;
  const worktreePath =
    authoritativeThread?.worktreePath ?? input.fallbackThreadLink?.worktreePath ?? null;
  if (worktreePath) {
    return {
      runtimeState: "inspectable",
      runtimeStateMessage: null,
    };
  }
  if (authoritativeThread) {
    if (isTransientWorkerThread(authoritativeThread)) {
      return {
        runtimeState: "transient",
        runtimeStateMessage:
          "This worker row appears to be a transient dispatch/runtime entry with no prepared worktree or runtime bundle.",
      };
    }
    return {
      runtimeState: "pending-worktree",
      runtimeStateMessage: `Worker thread '${authoritativeThread.id}' has no worktree path yet.`,
    };
  }
  if (input.fallbackThreadLink) {
    return {
      runtimeState: "stale-lineage",
      runtimeStateMessage:
        "This worker row is only present in fallback sqlite lineage data and is unavailable in the current T3 projection.",
    };
  }
  return {
    runtimeState: "stale-lineage",
    runtimeStateMessage: "This worker is unavailable in the current T3 projection.",
  };
}

function sortExecutives(executives: SidebarExecutiveNode[]): SidebarExecutiveNode[] {
  const assigned = executives
    .filter((executive) => executive.projectId !== null)
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const unassigned = executives
    .filter((executive) => executive.projectId === null)
    .toSorted((left, right) => left.label.localeCompare(right.label));
  return [...assigned, ...unassigned];
}

function sortPrograms(programs: SidebarProgramNode[]): SidebarProgramNode[] {
  return [...programs].toSorted((left, right) => left.title.localeCompare(right.title));
}

function sortNotifications(items: SidebarNotificationItem[]): SidebarNotificationItem[] {
  const severityRank: Record<SidebarNotificationItem["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...items].toSorted((left, right) => {
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return (right.queuedAt ?? "").localeCompare(left.queuedAt ?? "");
  });
}

function resolveOrchestratorTitle(input: {
  currentRootThread: Thread | null;
  fallbackRootThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  programTitle: string;
  projectById: ReadonlyMap<string, Project>;
}): string {
  const currentProjectName = input.currentRootThread
    ? (input.projectById.get(input.currentRootThread.projectId)?.name ?? null)
    : null;
  const fallbackProjectName = input.fallbackRootThreadLink?.projectId
    ? (input.projectById.get(input.fallbackRootThreadLink.projectId)?.name ?? null)
    : null;
  const roleSessionName =
    resolveRoleSessionName(input.currentRootThread?.worktreePath) ??
    resolveRoleSessionName(input.fallbackRootThreadLink?.worktreePath) ??
    resolveRoleSessionName(input.fallbackRootThreadLink?.workspaceRoot);
  const cleanedCurrentTitle = stripAgentPrefix(input.currentRootThread?.title);
  const cleanedFallbackTitle = stripAgentPrefix(input.fallbackRootThreadLink?.title);

  if (roleSessionName) {
    return roleSessionName;
  }
  if (currentProjectName && currentProjectName.trim().toLowerCase() !== "workspace") {
    return currentProjectName;
  }
  if (fallbackProjectName && fallbackProjectName.trim().toLowerCase() !== "workspace") {
    return fallbackProjectName;
  }
  if (cleanedCurrentTitle && cleanedCurrentTitle !== input.programTitle) {
    return cleanedCurrentTitle;
  }
  if (cleanedFallbackTitle && cleanedFallbackTitle !== input.programTitle) {
    return cleanedFallbackTitle;
  }
  return (
    cleanedCurrentTitle ??
    cleanedFallbackTitle ??
    currentProjectName ??
    fallbackProjectName ??
    "Orchestrator"
  );
}

export function buildOrchestrationSidebarModel(input: {
  ctoAttentionItems: readonly CtoAttentionItem[];
  programNotifications: readonly ProgramNotification[];
  programs: readonly Program[];
  projects: readonly Project[];
  sessionWorkerThreadsByRootId: ReadonlyMap<string, readonly SessionWorkerThreadSummary[]>;
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
  threads: readonly Thread[];
  wakeItems: readonly OrchestratorWakeItem[];
}): OrchestrationSidebarModel {
  const threadLinkById = buildThreadLinkById(input.sqliteGraph);
  const liveThreadById = buildLiveThreadById({ threads: input.threads });
  const notifications = getNotificationItems(input);
  const notificationsByProgramId = new Map<string, SidebarNotificationItem[]>();
  for (const notification of notifications) {
    if (!notification.programId) {
      continue;
    }
    const existing = notificationsByProgramId.get(notification.programId);
    if (existing) {
      existing.push(notification);
    } else {
      notificationsByProgramId.set(notification.programId, [notification]);
    }
  }
  const wakeStateByThreadId = buildWakeStateByThreadId({
    sqliteGraph: input.sqliteGraph,
    wakeItems: input.wakeItems,
  });
  const usableSqliteGraph = shouldUseSqliteGraph(input.sqliteGraph) ? input.sqliteGraph : null;
  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));
  const executivesById = new Map<string, SidebarExecutiveNode>();

  for (const program of getProgramList(input)) {
    const executiveProjectId = program.executiveProjectId ?? null;
    const executiveThreadId = program.executiveThreadId ?? null;
    const executiveKey = executiveProjectId ?? "unassigned-executive";
    const executiveLabel =
      (executiveProjectId ? projectById.get(executiveProjectId)?.name : null) ??
      "Unassigned Executive";

    let executive = executivesById.get(executiveKey);
    if (!executive) {
      executive = {
        id: executiveKey,
        label: executiveLabel,
        projectId: executiveProjectId,
        programs: [],
        threadId: executiveThreadId,
        notifications: [],
      };
      executivesById.set(executiveKey, executive);
    } else if (executive.threadId === null && executiveThreadId !== null) {
      executive.threadId = executiveThreadId;
    }

    const currentRootThreadId = program.currentOrchestratorThreadId ?? null;
    const currentRootThread = currentRootThreadId
      ? (liveThreadById.get(currentRootThreadId) ?? null)
      : null;
    const fallbackRootThreadLink = currentRootThreadId
      ? (threadLinkById.get(currentRootThreadId) ?? null)
      : null;

    const sessionWorkerThreads = currentRootThreadId
      ? (input.sessionWorkerThreadsByRootId.get(currentRootThreadId) ?? [])
      : [];
    const liveWorkerIds = input.threads
      .filter(
        (thread) =>
          thread.spawnRole === "worker" && thread.orchestratorThreadId === currentRootThreadId,
      )
      .map((thread) => thread.id);
    const workerIds = [
      ...new Set([...liveWorkerIds, ...sessionWorkerThreads.map((thread) => thread.id)]),
    ];
    const sessionWorkerThreadById = new Map(
      sessionWorkerThreads.map((thread) => [thread.id, thread] as const),
    );

    const workers = workerIds.map<SidebarWorkerNode>((workerId) => {
      const thread = liveThreadById.get(workerId) ?? null;
      const sessionThread = sessionWorkerThreadById.get(workerId) ?? null;
      const fallbackThreadLink = threadLinkById.get(workerId) ?? null;
      const runtime = classifyWorkerRuntime({
        fallbackThreadLink,
        sessionThread,
        thread,
      });
      return {
        fallbackThreadLink,
        id: workerId,
        provenanceLabel: resolveProvenanceLabel({
          fallbackThreadLink,
          projects: input.projects,
          sessionThread,
          thread,
        }),
        runtimeState: runtime.runtimeState,
        runtimeStateMessage: runtime.runtimeStateMessage,
        thread,
        title:
          stripAgentPrefix(thread?.title) ??
          stripAgentPrefix(sessionThread?.title) ??
          stripAgentPrefix(fallbackThreadLink?.title) ??
          thread?.title ??
          sessionThread?.title ??
          fallbackThreadLink?.title ??
          "Worker",
        wakeState: wakeStateByThreadId.get(workerId) ?? null,
        worktreePathHint:
          thread?.worktreePath ??
          sessionThread?.worktreePath ??
          fallbackThreadLink?.worktreePath ??
          null,
      };
    });

    const programItems = notificationsByProgramId.get(program.id) ?? [];
    const programNode: SidebarProgramNode = {
      attentionCount: programItems.filter((item) => item.section === "attention").length,
      executiveProjectId,
      executiveThreadId,
      id: program.id,
      orchestrator:
        currentRootThreadId === null
          ? null
          : {
              fallbackThreadLink: fallbackRootThreadLink,
              id: currentRootThreadId,
              thread: currentRootThread,
              title: resolveOrchestratorTitle({
                currentRootThread,
                fallbackRootThreadLink,
                programTitle: program.title,
                projectById,
              }),
              workerCount: workers.length,
              workers,
            },
      status: program.status,
      title: program.title,
    };
    executive.programs.push(programNode);
  }

  const executives = sortExecutives(
    [...executivesById.values()].map((executive) => {
      const nextExecutive: SidebarExecutiveNode = {
        id: executive.id,
        label: executive.label,
        notifications: sortNotifications(
          notifications.filter((item) => {
            if (executive.projectId) {
              return item.executiveProjectId === executive.projectId;
            }
            return item.executiveProjectId === null;
          }),
        ),
        programs: sortPrograms(executive.programs),
        projectId: executive.projectId,
        threadId: executive.threadId,
      };
      return nextExecutive;
    }),
  );

  const diagnostics = normalizeMirrorDiagnostics(input.sqliteGraph);

  return {
    diagnostics,
    executives,
    source: usableSqliteGraph ? "sqlite" : "t3",
  };
}
