import {
  type NativeApi,
  NonNegativeInt,
  type OrchestrationListThreadActivitiesResult,
  type OrchestrationListThreadMessagesResult,
  type OrchestrationReadModel,
  type OrchestrationThreadSummary,
  ThreadId,
} from "@t3tools/contracts";

const CURRENT_THREAD_HISTORY_PAGE_LIMIT = NonNegativeInt.makeUnsafe(1000);
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
      limit: CURRENT_THREAD_HISTORY_PAGE_LIMIT,
      ...(beforeCreatedAt !== undefined ? { beforeCreatedAt } : {}),
    });
    if (page.length === 0) {
      break;
    }
    pages.unshift(page);
    if (page.length < CURRENT_THREAD_HISTORY_PAGE_LIMIT) {
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
  } = {},
): Promise<OrchestrationReadModel> {
  const includeOrchestratorWakes = options.includeOrchestratorWakes ?? true;
  const detailReadModel = await ensureThreadInReadModel(api, readModel, threadId);
  const [messages, activities, sessions, orchestratorWakeItems] = await Promise.all([
    listAllThreadMessages(api, threadId),
    listAllThreadActivities(api, threadId),
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
        messageLimit: null,
        messagesTruncated: false,
        proposedPlanCount: thread.proposedPlans.length,
        proposedPlanLimit: 0,
        proposedPlansTruncated: false,
        activityCount: activities.length,
        activityLimit: null,
        activitiesTruncated: false,
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

export async function loadCurrentStateWithThreadDetail(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const currentState = await api.orchestration.getCurrentState();
  return addThreadDetailToReadModel(api, currentState, threadId);
}

export async function loadCurrentStateWithOrchestratorSessionDetail(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const currentState = await api.orchestration.getCurrentState();
  const rootReadModel = await addThreadDetailToReadModel(api, currentState, threadId);
  return addOrchestratorSessionWorkerDetailsToReadModel(api, rootReadModel, threadId);
}
