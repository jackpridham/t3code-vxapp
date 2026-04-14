import {
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestratorWakeItem,
  type ProviderKind,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationCheckpointSummary,
  type OrchestrationThread,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import { resolveModelSlugForProvider } from "@t3tools/shared/model";
import { create } from "zustand";
import {
  type ChatMessage,
  type PersistedFileChange,
  type Project,
  type Thread,
  type TurnDiffSummary,
} from "./types";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  orchestratorWakeItems: OrchestratorWakeItem[];
  bootstrapComplete: boolean;
}

const initialState: AppState = {
  projects: [],
  threads: [],
  orchestratorWakeItems: [],
  bootstrapComplete: false,
};
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
const MAX_THREAD_PROPOSED_PLANS = 200;
const MAX_THREAD_ACTIVITIES = 500;

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function updateProject(
  projects: Project[],
  projectId: Project["id"],
  updater: (project: Project) => Project,
): Project[] {
  let changed = false;
  const next = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }
    const updated = updater(project);
    if (updated !== project) {
      changed = true;
    }
    return updated;
  });
  return changed ? next : projects;
}

function mergeProjects(
  existingProjects: Project[],
  incomingProjects: ReadonlyArray<OrchestrationReadModel["projects"][number]>,
): Project[] {
  const nextProjects = [...existingProjects];
  const indexByProjectId = new Map(
    nextProjects.map((project, index) => [project.id, index] as const),
  );

  for (const project of incomingProjects) {
    const existingIndex = indexByProjectId.get(project.id);
    if (project.deletedAt !== null) {
      if (existingIndex === undefined) {
        continue;
      }
      nextProjects.splice(existingIndex, 1);
      indexByProjectId.clear();
      nextProjects.forEach((entry, index) => indexByProjectId.set(entry.id, index));
      continue;
    }

    const mappedProject = mapProject(project);
    if (existingIndex === undefined) {
      indexByProjectId.set(mappedProject.id, nextProjects.push(mappedProject) - 1);
      continue;
    }
    nextProjects[existingIndex] = mappedProject;
  }

  return nextProjects;
}

function normalizeModelSelection<T extends { provider: "codex" | "claudeAgent"; model: string }>(
  selection: T,
): T {
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.provider, selection.model),
  };
}

function mapProjectScripts(scripts: ReadonlyArray<Project["scripts"][number]>): Project["scripts"] {
  return scripts.map((script) => ({ ...script }));
}

function mapProjectHooks(hooks: ReadonlyArray<Project["hooks"][number]>): Project["hooks"] {
  return hooks.map((hook) => ({
    ...hook,
    selectors: {
      providers: [...hook.selectors.providers],
      interactionModes: [...hook.selectors.interactionModes],
      runtimeModes: [...hook.selectors.runtimeModes],
      turnStates: [...hook.selectors.turnStates],
    },
    ...("output" in hook
      ? {
          output: {
            ...hook.output,
          },
        }
      : {}),
  }));
}

type OrchestrationThreadWithLabels = OrchestrationThread & {
  labels?: readonly string[] | undefined;
};

function mapThreadLabels(labels?: readonly string[] | null): string[] {
  return [...(labels ?? [])];
}

function mapSession(session: OrchestrationSession): Thread["session"] {
  return {
    provider: toLegacyProvider(session.providerName),
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

function mapMessage(message: OrchestrationMessage): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

function mapProposedPlan(proposedPlan: OrchestrationProposedPlan): Thread["proposedPlans"][number] {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

function mapTurnDiffSummary(
  checkpoint: OrchestrationCheckpointSummary,
): Thread["turnDiffSummaries"][number] {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}

/**
 * Build the cumulative file-change list from all turn diff summaries.
 * Each file path gets a single entry with aggregated insertions/deletions
 * and first/last turn ids for provenance.
 */
export function accumulateFileChanges(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
): PersistedFileChange[] {
  const byPath = new Map<string, PersistedFileChange>();

  for (const summary of turnDiffSummaries) {
    if (summary.status === "missing" || summary.status === "error") continue;
    for (const file of summary.files) {
      const existing = byPath.get(file.path);
      if (existing) {
        existing.totalInsertions += file.additions ?? 0;
        existing.totalDeletions += file.deletions ?? 0;
        existing.lastTurnId = summary.turnId;
        // Upgrade kind: if a file was "added" then "modified", keep "added"
        if (file.kind === "deleted") {
          existing.kind = "deleted";
        } else if (existing.kind !== "added" && file.kind) {
          existing.kind = file.kind;
        }
      } else {
        byPath.set(file.path, {
          path: file.path,
          kind: file.kind,
          totalInsertions: file.additions ?? 0,
          totalDeletions: file.deletions ?? 0,
          firstTurnId: summary.turnId,
          lastTurnId: summary.turnId,
        });
      }
    }
  }

  return Array.from(byPath.values());
}

function mapOrchestratorWakeItem(wakeItem: OrchestratorWakeItem): OrchestratorWakeItem {
  return { ...wakeItem };
}

function mapThread(thread: OrchestrationThreadWithLabels): Thread {
  return {
    id: thread.id,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    labels: mapThreadLabels(thread.labels),
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session: thread.session ? mapSession(thread.session) : null,
    messages: thread.messages.map(mapMessage),
    proposedPlans: thread.proposedPlans.map(mapProposedPlan),
    error: thread.session?.lastError ?? null,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    turnDiffSummaries: thread.checkpoints.map(mapTurnDiffSummary),
    persistedFileChanges: accumulateFileChanges(thread.checkpoints.map(mapTurnDiffSummary)),
    activities: thread.activities.map((activity) => ({ ...activity })),
    snapshotCoverage: thread.snapshotCoverage,
    // Lineage metadata
    orchestratorProjectId: thread.orchestratorProjectId,
    orchestratorThreadId: thread.orchestratorThreadId,
    parentThreadId: thread.parentThreadId,
    spawnRole: thread.spawnRole,
    spawnedBy: thread.spawnedBy,
    workflowId: thread.workflowId,
  };
}

function mapProject(project: OrchestrationReadModel["projects"][number]): Project {
  return {
    id: project.id,
    name: project.title,
    cwd: project.workspaceRoot,
    kind: project.kind,
    sidebarParentProjectId: project.sidebarParentProjectId,
    currentSessionRootThreadId: project.currentSessionRootThreadId,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
    hooks: mapProjectHooks(project.hooks),
  };
}

function mergeThreads(
  existingThreads: Thread[],
  incomingThreads: ReadonlyArray<OrchestrationReadModel["threads"][number]>,
  snapshotProfile: OrchestrationReadModel["snapshotProfile"],
): Thread[] {
  const nextThreads = [...existingThreads];
  const indexByThreadId = new Map(nextThreads.map((thread, index) => [thread.id, index] as const));

  for (const thread of incomingThreads) {
    const existingIndex = indexByThreadId.get(thread.id);
    if (thread.deletedAt !== null) {
      if (existingIndex === undefined) {
        continue;
      }
      nextThreads.splice(existingIndex, 1);
      indexByThreadId.clear();
      nextThreads.forEach((entry, index) => indexByThreadId.set(entry.id, index));
      continue;
    }

    const mappedThread = mapThread(thread as OrchestrationThreadWithLabels);
    if (existingIndex === undefined) {
      indexByThreadId.set(mappedThread.id, nextThreads.push(mappedThread) - 1);
      continue;
    }
    const existingThread = nextThreads[existingIndex];
    const coverage = thread.snapshotCoverage;
    const preservesSummaryDetail =
      snapshotProfile === "bootstrap-summary" && coverage === undefined;
    const preservesMessages = preservesSummaryDetail || coverage?.messageLimit === 0;
    const preservesProposedPlans = preservesSummaryDetail || coverage?.proposedPlanLimit === 0;
    const preservesActivities = preservesSummaryDetail || coverage?.activityLimit === 0;
    const preservesCheckpoints = preservesSummaryDetail || coverage?.checkpointLimit === 0;
    nextThreads[existingIndex] =
      existingThread &&
      (preservesMessages || preservesProposedPlans || preservesActivities || preservesCheckpoints)
        ? {
            ...mappedThread,
            messages: preservesMessages ? existingThread.messages : mappedThread.messages,
            proposedPlans: preservesProposedPlans
              ? existingThread.proposedPlans
              : mappedThread.proposedPlans,
            turnDiffSummaries: preservesCheckpoints
              ? existingThread.turnDiffSummaries
              : mappedThread.turnDiffSummaries,
            persistedFileChanges: preservesCheckpoints
              ? existingThread.persistedFileChanges
              : mappedThread.persistedFileChanges,
            activities: preservesActivities ? existingThread.activities : mappedThread.activities,
            snapshotCoverage:
              preservesMessages &&
              preservesProposedPlans &&
              preservesActivities &&
              preservesCheckpoints
                ? existingThread.snapshotCoverage
                : mappedThread.snapshotCoverage,
          }
        : mappedThread;
  }

  return nextThreads;
}

function isPartialReadModel(readModel: OrchestrationReadModel): boolean {
  return (
    readModel.snapshotProfile === "bootstrap-summary" ||
    readModel.snapshotProfile === "active-thread"
  );
}

function checkpointStatusToLatestTurnState(
  status: "ready" | "missing" | "error",
  existingLatestTurn?: Thread["latestTurn"],
) {
  if (status === "error") {
    return "error" as const;
  }
  if (status === "missing") {
    if (existingLatestTurn?.state === "running") {
      return "running" as const;
    }
    return "interrupted" as const;
  }
  return "completed" as const;
}

function compareActivities(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Thread["pendingSourceProposedPlan"];
}): NonNullable<Thread["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<Thread["turnDiffSummaries"][number]>,
  turnId: Thread["turnDiffSummaries"][number]["turnId"],
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"],
): Thread["turnDiffSummaries"] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<Thread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): Thread["activities"] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<Thread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): Thread["proposedPlans"] {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === "codex" || providerName === "claudeAgent") {
    return providerName;
  }
  return "codex";
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = isPartialReadModel(readModel)
    ? mergeProjects(state.projects, readModel.projects)
    : readModel.projects.filter((project) => project.deletedAt === null).map(mapProject);
  const threads = isPartialReadModel(readModel)
    ? mergeThreads(state.threads, readModel.threads, readModel.snapshotProfile)
    : readModel.threads
        .filter((thread) => thread.deletedAt === null)
        .map((thread) => mapThread(thread as OrchestrationThreadWithLabels));
  return {
    ...state,
    projects,
    threads,
    orchestratorWakeItems: readModel.orchestratorWakeItems.map(mapOrchestratorWakeItem),
    bootstrapComplete: true,
  };
}

export function applyOrchestrationEvent(state: AppState, event: OrchestrationEvent): AppState {
  switch (event.type) {
    case "project.created": {
      const existingIndex = state.projects.findIndex(
        (project) =>
          project.id === event.payload.projectId || project.cwd === event.payload.workspaceRoot,
      );
      const nextProject = mapProject({
        id: event.payload.projectId,
        title: event.payload.title,
        workspaceRoot: event.payload.workspaceRoot,
        kind: event.payload.kind,
        sidebarParentProjectId: event.payload.sidebarParentProjectId,
        currentSessionRootThreadId: event.payload.currentSessionRootThreadId,
        defaultModelSelection: event.payload.defaultModelSelection,
        scripts: event.payload.scripts,
        hooks: event.payload.hooks,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
        deletedAt: null,
      });
      const projects =
        existingIndex >= 0
          ? state.projects.map((project, index) =>
              index === existingIndex ? nextProject : project,
            )
          : [...state.projects, nextProject];
      return { ...state, projects };
    }

    case "project.meta-updated": {
      const projects = updateProject(state.projects, event.payload.projectId, (project) => ({
        ...project,
        ...(event.payload.title !== undefined ? { name: event.payload.title } : {}),
        ...(event.payload.workspaceRoot !== undefined ? { cwd: event.payload.workspaceRoot } : {}),
        ...(event.payload.kind !== undefined ? { kind: event.payload.kind } : {}),
        ...(event.payload.sidebarParentProjectId !== undefined
          ? { sidebarParentProjectId: event.payload.sidebarParentProjectId }
          : {}),
        ...(event.payload.currentSessionRootThreadId !== undefined
          ? { currentSessionRootThreadId: event.payload.currentSessionRootThreadId }
          : {}),
        ...(event.payload.defaultModelSelection !== undefined
          ? {
              defaultModelSelection: event.payload.defaultModelSelection
                ? normalizeModelSelection(event.payload.defaultModelSelection)
                : null,
            }
          : {}),
        ...(event.payload.scripts !== undefined
          ? { scripts: mapProjectScripts(event.payload.scripts) }
          : {}),
        ...(event.payload.hooks !== undefined
          ? { hooks: mapProjectHooks(event.payload.hooks) }
          : {}),
        updatedAt: event.payload.updatedAt,
      }));
      return projects === state.projects ? state : { ...state, projects };
    }

    case "project.deleted": {
      const projects = state.projects.filter((project) => project.id !== event.payload.projectId);
      return projects.length === state.projects.length ? state : { ...state, projects };
    }

    case "thread.created": {
      const existing = state.threads.find((thread) => thread.id === event.payload.threadId);
      const threadLabels = (event.payload as { labels?: readonly string[] | undefined }).labels;
      const nextThread = mapThread({
        id: event.payload.threadId,
        projectId: event.payload.projectId,
        title: event.payload.title,
        labels: mapThreadLabels(threadLabels ?? []),
        modelSelection: event.payload.modelSelection,
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        branch: event.payload.branch,
        worktreePath: event.payload.worktreePath,
        latestTurn: null,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        orchestratorProjectId: event.payload.orchestratorProjectId,
        orchestratorThreadId: event.payload.orchestratorThreadId,
        parentThreadId: event.payload.parentThreadId,
        spawnRole: event.payload.spawnRole,
        spawnedBy: event.payload.spawnedBy,
        workflowId: event.payload.workflowId,
      });
      const threads = existing
        ? state.threads.map((thread) => (thread.id === nextThread.id ? nextThread : thread))
        : [...state.threads, nextThread];
      return { ...state, threads };
    }

    case "thread.deleted": {
      const threads = state.threads.filter((thread) => thread.id !== event.payload.threadId);
      return threads.length === state.threads.length ? state : { ...state, threads };
    }

    case "thread.archived": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.unarchived": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: null,
        updatedAt: event.payload.updatedAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.meta-updated": {
      const threadLabels = (event.payload as { labels?: readonly string[] | undefined }).labels;
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(threadLabels !== undefined ? { labels: mapThreadLabels(threadLabels) } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined
          ? { worktreePath: event.payload.worktreePath }
          : {}),
        ...(event.payload.orchestratorProjectId !== undefined
          ? { orchestratorProjectId: event.payload.orchestratorProjectId }
          : {}),
        ...(event.payload.orchestratorThreadId !== undefined
          ? { orchestratorThreadId: event.payload.orchestratorThreadId }
          : {}),
        ...(event.payload.parentThreadId !== undefined
          ? { parentThreadId: event.payload.parentThreadId }
          : {}),
        ...(event.payload.spawnRole !== undefined ? { spawnRole: event.payload.spawnRole } : {}),
        ...(event.payload.spawnedBy !== undefined ? { spawnedBy: event.payload.spawnedBy } : {}),
        ...(event.payload.workflowId !== undefined ? { workflowId: event.payload.workflowId } : {}),
        updatedAt: event.payload.updatedAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.runtime-mode-set": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.interaction-mode-set": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.turn-start-requested": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        pendingSourceProposedPlan: event.payload.sourceProposedPlan,
        updatedAt: event.occurredAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.turn-interrupt-requested": {
      if (event.payload.turnId === undefined) {
        return state;
      }
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => {
        const latestTurn = thread.latestTurn;
        if (latestTurn === null || latestTurn.turnId !== event.payload.turnId) {
          return thread;
        }
        return {
          ...thread,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: event.payload.turnId,
            state: "interrupted",
            requestedAt: latestTurn.requestedAt,
            startedAt: latestTurn.startedAt ?? event.payload.createdAt,
            completedAt: latestTurn.completedAt ?? event.payload.createdAt,
            assistantMessageId: latestTurn.assistantMessageId,
          }),
          updatedAt: event.occurredAt,
        };
      });
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.message-sent": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => {
        const message = mapMessage({
          id: event.payload.messageId,
          role: event.payload.role,
          text: event.payload.text,
          ...(event.payload.attachments !== undefined
            ? { attachments: event.payload.attachments }
            : {}),
          turnId: event.payload.turnId,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        });
        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id !== message.id
                ? entry
                : {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
                    ...(message.streaming
                      ? entry.completedAt !== undefined
                        ? { completedAt: entry.completedAt }
                        : {}
                      : message.completedAt !== undefined
                        ? { completedAt: message.completedAt }
                        : {}),
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  },
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);
        const turnDiffSummaries =
          event.payload.role === "assistant" && event.payload.turnId !== null
            ? rebindTurnDiffSummariesForAssistantMessage(
                thread.turnDiffSummaries,
                event.payload.turnId,
                event.payload.messageId,
              )
            : thread.turnDiffSummaries;
        const latestTurn: Thread["latestTurn"] =
          event.payload.role === "assistant" &&
          event.payload.turnId !== null &&
          (thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId)
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.turnId,
                state: event.payload.streaming
                  ? "running"
                  : thread.latestTurn?.state === "interrupted"
                    ? "interrupted"
                    : thread.latestTurn?.state === "error"
                      ? "error"
                      : "completed",
                requestedAt:
                  thread.latestTurn?.turnId === event.payload.turnId
                    ? thread.latestTurn.requestedAt
                    : event.payload.createdAt,
                startedAt:
                  thread.latestTurn?.turnId === event.payload.turnId
                    ? (thread.latestTurn.startedAt ?? event.payload.createdAt)
                    : event.payload.createdAt,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
                completedAt: event.payload.streaming
                  ? thread.latestTurn?.turnId === event.payload.turnId
                    ? (thread.latestTurn.completedAt ?? null)
                    : null
                  : event.payload.updatedAt,
                assistantMessageId: event.payload.messageId,
              })
            : thread.latestTurn;
        return {
          ...thread,
          messages: cappedMessages,
          turnDiffSummaries,
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.session-set": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => ({
        ...thread,
        session: mapSession(event.payload.session),
        error: event.payload.session.lastError ?? null,
        latestTurn:
          event.payload.session.status === "running" && event.payload.session.activeTurnId !== null
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.session.activeTurnId,
                state: "running",
                requestedAt:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? thread.latestTurn.requestedAt
                    : event.payload.session.updatedAt,
                startedAt:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? (thread.latestTurn.startedAt ?? event.payload.session.updatedAt)
                    : event.payload.session.updatedAt,
                completedAt: null,
                assistantMessageId:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? thread.latestTurn.assistantMessageId
                    : null,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
              })
            : thread.latestTurn,
        updatedAt: event.occurredAt,
      }));
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.session-stop-requested": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) =>
        thread.session === null
          ? thread
          : {
              ...thread,
              session: {
                ...thread.session,
                status: "closed",
                orchestrationStatus: "stopped",
                activeTurnId: undefined,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
      );
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.proposed-plan-upserted": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => {
        const proposedPlan = mapProposedPlan(event.payload.proposedPlan);
        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== proposedPlan.id),
          proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_PROPOSED_PLANS);
        return {
          ...thread,
          proposedPlans,
          updatedAt: event.occurredAt,
        };
      });
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.turn-diff-completed": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => {
        const checkpoint = mapTurnDiffSummary({
          turnId: event.payload.turnId,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          checkpointRef: event.payload.checkpointRef,
          status: event.payload.status,
          files: event.payload.files,
          assistantMessageId: event.payload.assistantMessageId,
          completedAt: event.payload.completedAt,
        });
        const existing = thread.turnDiffSummaries.find(
          (entry) => entry.turnId === checkpoint.turnId,
        );
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return thread;
        }
        const turnDiffSummaries = [
          ...thread.turnDiffSummaries.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const latestTurn =
          thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId
            ? (() => {
                const nextState = checkpointStatusToLatestTurnState(
                  event.payload.status,
                  thread.latestTurn,
                );
                return buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId: event.payload.turnId,
                  state: nextState,
                  requestedAt: thread.latestTurn?.requestedAt ?? event.payload.completedAt,
                  startedAt: thread.latestTurn?.startedAt ?? event.payload.completedAt,
                  completedAt:
                    nextState === "running"
                      ? (thread.latestTurn?.completedAt ?? null)
                      : event.payload.completedAt,
                  assistantMessageId: event.payload.assistantMessageId,
                  sourceProposedPlan: thread.pendingSourceProposedPlan,
                });
              })()
            : thread.latestTurn;
        return {
          ...thread,
          turnDiffSummaries,
          persistedFileChanges: accumulateFileChanges(turnDiffSummaries),
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.reverted": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => {
        const turnDiffSummaries = thread.turnDiffSummaries
          .filter(
            (entry) =>
              entry.checkpointTurnCount !== undefined &&
              entry.checkpointTurnCount <= event.payload.turnCount,
          )
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const retainedTurnIds = new Set(turnDiffSummaries.map((entry) => entry.turnId));
        const messages = retainThreadMessagesAfterRevert(
          thread.messages,
          retainedTurnIds,
          event.payload.turnCount,
        ).slice(-MAX_THREAD_MESSAGES);
        const proposedPlans = retainThreadProposedPlansAfterRevert(
          thread.proposedPlans,
          retainedTurnIds,
        ).slice(-MAX_THREAD_PROPOSED_PLANS);
        const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);
        const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

        return {
          ...thread,
          turnDiffSummaries,
          persistedFileChanges: accumulateFileChanges(turnDiffSummaries),
          messages,
          proposedPlans,
          activities,
          pendingSourceProposedPlan: undefined,
          latestTurn:
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(
                    (latestCheckpoint.status ?? "ready") as "ready" | "missing" | "error",
                  ),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                },
          updatedAt: event.occurredAt,
        };
      });
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.activity-appended": {
      const threads = updateThread(state.threads, event.payload.threadId, (thread) => {
        const activities = [
          ...thread.activities.filter((activity) => activity.id !== event.payload.activity.id),
          { ...event.payload.activity },
        ]
          .toSorted(compareActivities)
          .slice(-MAX_THREAD_ACTIVITIES);
        return {
          ...thread,
          activities,
          updatedAt: event.occurredAt,
        };
      });
      return threads === state.threads ? state : { ...state, threads };
    }

    case "thread.orchestrator-wake-upserted": {
      const orchestratorWakeItems = [
        ...state.orchestratorWakeItems.filter(
          (wakeItem) => wakeItem.wakeId !== event.payload.wakeItem.wakeId,
        ),
        mapOrchestratorWakeItem(event.payload.wakeItem),
      ].toSorted(
        (left, right) =>
          left.queuedAt.localeCompare(right.queuedAt) || left.wakeId.localeCompare(right.wakeId),
      );
      return { ...state, orchestratorWakeItems };
    }

    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
      return state;
  }

  return state;
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
): AppState {
  if (events.length === 0) {
    return state;
  }
  return events.reduce((nextState, event) => applyOrchestrationEvent(nextState, event), state);
}

export const selectProjectById =
  (projectId: Project["id"] | null | undefined) =>
  (state: AppState): Project | undefined =>
    projectId ? state.projects.find((project) => project.id === projectId) : undefined;

export const selectThreadById =
  (threadId: ThreadId | null | undefined) =>
  (state: AppState): Thread | undefined =>
    threadId ? state.threads.find((thread) => thread.id === threadId) : undefined;

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent) => void;
  applyOrchestrationEvents: (events: ReadonlyArray<OrchestrationEvent>) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...initialState,
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  applyOrchestrationEvent: (event) => set((state) => applyOrchestrationEvent(state, event)),
  applyOrchestrationEvents: (events) => set((state) => applyOrchestrationEvents(state, events)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
}));
