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
import { isThreadRuntimeActive } from "../Sidebar.logic";
import { collapseThreadToCanonicalProject } from "~/lib/orchestrationMode";
import type { CtoAttentionItem, Program, ProgramNotification, Project, Thread } from "~/types";

export type SidebarNotificationSection = "attention" | "program-update";
export type SidebarWorkerWakeState = "pending" | "delivering" | null;
export type SidebarAgentRuntimeState =
  | "inspectable"
  | "pending-worktree"
  | "transient"
  | "stale-lineage";

type SidebarRuntimeMetadata = {
  runtimeState: SidebarAgentRuntimeState;
  runtimeStateMessage: string | null;
  worktreePathHint: string | null;
};

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

export interface SidebarWorkerNode extends SidebarRuntimeMetadata {
  activityAt: string | null;
  archivedAt: string | null;
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string;
  isActiveNow: boolean;
  isHistorical: boolean;
  provenanceLabel: string;
  thread: Thread | null;
  title: string;
  wakeState: SidebarWorkerWakeState;
}

export type SidebarProgramLaneState = "active" | "no-active-lane";

export interface SidebarProgramLaneNode extends SidebarRuntimeMetadata {
  activityAt: string | null;
  archivedAt: string | null;
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string | null;
  isActiveNow: boolean;
  isHistorical: boolean;
  thread: Thread | null;
  title: string;
  workerCount: number;
  workers: SidebarWorkerNode[];
}

export interface SidebarHistoricalLaneNode {
  archivedAt: string | null;
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string;
  thread: Thread | null;
  title: string;
}

export interface SidebarProgramNode {
  activityAt: string | null;
  attentionCount: number;
  currentLane: SidebarProgramLaneNode | null;
  executiveProjectId: string | null;
  executiveThreadId: string | null;
  historicalOrchestratorCount: number;
  historicalLanes: SidebarProgramLaneNode[];
  historicalOrchestratorThreadIds: string[];
  historicalWorkerCount: number;
  historicalWorkerThreadIds: string[];
  id: string;
  isActiveNow: boolean;
  laneState: SidebarProgramLaneState;
  lastHistoricalLane: SidebarHistoricalLaneNode | null;
  status: string;
  title: string;
}

export interface SidebarExecutiveNode extends SidebarRuntimeMetadata {
  activityAt: string | null;
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string;
  isActiveNow: boolean;
  label: string;
  projectId: string | null;
  programs: SidebarProgramNode[];
  threadId: string | null;
  thread: Thread | null;
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

type SidebarAgentAuthorityThread = Pick<Thread, "id" | "latestTurn" | "session" | "worktreePath">;

type SidebarAgentAuthoritySummary = Pick<
  SessionWorkerThreadSummary,
  "id" | "latestTurn" | "session" | "worktreePath"
>;

type SidebarLineageSpawnRole = "orchestrator" | "worker" | null;

type SidebarProgramLineageEntry = {
  archivedAt: string | null;
  createdAt: string | null;
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  id: string;
  orchestratorThreadId: string | null;
  projectId: string | null;
  spawnRole: SidebarLineageSpawnRole;
  thread: Thread | null;
  title: string | null;
  updatedAt: string | null;
};

type MirrorDiagnosticsLike = {
  divergentProgramIds?: readonly string[];
  missingProgramIds?: readonly string[];
  missingProjectIds?: readonly string[];
  missingThreadIds?: readonly string[];
  staleMirror?: boolean;
};

type SidebarThreadActivitySource = {
  archivedAt?: string | null | undefined;
  createdAt?: string | null | undefined;
  latestTurn?:
    | {
        completedAt?: string | null | undefined;
        requestedAt?: string | null | undefined;
        startedAt?: string | null | undefined;
      }
    | null
    | undefined;
  session?:
    | {
        status?: string | undefined;
        updatedAt?: string | null | undefined;
      }
    | null
    | undefined;
  updatedAt?: string | null | undefined;
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

function toSortableTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function maxIsoTimestamp(values: readonly (string | null | undefined)[]): string | null {
  let bestValue: string | null = null;
  let bestTimestamp = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const timestamp = toSortableTimestamp(value);
    if (timestamp === null) {
      continue;
    }
    if (
      timestamp > bestTimestamp ||
      (timestamp === bestTimestamp && value !== null && value !== undefined)
    ) {
      bestTimestamp = timestamp;
      bestValue = value ?? null;
    }
  }
  return bestValue;
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

function resolveThreadActivityAt(
  thread: SidebarThreadActivitySource | null | undefined,
): string | null {
  if (!thread) {
    return null;
  }
  return maxIsoTimestamp([
    thread.session?.updatedAt,
    thread.latestTurn?.completedAt,
    thread.latestTurn?.startedAt,
    thread.latestTurn?.requestedAt,
    thread.archivedAt,
    thread.updatedAt,
    thread.createdAt,
  ]);
}

function isThreadLikeActive(
  thread: Pick<SidebarThreadActivitySource, "latestTurn" | "session"> | null | undefined,
): boolean {
  if (!thread) {
    return false;
  }
  return isThreadRuntimeActive({
    latestTurn: thread.latestTurn ?? null,
    session: thread.session ?? null,
  } as Parameters<typeof isThreadRuntimeActive>[0]);
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

function hasSqliteGraphSource(
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null,
): sqliteGraph is ServerGetAgentsVxappSidebarGraphResult & { source: "sqlite" } {
  return sqliteGraph?.source === "sqlite";
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

function buildSqliteThreadLinkById(
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null,
): Map<string, ServerAgentsVxappSidebarThreadLink> {
  return new Map(
    (hasSqliteGraphSource(sqliteGraph) ? sqliteGraph.threadLinks : [])
      .filter((thread) => thread.deletedAt === null)
      .map((thread) => [thread.threadId, thread] as const),
  );
}

function buildExecutiveAuthorityByProjectId(input: {
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
}): Map<
  string,
  {
    fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
    threadId: string;
  }
> {
  if (!hasSqliteGraphSource(input.sqliteGraph)) {
    return new Map();
  }

  const sqliteThreadLinkById = buildSqliteThreadLinkById(input.sqliteGraph);
  const threadIdsByProjectId = new Map<string, Set<string>>();

  for (const program of input.sqliteGraph.programs) {
    if (
      program.deletedAt !== null ||
      program.executiveProjectId === null ||
      program.executiveThreadId === null
    ) {
      continue;
    }
    const existing = threadIdsByProjectId.get(program.executiveProjectId);
    if (existing) {
      existing.add(program.executiveThreadId);
      continue;
    }
    threadIdsByProjectId.set(program.executiveProjectId, new Set([program.executiveThreadId]));
  }

  const authorityByProjectId = new Map<
    string,
    {
      fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
      threadId: string;
    }
  >();
  for (const [projectId, threadIds] of threadIdsByProjectId) {
    if (threadIds.size !== 1) {
      continue;
    }
    const threadId = [...threadIds][0];
    if (!threadId) {
      continue;
    }
    authorityByProjectId.set(projectId, {
      fallbackThreadLink: sqliteThreadLinkById.get(threadId) ?? null,
      threadId,
    });
  }
  return authorityByProjectId;
}

function resolveExecutiveAuthority(input: {
  executiveAuthority: {
    fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
    threadId: string;
  } | null;
  executiveProjectId: string | null;
  executiveThreadId: string | null;
  projectById: ReadonlyMap<string, Project>;
  threadLinkById: ReadonlyMap<string, ServerAgentsVxappSidebarThreadLink>;
}): {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  threadId: string | null;
} {
  const projectRootThreadId =
    input.executiveProjectId !== null
      ? (input.projectById.get(input.executiveProjectId)?.currentSessionRootThreadId ?? null)
      : null;
  const resolvedThreadId =
    projectRootThreadId ?? input.executiveAuthority?.threadId ?? input.executiveThreadId;
  if (!resolvedThreadId) {
    return {
      fallbackThreadLink: null,
      threadId: null,
    };
  }
  const fallbackThreadLink =
    input.threadLinkById.get(resolvedThreadId) ??
    (input.executiveAuthority?.threadId === resolvedThreadId
      ? input.executiveAuthority.fallbackThreadLink
      : null) ??
    null;
  return {
    fallbackThreadLink,
    threadId: resolvedThreadId,
  };
}

function buildLiveThreadById(input: { threads: readonly Thread[] }): Map<string, Thread> {
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  return threadById;
}

function normalizeLineageSpawnRole(value: string | null | undefined): SidebarLineageSpawnRole {
  return value === "orchestrator" || value === "worker" ? value : null;
}

function buildProgramLineageEntries(input: {
  programId: string;
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
  threads: readonly Thread[];
}): SidebarProgramLineageEntry[] {
  const entriesById = new Map<string, SidebarProgramLineageEntry>();

  const mergeEntry = (entry: SidebarProgramLineageEntry) => {
    const existing = entriesById.get(entry.id);
    if (!existing) {
      entriesById.set(entry.id, entry);
      return;
    }
    entriesById.set(entry.id, {
      archivedAt: entry.archivedAt ?? existing.archivedAt,
      createdAt: entry.createdAt ?? existing.createdAt,
      fallbackThreadLink: entry.fallbackThreadLink ?? existing.fallbackThreadLink,
      id: entry.id,
      orchestratorThreadId: entry.orchestratorThreadId ?? existing.orchestratorThreadId,
      projectId: entry.projectId ?? existing.projectId,
      spawnRole: entry.spawnRole ?? existing.spawnRole,
      thread: entry.thread ?? existing.thread,
      title: entry.title ?? existing.title,
      updatedAt: entry.updatedAt ?? existing.updatedAt,
    });
  };

  if (shouldUseSqliteGraph(input.sqliteGraph)) {
    for (const threadLink of input.sqliteGraph.threadLinks) {
      if (threadLink.deletedAt !== null || threadLink.programId !== input.programId) {
        continue;
      }
      mergeEntry({
        archivedAt: threadLink.archivedAt,
        createdAt: threadLink.createdAt,
        fallbackThreadLink: threadLink,
        id: threadLink.threadId,
        orchestratorThreadId: threadLink.orchestratorThreadId,
        projectId: threadLink.projectId,
        spawnRole: normalizeLineageSpawnRole(threadLink.spawnRole),
        thread: null,
        title: threadLink.title,
        updatedAt: threadLink.updatedAt,
      });
    }
  }

  for (const thread of input.threads) {
    if (thread.programId !== input.programId) {
      continue;
    }
    mergeEntry({
      archivedAt: thread.archivedAt,
      createdAt: thread.createdAt,
      fallbackThreadLink: null,
      id: thread.id,
      orchestratorThreadId: thread.orchestratorThreadId ?? null,
      projectId: thread.projectId,
      spawnRole: normalizeLineageSpawnRole(thread.spawnRole),
      thread,
      title: thread.title,
      updatedAt: thread.updatedAt ?? thread.createdAt,
    });
  }

  return [...entriesById.values()];
}

function getProgramList(input: {
  programs: readonly Program[];
  sqliteGraph: ServerGetAgentsVxappSidebarGraphResult | null;
}): ReadonlyArray<Program | ServerAgentsVxappSidebarProgram> {
  const visiblePrograms = shouldUseSqliteGraph(input.sqliteGraph)
    ? input.sqliteGraph.programs
    : input.programs;
  return visiblePrograms.filter((program) => program.deletedAt === null);
}

function resolveLineageRecency(entry: SidebarProgramLineageEntry): string {
  return (
    maxIsoTimestamp([
      resolveThreadActivityAt(entry.thread),
      resolveThreadActivityAt(entry.fallbackThreadLink),
      entry.archivedAt,
      entry.updatedAt,
      entry.createdAt,
    ]) ?? ""
  );
}

function resolveLineageTitle(input: {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  programTitle: string;
  projectById: ReadonlyMap<string, Project>;
  thread: Thread | null;
}): string {
  const currentProjectName = input.thread
    ? (input.projectById.get(input.thread.projectId)?.name ?? null)
    : null;
  const fallbackProjectName = input.fallbackThreadLink?.projectId
    ? (input.projectById.get(input.fallbackThreadLink.projectId)?.name ?? null)
    : null;
  const roleSessionName =
    resolveRoleSessionName(input.thread?.worktreePath) ??
    resolveRoleSessionName(input.fallbackThreadLink?.worktreePath) ??
    resolveRoleSessionName(input.fallbackThreadLink?.workspaceRoot);
  const cleanedCurrentTitle = stripAgentPrefix(input.thread?.title);
  const cleanedFallbackTitle = stripAgentPrefix(input.fallbackThreadLink?.title);

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

function isTransientAgentThread(
  thread: SidebarAgentAuthorityThread | SidebarAgentAuthoritySummary,
): boolean {
  return isTransientWorkerThread(thread);
}

function classifyWorkerRuntime(input: {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  label: string;
  sessionThread?: SidebarAgentAuthoritySummary | null;
  thread: SidebarAgentAuthorityThread | null;
}): SidebarRuntimeMetadata {
  const authoritativeThread = input.thread ?? input.sessionThread ?? null;
  const worktreePath =
    authoritativeThread?.worktreePath ?? input.fallbackThreadLink?.worktreePath ?? null;
  if (worktreePath) {
    return {
      runtimeState: "inspectable",
      runtimeStateMessage: null,
      worktreePathHint: worktreePath,
    };
  }
  if (authoritativeThread) {
    if (isTransientAgentThread(authoritativeThread)) {
      return {
        runtimeState: "transient",
        runtimeStateMessage: `This ${input.label} appears to be a transient dispatch/runtime entry with no prepared worktree or runtime bundle.`,
        worktreePathHint: null,
      };
    }
    return {
      runtimeState: "pending-worktree",
      runtimeStateMessage: `Thread '${authoritativeThread.id}' has no worktree path yet.`,
      worktreePathHint: null,
    };
  }
  if (input.fallbackThreadLink) {
    return {
      runtimeState: "stale-lineage",
      runtimeStateMessage: `This ${input.label} is only present in fallback sqlite lineage data and is unavailable in the current T3 projection.`,
      worktreePathHint: input.fallbackThreadLink.worktreePath ?? null,
    };
  }
  return {
    runtimeState: "stale-lineage",
    runtimeStateMessage: `This ${input.label} is unavailable in the current T3 projection.`,
    worktreePathHint: null,
  };
}

function classifyRoleRuntime(input: {
  fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
  label: string;
  sessionThread?: SidebarAgentAuthoritySummary | null;
  thread: SidebarAgentAuthorityThread | null;
}): SidebarRuntimeMetadata {
  const authoritativeThread = input.thread ?? input.sessionThread ?? null;
  if (authoritativeThread) {
    return {
      runtimeState: "inspectable",
      runtimeStateMessage: null,
      worktreePathHint:
        authoritativeThread.worktreePath ?? input.fallbackThreadLink?.worktreePath ?? null,
    };
  }
  if (input.fallbackThreadLink) {
    return {
      runtimeState: "stale-lineage",
      runtimeStateMessage: `This ${input.label} is only present in fallback sqlite lineage data and is unavailable in the current T3 projection.`,
      worktreePathHint: input.fallbackThreadLink.worktreePath ?? null,
    };
  }
  return {
    runtimeState: "stale-lineage",
    runtimeStateMessage: `This ${input.label} is unavailable in the current T3 projection.`,
    worktreePathHint: null,
  };
}

function compareByRecentActivity(input: {
  leftActivityAt: string | null;
  leftActive: boolean;
  leftTieBreaker: string;
  rightActivityAt: string | null;
  rightActive: boolean;
  rightTieBreaker: string;
}): number {
  if (input.leftActive !== input.rightActive) {
    return input.leftActive ? -1 : 1;
  }

  const leftTimestamp = toSortableTimestamp(input.leftActivityAt) ?? Number.NEGATIVE_INFINITY;
  const rightTimestamp = toSortableTimestamp(input.rightActivityAt) ?? Number.NEGATIVE_INFINITY;
  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return input.leftTieBreaker.localeCompare(input.rightTieBreaker);
}

function sortExecutives(executives: SidebarExecutiveNode[]): SidebarExecutiveNode[] {
  return [...executives].toSorted((left, right) => {
    if ((left.projectId === null) !== (right.projectId === null)) {
      return left.projectId === null ? 1 : -1;
    }
    return (
      compareByRecentActivity({
        leftActive: left.isActiveNow,
        leftActivityAt: left.activityAt,
        leftTieBreaker: `${left.label}:${left.id}`,
        rightActive: right.isActiveNow,
        rightActivityAt: right.activityAt,
        rightTieBreaker: `${right.label}:${right.id}`,
      }) ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id)
    );
  });
}

function sortPrograms(programs: SidebarProgramNode[]): SidebarProgramNode[] {
  return [...programs].toSorted(
    (left, right) =>
      compareByRecentActivity({
        leftActive: left.isActiveNow,
        leftActivityAt: left.activityAt,
        leftTieBreaker: `${left.title}:${left.id}`,
        rightActive: right.isActiveNow,
        rightActivityAt: right.activityAt,
        rightTieBreaker: `${right.title}:${right.id}`,
      }) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

function sortProgramLanes(lanes: SidebarProgramLaneNode[]): SidebarProgramLaneNode[] {
  return [...lanes].toSorted(
    (left, right) =>
      compareByRecentActivity({
        leftActive: left.isActiveNow,
        leftActivityAt: left.activityAt,
        leftTieBreaker: `${left.title}:${left.id ?? "unknown"}`,
        rightActive: right.isActiveNow,
        rightActivityAt: right.activityAt,
        rightTieBreaker: `${right.title}:${right.id ?? "unknown"}`,
      }) ||
      left.title.localeCompare(right.title) ||
      (left.id ?? "").localeCompare(right.id ?? ""),
  );
}

function sortWorkers(workers: SidebarWorkerNode[]): SidebarWorkerNode[] {
  return [...workers].toSorted(
    (left, right) =>
      compareByRecentActivity({
        leftActive: left.isActiveNow,
        leftActivityAt: left.activityAt,
        leftTieBreaker: `${left.title}:${left.id}`,
        rightActive: right.isActiveNow,
        rightActivityAt: right.activityAt,
        rightTieBreaker: `${right.title}:${right.id}`,
      }) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
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
  const executiveAuthorityByProjectId = buildExecutiveAuthorityByProjectId({
    sqliteGraph: input.sqliteGraph,
  });
  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));
  const executivesById = new Map<string, SidebarExecutiveNode>();

  for (const program of getProgramList(input)) {
    const executiveProjectId = program.executiveProjectId ?? null;
    const executiveThreadId = program.executiveThreadId ?? null;
    const executiveAuthority =
      executiveProjectId !== null
        ? (executiveAuthorityByProjectId.get(executiveProjectId) ?? null)
        : null;
    const resolvedExecutiveAuthority = resolveExecutiveAuthority({
      executiveAuthority,
      executiveProjectId,
      executiveThreadId,
      projectById,
      threadLinkById,
    });
    const resolvedExecutiveThreadId = resolvedExecutiveAuthority.threadId;
    const executiveKey = executiveProjectId ?? "unassigned-executive";
    const executiveLabel =
      (executiveProjectId ? projectById.get(executiveProjectId)?.name : null) ??
      "Unassigned Executive";

    let executive = executivesById.get(executiveKey);
    if (!executive) {
      const executiveThread = resolvedExecutiveThreadId
        ? (liveThreadById.get(resolvedExecutiveThreadId) ?? null)
        : null;
      const executiveFallbackThreadLink = resolvedExecutiveAuthority.fallbackThreadLink;
      const runtime = classifyRoleRuntime({
        fallbackThreadLink: executiveFallbackThreadLink,
        label: "executive thread",
        thread: executiveThread,
      });
      executive = {
        activityAt: null,
        fallbackThreadLink: executiveFallbackThreadLink,
        id: executiveKey,
        isActiveNow: false,
        label: executiveLabel,
        projectId: executiveProjectId,
        programs: [],
        runtimeState: runtime.runtimeState,
        runtimeStateMessage: runtime.runtimeStateMessage,
        threadId: resolvedExecutiveThreadId,
        thread: executiveThread,
        notifications: [],
        worktreePathHint: runtime.worktreePathHint,
      };
      executivesById.set(executiveKey, executive);
    } else if (
      resolvedExecutiveThreadId !== null &&
      executive.threadId !== resolvedExecutiveThreadId
    ) {
      executive.threadId = resolvedExecutiveThreadId;
      executive.thread = liveThreadById.get(resolvedExecutiveThreadId) ?? null;
      executive.fallbackThreadLink = resolvedExecutiveAuthority.fallbackThreadLink;
      const runtime = classifyRoleRuntime({
        fallbackThreadLink: executive.fallbackThreadLink,
        label: "executive thread",
        thread: executive.thread,
      });
      executive.runtimeState = runtime.runtimeState;
      executive.runtimeStateMessage = runtime.runtimeStateMessage;
      executive.worktreePathHint = runtime.worktreePathHint;
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
    const lineageEntries = buildProgramLineageEntries({
      programId: program.id,
      sqliteGraph: input.sqliteGraph,
      threads: input.threads,
    });
    const historicalOrchestratorEntries = lineageEntries
      .filter((entry) => entry.spawnRole === "orchestrator" && entry.id !== currentRootThreadId)
      .toSorted(
        (left, right) =>
          resolveLineageRecency(right).localeCompare(resolveLineageRecency(left)) ||
          right.id.localeCompare(left.id),
      );

    const buildWorkerNode = (inputWorker: {
      archivedAt: string | null;
      fallbackThreadLink: ServerAgentsVxappSidebarThreadLink | null;
      id: string;
      isHistorical: boolean;
      sessionThread: SessionWorkerThreadSummary | null;
      thread: Thread | null;
    }): SidebarWorkerNode => {
      const runtime = classifyWorkerRuntime({
        fallbackThreadLink: inputWorker.fallbackThreadLink,
        label: "worker row",
        sessionThread: inputWorker.sessionThread,
        thread: inputWorker.thread,
      });
      const authoritativeThread = inputWorker.thread ?? inputWorker.sessionThread;
      const activityAt =
        resolveThreadActivityAt(authoritativeThread) ??
        resolveThreadActivityAt(inputWorker.fallbackThreadLink) ??
        inputWorker.archivedAt;
      return {
        activityAt,
        archivedAt: inputWorker.archivedAt,
        fallbackThreadLink: inputWorker.fallbackThreadLink,
        id: inputWorker.id,
        isActiveNow:
          !inputWorker.isHistorical &&
          inputWorker.archivedAt === null &&
          isThreadLikeActive(authoritativeThread ?? inputWorker.fallbackThreadLink),
        isHistorical: inputWorker.isHistorical,
        provenanceLabel: resolveProvenanceLabel({
          fallbackThreadLink: inputWorker.fallbackThreadLink,
          projects: input.projects,
          sessionThread: inputWorker.sessionThread,
          thread: inputWorker.thread,
        }),
        runtimeState: runtime.runtimeState,
        runtimeStateMessage: runtime.runtimeStateMessage,
        thread: inputWorker.thread,
        title:
          stripAgentPrefix(inputWorker.thread?.title) ??
          stripAgentPrefix(inputWorker.sessionThread?.title) ??
          stripAgentPrefix(inputWorker.fallbackThreadLink?.title) ??
          inputWorker.thread?.title ??
          inputWorker.sessionThread?.title ??
          inputWorker.fallbackThreadLink?.title ??
          "Worker",
        wakeState: wakeStateByThreadId.get(inputWorker.id) ?? null,
        worktreePathHint: runtime.worktreePathHint,
      };
    };

    const workers = sortWorkers(
      workerIds.map<SidebarWorkerNode>((workerId) => {
        const thread = liveThreadById.get(workerId) ?? null;
        const sessionThread = sessionWorkerThreadById.get(workerId) ?? null;
        const fallbackThreadLink = threadLinkById.get(workerId) ?? null;
        return buildWorkerNode({
          archivedAt: thread?.archivedAt ?? fallbackThreadLink?.archivedAt ?? null,
          fallbackThreadLink,
          id: workerId,
          isHistorical: false,
          sessionThread,
          thread,
        });
      }),
    );

    const historicalWorkerEntries = lineageEntries.filter(
      (entry) =>
        entry.spawnRole === "worker" &&
        (currentRootThreadId === null || entry.orchestratorThreadId !== currentRootThreadId),
    );
    const historicalWorkersByLaneId = new Map<string, SidebarProgramLineageEntry[]>();
    for (const workerEntry of historicalWorkerEntries) {
      const laneId = workerEntry.orchestratorThreadId ?? `historical-lane:${workerEntry.id}`;
      const existing = historicalWorkersByLaneId.get(laneId);
      if (existing) {
        existing.push(workerEntry);
      } else {
        historicalWorkersByLaneId.set(laneId, [workerEntry]);
      }
    }

    const historicalLaneEntryById = new Map(
      historicalOrchestratorEntries.map((entry) => [entry.id, entry] as const),
    );
    const historicalLaneIds = [
      ...new Set([
        ...historicalOrchestratorEntries.map((entry) => entry.id),
        ...historicalWorkersByLaneId.keys(),
      ]),
    ];
    const historicalLanes = sortProgramLanes(
      historicalLaneIds.flatMap<SidebarProgramLaneNode>((laneId) => {
        const laneEntry = historicalLaneEntryById.get(laneId) ?? null;
        const laneThread = laneEntry?.thread ?? liveThreadById.get(laneId) ?? null;
        const laneFallbackThreadLink =
          laneEntry?.fallbackThreadLink ?? threadLinkById.get(laneId) ?? null;
        const runtime = classifyRoleRuntime({
          fallbackThreadLink: laneFallbackThreadLink,
          label: "orchestrator lane",
          thread: laneThread,
        });
        const historicalLaneWorkers = sortWorkers(
          (historicalWorkersByLaneId.get(laneId) ?? []).map((workerEntry) =>
            buildWorkerNode({
              archivedAt: workerEntry.archivedAt ?? workerEntry.thread?.archivedAt ?? null,
              fallbackThreadLink:
                workerEntry.fallbackThreadLink ?? threadLinkById.get(workerEntry.id) ?? null,
              id: workerEntry.id,
              isHistorical: true,
              sessionThread: null,
              thread: workerEntry.thread ?? liveThreadById.get(workerEntry.id) ?? null,
            }),
          ),
        );
        if (historicalLaneWorkers.length === 0) {
          return [];
        }
        return [
          {
            activityAt:
              maxIsoTimestamp([
                resolveThreadActivityAt(laneThread),
                resolveThreadActivityAt(laneFallbackThreadLink),
                laneEntry?.archivedAt,
                laneEntry?.updatedAt,
                ...historicalLaneWorkers.map((worker) => worker.activityAt),
              ]) ?? null,
            archivedAt:
              laneEntry?.archivedAt ??
              laneThread?.archivedAt ??
              laneFallbackThreadLink?.archivedAt ??
              null,
            fallbackThreadLink: laneFallbackThreadLink,
            id: laneId,
            isActiveNow: false,
            isHistorical: true,
            runtimeState: runtime.runtimeState,
            runtimeStateMessage: runtime.runtimeStateMessage,
            thread: laneThread,
            title:
              laneEntry !== null || laneFallbackThreadLink !== null || laneThread !== null
                ? resolveLineageTitle({
                    fallbackThreadLink: laneFallbackThreadLink,
                    programTitle: program.title,
                    projectById,
                    thread: laneThread,
                  })
                : "Historical lane",
            workerCount: historicalLaneWorkers.length,
            workers: historicalLaneWorkers,
            worktreePathHint: runtime.worktreePathHint,
          },
        ];
      }),
    );
    const historicalWorkerThreadIds = historicalLanes.flatMap((lane) =>
      lane.workers.map((worker) => worker.id),
    );
    const historicalOrchestratorThreadIds = historicalLanes
      .map((lane) => lane.id)
      .filter((laneId): laneId is string => laneId !== null);
    const latestHistoricalLaneEntry = historicalLanes[0] ?? null;

    const programItems = notificationsByProgramId.get(program.id) ?? [];
    const currentLane =
      currentRootThreadId === null
        ? null
        : (() => {
            const runtime = classifyRoleRuntime({
              fallbackThreadLink: fallbackRootThreadLink,
              label: "orchestrator lane",
              thread: currentRootThread,
            });
            return {
              activityAt:
                maxIsoTimestamp([
                  resolveThreadActivityAt(currentRootThread),
                  resolveThreadActivityAt(fallbackRootThreadLink),
                ]) ?? null,
              archivedAt:
                currentRootThread?.archivedAt ?? fallbackRootThreadLink?.archivedAt ?? null,
              fallbackThreadLink: fallbackRootThreadLink,
              id: currentRootThreadId,
              isActiveNow: isThreadLikeActive(currentRootThread ?? fallbackRootThreadLink),
              isHistorical: false,
              runtimeState: runtime.runtimeState,
              runtimeStateMessage: runtime.runtimeStateMessage,
              thread: currentRootThread,
              title: resolveLineageTitle({
                fallbackThreadLink: fallbackRootThreadLink,
                programTitle: program.title,
                projectById,
                thread: currentRootThread,
              }),
              workerCount: workers.length,
              workers,
              worktreePathHint: runtime.worktreePathHint,
            };
          })();
    const programActivityAt =
      maxIsoTimestamp([
        program.updatedAt,
        currentLane?.activityAt,
        ...workers.map((worker) => worker.activityAt),
        ...historicalLanes.map((lane) => lane.activityAt),
      ]) ?? null;
    const programNode: SidebarProgramNode = {
      activityAt: programActivityAt,
      attentionCount: programItems.filter((item) => item.section === "attention").length,
      currentLane,
      executiveProjectId,
      executiveThreadId,
      historicalLanes,
      historicalOrchestratorCount: historicalLanes.length,
      historicalOrchestratorThreadIds,
      historicalWorkerCount: historicalWorkerThreadIds.length,
      historicalWorkerThreadIds,
      id: program.id,
      isActiveNow:
        currentLane?.isActiveNow === true ||
        currentLane?.workers.some((worker) => worker.isActiveNow) === true ||
        historicalLanes.some(
          (lane) => lane.isActiveNow || lane.workers.some((worker) => worker.isActiveNow),
        ),
      laneState: currentRootThreadId === null ? "no-active-lane" : "active",
      lastHistoricalLane:
        latestHistoricalLaneEntry === null
          ? null
          : {
              archivedAt: latestHistoricalLaneEntry.archivedAt,
              fallbackThreadLink: latestHistoricalLaneEntry.fallbackThreadLink,
              id: latestHistoricalLaneEntry.id ?? "",
              thread: latestHistoricalLaneEntry.thread,
              title: latestHistoricalLaneEntry.title,
            },
      status: program.status,
      title: program.title,
    };
    executive.programs.push(programNode);
  }

  const executives = sortExecutives(
    [...executivesById.values()].map((executive) => {
      const activityAt =
        maxIsoTimestamp([
          resolveThreadActivityAt(executive.thread),
          resolveThreadActivityAt(executive.fallbackThreadLink),
          ...executive.programs.map((program) => program.activityAt),
        ]) ?? null;
      const nextExecutive: SidebarExecutiveNode = {
        activityAt,
        fallbackThreadLink: executive.fallbackThreadLink,
        id: executive.id,
        isActiveNow:
          isThreadLikeActive(executive.thread ?? executive.fallbackThreadLink) ||
          executive.programs.some((program) => program.isActiveNow),
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
        runtimeState: executive.runtimeState,
        runtimeStateMessage: executive.runtimeStateMessage,
        threadId: executive.threadId,
        thread: executive.thread,
        worktreePathHint: executive.worktreePathHint,
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
