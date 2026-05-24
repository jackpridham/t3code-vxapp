import {
  type NativeApi,
  NonNegativeInt,
  type OrchestrationCheckpointSummary,
  type OrchestrationListThreadActivitiesResult,
  type OrchestrationListThreadMessagesResult,
  type OrchestrationReadModel,
  type OrchestrationThreadSummary,
  ThreadId,
} from "@t3tools/contracts";

const CURRENT_THREAD_HISTORY_PAGE_LIMIT = NonNegativeInt.makeUnsafe(1000);
const CURRENT_THREAD_MESSAGE_HISTORY_PAGE_LIMIT = NonNegativeInt.makeUnsafe(500);
const CURRENT_THREAD_INITIAL_HISTORY_LIMIT = NonNegativeInt.makeUnsafe(200);
const CURRENT_THREAD_WAKE_LIMIT = NonNegativeInt.makeUnsafe(100);

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

export async function loadCurrentStateWithThreadDetail(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const currentState = await api.orchestration.getCurrentState();
  return addThreadDetailToReadModel(api, currentState, threadId, {
    historyMode: "initial",
  });
}

export async function loadCurrentStateWithOrchestratorSessionDetail(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const currentState = await api.orchestration.getCurrentState();
  const rootReadModel = await addThreadDetailToReadModel(api, currentState, threadId, {
    historyMode: "initial",
  });
  const sessionThreads = await api.orchestration.listSessionThreads({
    rootThreadId: threadId,
    includeArchived: true,
    includeDeleted: false,
  });
  return addOrchestratorSessionWorkerChangesToReadModel(
    api,
    mergeSessionThreadsIntoReadModel(rootReadModel, sessionThreads),
    threadId,
    sessionThreads,
  );
}
