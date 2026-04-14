import {
  type NativeApi,
  NonNegativeInt,
  type OrchestrationReadModel,
  type OrchestrationThreadSummary,
  ThreadId,
} from "@t3tools/contracts";

const CURRENT_THREAD_MESSAGE_LIMIT = NonNegativeInt.makeUnsafe(500);
const CURRENT_THREAD_ACTIVITY_LIMIT = NonNegativeInt.makeUnsafe(250);
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
    api.orchestration.listThreadMessages({
      threadId,
      limit: CURRENT_THREAD_MESSAGE_LIMIT,
    }),
    api.orchestration.listThreadActivities({
      threadId,
      limit: CURRENT_THREAD_ACTIVITY_LIMIT,
    }),
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
        messageLimit: CURRENT_THREAD_MESSAGE_LIMIT,
        messagesTruncated: messages.length >= CURRENT_THREAD_MESSAGE_LIMIT,
        proposedPlanCount: thread.proposedPlans.length,
        proposedPlanLimit: 0,
        proposedPlansTruncated: false,
        activityCount: activities.length,
        activityLimit: CURRENT_THREAD_ACTIVITY_LIMIT,
        activitiesTruncated: activities.length >= CURRENT_THREAD_ACTIVITY_LIMIT,
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
