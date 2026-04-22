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

export async function addThreadDetailToReadModel(
  api: NativeApi,
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const detailReadModel = await ensureThreadInReadModel(api, readModel, threadId);
  const [messages, activities, sessions, orchestratorWakeItems] = await Promise.all([
    listAllThreadMessages(api, threadId),
    listAllThreadActivities(api, threadId),
    api.orchestration.listThreadSessions({ threadId }),
    api.orchestration.listOrchestratorWakes({
      orchestratorThreadId: threadId,
      limit: CURRENT_THREAD_WAKE_LIMIT,
    }),
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
    orchestratorWakeItems,
  };
}

export async function loadCurrentStateWithThreadDetail(
  api: NativeApi,
  threadId: ThreadId,
): Promise<OrchestrationReadModel> {
  const currentState = await api.orchestration.getCurrentState();
  return addThreadDetailToReadModel(api, currentState, threadId);
}
