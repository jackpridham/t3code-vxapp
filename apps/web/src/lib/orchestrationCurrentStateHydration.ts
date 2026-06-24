import {
  type NativeApi,
  NonNegativeInt,
  type OrchestrationCheckpointSummary,
  type OrchestrationMessage,
  type OrchestrationListThreadActivitiesResult,
  type OrchestrationListThreadMessagesResult,
  type OrchestratorWakeItem,
  type ProjectId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThreadSummary,
  ThreadId,
} from "@t3tools/contracts";

const CURRENT_THREAD_HISTORY_PAGE_LIMIT = NonNegativeInt.makeUnsafe(1000);
const CURRENT_THREAD_MESSAGE_HISTORY_PAGE_LIMIT = NonNegativeInt.makeUnsafe(500);
const CURRENT_THREAD_INITIAL_HISTORY_LIMIT = NonNegativeInt.makeUnsafe(100);
const CURRENT_THREAD_WAKE_LIMIT = NonNegativeInt.makeUnsafe(100);

type ThreadHistoryMode = "full" | "initial";
type TargetedHydrationMode = "thread" | "orchestrator-session";

type TargetedThreadDetailFragment = {
  readonly found: boolean;
  readonly snapshotSequence: number;
  readonly mode: TargetedHydrationMode;
  readonly threadId: ThreadId;
  readonly projects: readonly OrchestrationReadModel["projects"][number][];
  readonly threadSummaries: readonly OrchestrationThreadSummary[];
  readonly messages: readonly OrchestrationMessage[];
  readonly activities: readonly OrchestrationListThreadActivitiesResult[number][];
  readonly sessions: readonly OrchestrationSession[];
  readonly orchestratorWakeItems: readonly OrchestratorWakeItem[];
  readonly workerCheckpointsByThreadId: ReadonlyMap<
    ThreadId,
    readonly OrchestrationCheckpointSummary[]
  >;
  readonly historyMode: ThreadHistoryMode;
  readonly includeOrchestratorWakes: boolean;
};

const inFlightThreadDetailFragments = new Map<string, Promise<TargetedThreadDetailFragment>>();

function hasThread(readModel: OrchestrationReadModel, threadId: ThreadId): boolean {
  return readModel.threads.some((thread) => thread.id === threadId);
}

function threadSummaryToReadModelThread(
  thread: OrchestrationThreadSummary,
): OrchestrationReadModel["threads"][number] {
  return {
    ...thread,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
  };
}

function isRoleAuthorityThread(thread: OrchestrationThreadSummary): boolean {
  return (
    thread.spawnRole === "supervisor" ||
    (typeof thread.worktreePath === "string" && thread.worktreePath.includes("/role-sessions/"))
  );
}

function mergeSessionThreadsIntoReadModel(
  readModel: OrchestrationReadModel,
  sessionThreads: readonly OrchestrationThreadSummary[],
): OrchestrationReadModel {
  const existingThreadIds = new Set(readModel.threads.map((thread) => thread.id));
  const missingSessionThreads = sessionThreads
    .filter((thread) => !existingThreadIds.has(thread.id))
    .map(threadSummaryToReadModelThread);
  if (missingSessionThreads.length === 0) {
    return readModel;
  }
  return {
    ...readModel,
    threads: [...readModel.threads, ...missingSessionThreads],
  };
}

function mergeProjectsIntoReadModel(
  readModel: OrchestrationReadModel,
  projects: readonly OrchestrationReadModel["projects"][number][],
): OrchestrationReadModel["projects"] {
  const mergedProjects = [...readModel.projects];
  const indexByProjectId = new Map(
    mergedProjects.map((project, index) => [project.id, index] as const),
  );
  for (const project of projects) {
    const existingIndex = indexByProjectId.get(project.id);
    if (existingIndex === undefined) {
      indexByProjectId.set(project.id, mergedProjects.push(project) - 1);
    } else {
      mergedProjects[existingIndex] = project;
    }
  }
  return mergedProjects;
}

function latestIsoDate(input: {
  baseUpdatedAt?: string | null | undefined;
  projects?: readonly OrchestrationReadModel["projects"][number][];
  threads?: readonly OrchestrationReadModel["threads"][number][];
  messages?: readonly OrchestrationMessage[];
  activities?: readonly OrchestrationListThreadActivitiesResult[number][];
  sessions?: readonly OrchestrationSession[];
  orchestratorWakeItems?: readonly OrchestratorWakeItem[];
  checkpoints?: readonly OrchestrationCheckpointSummary[];
}): string {
  const candidates = [
    input.baseUpdatedAt,
    ...(input.projects ?? []).map((project) => project.updatedAt),
    ...(input.threads ?? []).map((thread) => thread.updatedAt),
    ...(input.messages ?? []).flatMap((message) => [message.updatedAt, message.createdAt]),
    ...(input.activities ?? []).map((activity) => activity.createdAt),
    ...(input.sessions ?? []).map((session) => session.updatedAt),
    ...(input.orchestratorWakeItems ?? []).map((wake) => wake.queuedAt),
    ...(input.checkpoints ?? []).map((checkpoint) => checkpoint.completedAt),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return candidates.toSorted().at(-1) ?? new Date().toISOString();
}

function emptyActiveThreadReadModel(input: {
  snapshotSequence: number;
  updatedAt?: string | null | undefined;
}): OrchestrationReadModel {
  return {
    snapshotSequence: input.snapshotSequence,
    snapshotProfile: "active-thread",
    snapshotCoverage: {
      includeArchivedThreads: true,
      wakeItemCount: 0,
      wakeItemLimit: null,
      wakeItemsTruncated: false,
      warnings: [],
    },
    projects: [],
    programs: [],
    programNotifications: [],
    ctoAttentionItems: [],
    threads: [],
    orchestratorWakeItems: [],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

async function resolveTargetThreadSummaries(
  api: NativeApi,
  threadId: ThreadId,
  mode: TargetedHydrationMode,
): Promise<readonly OrchestrationThreadSummary[]> {
  const sessionThreads = await api.orchestration.listSessionThreads({
    rootThreadId: threadId,
    includeArchived: true,
    includeDeleted: false,
  });
  const directThread = await api.orchestration.getThreadById({ threadId });
  if (!directThread || directThread.deletedAt !== null) {
    return sessionThreads.some((thread) => thread.id === threadId && thread.deletedAt === null)
      ? sessionThreads
      : [];
  }
  const directThreadMatchesTarget = directThread.id === threadId;
  const directThreadIsRoleAuthority = isRoleAuthorityThread(directThread);
  if (mode === "thread" && directThreadMatchesTarget && directThreadIsRoleAuthority) {
    return [directThread];
  }
  if (!directThreadMatchesTarget) {
    return sessionThreads.some((thread) => thread.id === threadId && thread.deletedAt === null)
      ? sessionThreads
      : [];
  }
  const replaced = sessionThreads.map((thread) =>
    thread.id === directThread.id ? directThread : thread,
  );
  return sessionThreads.some((thread) => thread.id === directThread.id)
    ? replaced
    : [...sessionThreads, directThread];
}

async function resolveFullProjectsForThreads(
  api: NativeApi,
  threadSummaries: readonly OrchestrationThreadSummary[],
): Promise<readonly OrchestrationReadModel["projects"][number][] | null> {
  const projectIds = [...new Set(threadSummaries.map((thread) => thread.projectId))] as ProjectId[];
  const projects = await Promise.all(
    projectIds.map((projectId) => api.orchestration.getProjectFullById({ projectId })),
  );
  if (projects.some((project) => project === null)) {
    return null;
  }
  return projects.filter(
    (project): project is OrchestrationReadModel["projects"][number] => project !== null,
  );
}

function threadDetailFragmentKey(input: {
  readonly threadId: ThreadId;
  readonly mode: TargetedHydrationMode;
  readonly historyMode: ThreadHistoryMode;
  readonly includeOrchestratorWakes: boolean;
}): string {
  return JSON.stringify({
    threadId: input.threadId,
    mode: input.mode,
    historyMode: input.historyMode,
    includeOrchestratorWakes: input.includeOrchestratorWakes,
  });
}

async function fetchTargetedThreadDetailFragment(input: {
  api: NativeApi;
  threadId: ThreadId;
  mode: TargetedHydrationMode;
  historyMode: ThreadHistoryMode;
  includeOrchestratorWakes: boolean;
}): Promise<TargetedThreadDetailFragment> {
  const snapshotSequence = (await input.api.orchestration.getReadiness()).snapshotSequence;
  const threadSummaries = await resolveTargetThreadSummaries(input.api, input.threadId, input.mode);
  const resolvedMode =
    input.mode === "orchestrator-session" ||
    threadSummaries.some(
      (thread) => thread.id === input.threadId && thread.spawnRole === "orchestrator",
    )
      ? "orchestrator-session"
      : "thread";
  if (threadSummaries.length === 0) {
    return {
      found: false,
      snapshotSequence,
      mode: resolvedMode,
      threadId: input.threadId,
      projects: [],
      threadSummaries: [],
      messages: [],
      activities: [],
      sessions: [],
      orchestratorWakeItems: [],
      workerCheckpointsByThreadId: new Map(),
      historyMode: input.historyMode,
      includeOrchestratorWakes: input.includeOrchestratorWakes,
    };
  }

  const projects = await resolveFullProjectsForThreads(input.api, threadSummaries);
  if (projects === null) {
    return {
      found: false,
      snapshotSequence,
      mode: resolvedMode,
      threadId: input.threadId,
      projects: [],
      threadSummaries: [],
      messages: [],
      activities: [],
      sessions: [],
      orchestratorWakeItems: [],
      workerCheckpointsByThreadId: new Map(),
      historyMode: input.historyMode,
      includeOrchestratorWakes: input.includeOrchestratorWakes,
    };
  }

  const [messages, activities, sessions, orchestratorWakeItems] = await Promise.all([
    input.historyMode === "full"
      ? listAllThreadMessages(input.api, input.threadId)
      : listInitialThreadMessages(input.api, input.threadId),
    input.historyMode === "full"
      ? listAllThreadActivities(input.api, input.threadId)
      : listInitialThreadActivities(input.api, input.threadId),
    input.api.orchestration.listThreadSessions({ threadId: input.threadId }),
    input.includeOrchestratorWakes
      ? input.api.orchestration.listOrchestratorWakes({
          orchestratorThreadId: input.threadId,
          limit: CURRENT_THREAD_WAKE_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  const workerThreadIds =
    resolvedMode === "orchestrator-session"
      ? threadSummaries
          .filter((thread) => thread.id !== input.threadId && thread.spawnRole === "worker")
          .map((thread) => thread.id)
      : [];
  const workerCheckpointsByThreadId = new Map(
    await Promise.all(
      workerThreadIds.map(async (workerThreadId) => {
        const checkpoints = await listThreadCheckpoints(input.api, workerThreadId);
        return [workerThreadId, checkpoints] as const;
      }),
    ),
  );

  return {
    found: true,
    snapshotSequence,
    mode: resolvedMode,
    threadId: input.threadId,
    projects,
    threadSummaries,
    messages,
    activities,
    sessions,
    orchestratorWakeItems,
    workerCheckpointsByThreadId,
    historyMode: input.historyMode,
    includeOrchestratorWakes: input.includeOrchestratorWakes,
  };
}

function loadDedupedThreadDetailFragment(input: {
  api: NativeApi;
  threadId: ThreadId;
  mode: TargetedHydrationMode;
  historyMode: ThreadHistoryMode;
  includeOrchestratorWakes: boolean;
}): Promise<TargetedThreadDetailFragment> {
  const key = threadDetailFragmentKey(input);
  const existing = inFlightThreadDetailFragments.get(key);
  if (existing) {
    return existing;
  }
  const promise = fetchTargetedThreadDetailFragment(input).finally(() => {
    if (inFlightThreadDetailFragments.get(key) === promise) {
      inFlightThreadDetailFragments.delete(key);
    }
  });
  inFlightThreadDetailFragments.set(key, promise);
  return promise;
}

function mergeTargetedThreadDetailFragment(
  baseReadModel: OrchestrationReadModel | null,
  fragment: TargetedThreadDetailFragment,
): OrchestrationReadModel {
  const base =
    baseReadModel ??
    emptyActiveThreadReadModel({
      snapshotSequence: fragment.snapshotSequence,
    });
  if (!fragment.found) {
    return {
      ...base,
      snapshotSequence: Math.max(base.snapshotSequence, fragment.snapshotSequence),
      snapshotProfile: "active-thread",
      updatedAt: latestIsoDate({ baseUpdatedAt: base.updatedAt }),
    };
  }

  const mergedWithThreads = mergeSessionThreadsIntoReadModel(
    {
      ...base,
      projects: mergeProjectsIntoReadModel(base, fragment.projects),
    },
    fragment.threadSummaries,
  );
  const targetThreadSummary = fragment.threadSummaries.find(
    (thread) => thread.id === fragment.threadId,
  );
  const threads = mergedWithThreads.threads.map((thread) => {
    if (thread.id === fragment.threadId) {
      return {
        ...thread,
        messages: [...fragment.messages],
        activities: [...fragment.activities],
        session:
          targetThreadSummary && isRoleAuthorityThread(targetThreadSummary)
            ? targetThreadSummary.session
            : (fragment.sessions[0] ?? thread.session),
        snapshotCoverage: {
          messageCount: fragment.messages.length,
          messageLimit:
            fragment.historyMode === "full" ? null : CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
          messagesTruncated:
            fragment.historyMode !== "full" &&
            fragment.messages.length >= CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
          proposedPlanCount: thread.proposedPlans.length,
          proposedPlanLimit: 0,
          proposedPlansTruncated: false,
          activityCount: fragment.activities.length,
          activityLimit:
            fragment.historyMode === "full" ? null : CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
          activitiesTruncated:
            fragment.historyMode !== "full" &&
            fragment.activities.length >= CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
          checkpointCount: thread.checkpoints.length,
          checkpointLimit: fragment.mode === "orchestrator-session" ? null : 0,
          checkpointsTruncated: false,
        },
      };
    }
    const workerCheckpoints = fragment.workerCheckpointsByThreadId.get(thread.id);
    if (!workerCheckpoints) {
      return thread;
    }
    return {
      ...thread,
      checkpoints: [...workerCheckpoints],
      snapshotCoverage: {
        messageCount: thread.messages.length,
        messageLimit: thread.snapshotCoverage?.messageLimit ?? 0,
        messagesTruncated: thread.snapshotCoverage?.messagesTruncated ?? false,
        proposedPlanCount: thread.proposedPlans.length,
        proposedPlanLimit: thread.snapshotCoverage?.proposedPlanLimit ?? 0,
        proposedPlansTruncated: thread.snapshotCoverage?.proposedPlansTruncated ?? false,
        activityCount: thread.activities.length,
        activityLimit: thread.snapshotCoverage?.activityLimit ?? 0,
        activitiesTruncated: thread.snapshotCoverage?.activitiesTruncated ?? false,
        checkpointCount: workerCheckpoints.length,
        checkpointLimit: null,
        checkpointsTruncated: false,
      },
    };
  });

  return {
    ...mergedWithThreads,
    snapshotSequence: Math.max(base.snapshotSequence, fragment.snapshotSequence),
    snapshotProfile: "active-thread",
    snapshotCoverage: {
      includeArchivedThreads: true,
      wakeItemCount: fragment.includeOrchestratorWakes
        ? fragment.orchestratorWakeItems.length
        : mergedWithThreads.orchestratorWakeItems.length,
      wakeItemLimit: fragment.includeOrchestratorWakes ? CURRENT_THREAD_WAKE_LIMIT : null,
      wakeItemsTruncated:
        fragment.includeOrchestratorWakes &&
        fragment.orchestratorWakeItems.length >= CURRENT_THREAD_WAKE_LIMIT,
      warnings: [],
    },
    threads,
    orchestratorWakeItems: fragment.includeOrchestratorWakes
      ? [...fragment.orchestratorWakeItems]
      : mergedWithThreads.orchestratorWakeItems,
    updatedAt: latestIsoDate({
      baseUpdatedAt: base.updatedAt,
      projects: fragment.projects,
      threads,
      messages: fragment.messages,
      activities: fragment.activities,
      sessions: fragment.sessions,
      orchestratorWakeItems: fragment.orchestratorWakeItems,
      checkpoints: [...fragment.workerCheckpointsByThreadId.values()].flat(),
    }),
  };
}

async function listAllThreadMessages(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationListThreadMessagesResult> {
  const pages: OrchestrationListThreadMessagesResult[] = [];
  let beforeCreatedAt: string | undefined;

  for (;;) {
    const page = await api.orchestration.listThreadMessages({
      threadId,
      limit: CURRENT_THREAD_MESSAGE_HISTORY_PAGE_LIMIT,
      ...(beforeCreatedAt !== undefined ? { beforeCreatedAt } : {}),
    });
    if (page.length === 0) {
      break;
    }
    pages.unshift(page);
    if (page.length < CURRENT_THREAD_MESSAGE_HISTORY_PAGE_LIMIT) {
      break;
    }
    const oldestMessage = page[0];
    if (!oldestMessage) {
      break;
    }
    beforeCreatedAt = oldestMessage.createdAt;
  }

  return pages.flat();
}

async function listAllThreadActivities(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationListThreadActivitiesResult> {
  const pages: OrchestrationListThreadActivitiesResult[] = [];
  let beforeSequence: number | undefined;

  for (;;) {
    const page = await api.orchestration.listThreadActivities({
      threadId,
      limit: CURRENT_THREAD_HISTORY_PAGE_LIMIT,
      ...(beforeSequence !== undefined
        ? { beforeSequence: NonNegativeInt.makeUnsafe(beforeSequence) }
        : {}),
    });
    if (page.length === 0) {
      break;
    }
    pages.unshift(page);
    if (page.length < CURRENT_THREAD_HISTORY_PAGE_LIMIT) {
      break;
    }
    const oldestSequencedActivity = page.find((activity) => activity.sequence !== undefined);
    if (oldestSequencedActivity?.sequence === undefined) {
      break;
    }
    beforeSequence = oldestSequencedActivity.sequence;
  }

  const dedupedById = new Map<string, OrchestrationListThreadActivitiesResult[number]>();
  for (const activity of pages.flat()) {
    dedupedById.set(activity.id, activity);
  }
  return [...dedupedById.values()].toSorted((left, right) => {
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
  });
}

async function listInitialThreadMessages(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationListThreadMessagesResult> {
  return api.orchestration.listThreadMessages({
    threadId,
    limit: CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
  });
}

async function listInitialThreadActivities(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationListThreadActivitiesResult> {
  return api.orchestration.listThreadActivities({
    threadId,
    limit: CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
    payloadMode: "compact",
  });
}

async function listThreadCheckpoints(
  api: NativeApi,
  threadId: ThreadId,
): Promise<readonly OrchestrationCheckpointSummary[]> {
  return api.orchestration.listThreadCheckpoints({
    threadId,
    limit: CURRENT_THREAD_HISTORY_PAGE_LIMIT,
  });
}

async function ensureThreadInReadModel(
  api: NativeApi,
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  if (hasThread(readModel, threadId)) {
    return readModel;
  }

  const sessionThreads = await api.orchestration.listSessionThreads({
    rootThreadId: threadId,
    includeArchived: true,
    includeDeleted: false,
  });
  if (sessionThreads.length === 0) {
    return readModel;
  }
  return mergeSessionThreadsIntoReadModel(readModel, sessionThreads);
}

export async function addThreadDetailToReadModel(
  api: NativeApi,
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
  options: {
    includeOrchestratorWakes?: boolean;
    historyMode?: "full" | "initial";
  } = {},
): Promise<OrchestrationReadModel> {
  const includeOrchestratorWakes = options.includeOrchestratorWakes ?? true;
  const historyMode = options.historyMode ?? "full";
  const detailReadModel = await ensureThreadInReadModel(api, readModel, threadId);
  const [messages, activities, sessions, orchestratorWakeItems] = await Promise.all([
    historyMode === "full"
      ? listAllThreadMessages(api, threadId)
      : listInitialThreadMessages(api, threadId),
    historyMode === "full"
      ? listAllThreadActivities(api, threadId)
      : listInitialThreadActivities(api, threadId),
    api.orchestration.listThreadSessions({ threadId }),
    includeOrchestratorWakes
      ? api.orchestration.listOrchestratorWakes({
          orchestratorThreadId: threadId,
          limit: CURRENT_THREAD_WAKE_LIMIT,
        })
      : Promise.resolve(detailReadModel.orchestratorWakeItems),
  ]);

  const threads = [...detailReadModel.threads];
  const threadIndex = threads.findIndex((thread) => thread.id === threadId);
  const thread = threads[threadIndex];
  if (thread) {
    threads[threadIndex] = {
      ...thread,
      messages,
      activities,
      session: sessions[0] ?? thread.session,
      snapshotCoverage: {
        messageCount: messages.length,
        messageLimit: historyMode === "full" ? null : CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
        messagesTruncated:
          historyMode !== "full" && messages.length >= CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
        proposedPlanCount: thread.proposedPlans.length,
        proposedPlanLimit: 0,
        proposedPlansTruncated: false,
        activityCount: activities.length,
        activityLimit: historyMode === "full" ? null : CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
        activitiesTruncated:
          historyMode !== "full" && activities.length >= CURRENT_THREAD_INITIAL_HISTORY_LIMIT,
        checkpointCount: thread.checkpoints.length,
        checkpointLimit: 0,
        checkpointsTruncated: false,
      },
    };
  }

  return {
    ...detailReadModel,
    threads,
    orchestratorWakeItems: includeOrchestratorWakes
      ? orchestratorWakeItems
      : detailReadModel.orchestratorWakeItems,
  };
}

export async function addOrchestratorSessionWorkerDetailsToReadModel(
  api: NativeApi,
  readModel: OrchestrationReadModel,
  rootThreadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const sessionThreads = await api.orchestration.listSessionThreads({
    rootThreadId,
    includeArchived: true,
    includeDeleted: false,
  });
  const workerThreadIds = sessionThreads
    .filter((thread) => thread.id !== rootThreadId && thread.spawnRole === "worker")
    .map((thread) => thread.id);
  let nextReadModel = mergeSessionThreadsIntoReadModel(readModel, sessionThreads);

  for (const workerThreadId of workerThreadIds) {
    nextReadModel = await addThreadDetailToReadModel(api, nextReadModel, workerThreadId, {
      includeOrchestratorWakes: false,
    });
  }

  return nextReadModel;
}

export async function addOrchestratorSessionWorkerChangesToReadModel(
  api: NativeApi,
  readModel: OrchestrationReadModel,
  rootThreadId: ThreadId,
  existingSessionThreads?: readonly OrchestrationThreadSummary[],
): Promise<OrchestrationReadModel> {
  const sessionThreads =
    existingSessionThreads ??
    (await api.orchestration.listSessionThreads({
      rootThreadId,
      includeArchived: true,
      includeDeleted: false,
    }));
  const workerThreadIds = sessionThreads
    .filter((thread) => thread.id !== rootThreadId && thread.spawnRole === "worker")
    .map((thread) => thread.id);
  let nextReadModel = mergeSessionThreadsIntoReadModel(readModel, sessionThreads);
  const checkpointsByThreadId = new Map(
    await Promise.all(
      workerThreadIds.map(async (workerThreadId) => {
        const checkpoints = await listThreadCheckpoints(api, workerThreadId);
        return [workerThreadId, checkpoints] as const;
      }),
    ),
  );

  nextReadModel = {
    ...nextReadModel,
    threads: nextReadModel.threads.map((thread) => {
      if (thread.id === rootThreadId) {
        return {
          ...thread,
          snapshotCoverage: {
            messageCount: thread.messages.length,
            messageLimit: thread.snapshotCoverage?.messageLimit ?? 0,
            messagesTruncated: thread.snapshotCoverage?.messagesTruncated ?? false,
            proposedPlanCount: thread.proposedPlans.length,
            proposedPlanLimit: thread.snapshotCoverage?.proposedPlanLimit ?? 0,
            proposedPlansTruncated: thread.snapshotCoverage?.proposedPlansTruncated ?? false,
            activityCount: thread.activities.length,
            activityLimit: thread.snapshotCoverage?.activityLimit ?? 0,
            activitiesTruncated: thread.snapshotCoverage?.activitiesTruncated ?? false,
            checkpointCount: thread.snapshotCoverage?.checkpointCount ?? 0,
            checkpointLimit: null,
            checkpointsTruncated: false,
          },
        };
      }
      const checkpoints = checkpointsByThreadId.get(thread.id);
      if (!checkpoints) {
        return thread;
      }
      return {
        ...thread,
        checkpoints: [...checkpoints],
        snapshotCoverage: {
          messageCount: thread.messages.length,
          messageLimit: thread.snapshotCoverage?.messageLimit ?? 0,
          messagesTruncated: thread.snapshotCoverage?.messagesTruncated ?? false,
          proposedPlanCount: thread.proposedPlans.length,
          proposedPlanLimit: thread.snapshotCoverage?.proposedPlanLimit ?? 0,
          proposedPlansTruncated: thread.snapshotCoverage?.proposedPlansTruncated ?? false,
          activityCount: thread.activities.length,
          activityLimit: thread.snapshotCoverage?.activityLimit ?? 0,
          activitiesTruncated: thread.snapshotCoverage?.activitiesTruncated ?? false,
          checkpointCount: checkpoints.length,
          checkpointLimit: null,
          checkpointsTruncated: false,
        },
      };
    }),
  };

  return nextReadModel;
}

export async function loadTargetedThreadDetailReadModel(input: {
  api: NativeApi;
  threadId: ThreadId;
  baseReadModel: OrchestrationReadModel | null;
  historyMode?: ThreadHistoryMode;
  includeOrchestratorWakes?: boolean;
}): Promise<OrchestrationReadModel> {
  const historyMode = input.historyMode ?? "initial";
  const includeOrchestratorWakes = input.includeOrchestratorWakes ?? true;
  const fragment = await loadDedupedThreadDetailFragment({
    api: input.api,
    threadId: input.threadId,
    mode: "thread",
    historyMode,
    includeOrchestratorWakes,
  });
  return mergeTargetedThreadDetailFragment(input.baseReadModel, fragment);
}

export async function loadTargetedOrchestratorSessionDetailReadModel(input: {
  api: NativeApi;
  threadId: ThreadId;
  baseReadModel: OrchestrationReadModel | null;
  historyMode?: ThreadHistoryMode;
  includeOrchestratorWakes?: boolean;
}): Promise<OrchestrationReadModel> {
  const historyMode = input.historyMode ?? "initial";
  const includeOrchestratorWakes = input.includeOrchestratorWakes ?? true;
  const fragment = await loadDedupedThreadDetailFragment({
    api: input.api,
    threadId: input.threadId,
    mode: "orchestrator-session",
    historyMode,
    includeOrchestratorWakes,
  });
  return mergeTargetedThreadDetailFragment(input.baseReadModel, fragment);
}
