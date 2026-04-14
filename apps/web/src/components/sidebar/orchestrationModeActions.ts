import type {
  NativeApi,
  OrchestrationReadModel,
  OrchestrationThreadSummary,
  ModelSelection,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@t3tools/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  invalidateOrchestrationProjectCatalogs,
  invalidateOrchestrationSessionCatalogs,
  orchestrationProjectThreadsQueryOptions,
  orchestrationSessionThreadsQueryOptions,
} from "../../lib/orchestrationReactQuery";
import { loadCurrentStateWithThreadDetail } from "../../lib/orchestrationCurrentStateHydration";
import { newCommandId, newThreadId } from "../../lib/utils";

export interface SessionReactivationPlan {
  affectedProjectIds: ProjectId[];
  threadsToInterrupt: ThreadId[];
  threadsToStop: ThreadId[];
  threadsToArchive: ThreadId[];
  threadsToUnarchive: ThreadId[];
  rootThreadIdToHydrate: ThreadId;
}

export interface SessionArchivePlan {
  affectedProjectIds: ProjectId[];
  threadsToInterrupt: ThreadId[];
  threadsToStop: ThreadId[];
  threadsToArchive: ThreadId[];
}

function uniqueThreadIds(threadIds: readonly ThreadId[]): ThreadId[] {
  return [...new Set(threadIds)];
}

function uniqueProjectIds(projectIds: readonly ProjectId[]): ProjectId[] {
  return [...new Set(projectIds)];
}

function resolveThreadDepth(
  threadById: ReadonlyMap<ThreadId, Pick<OrchestrationThreadSummary, "id" | "parentThreadId">>,
  threadId: ThreadId,
): number {
  let depth = 0;
  let currentThreadId: ThreadId | undefined = threadId;
  const visited = new Set<ThreadId>();

  while (currentThreadId) {
    const thread = threadById.get(currentThreadId);
    const parentThreadId = thread?.parentThreadId;
    if (!parentThreadId || visited.has(parentThreadId)) {
      break;
    }
    visited.add(parentThreadId);
    currentThreadId = parentThreadId;
    depth += 1;
  }

  return depth;
}

function sortThreadIdsByDepth(input: {
  threads: readonly Pick<OrchestrationThreadSummary, "id" | "parentThreadId">[];
  order: "root-first" | "leaf-first";
}): ThreadId[] {
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  return [...input.threads]
    .toSorted((left, right) => {
      const leftDepth = resolveThreadDepth(threadById, left.id);
      const rightDepth = resolveThreadDepth(threadById, right.id);
      return input.order === "root-first" ? leftDepth - rightDepth : rightDepth - leftDepth;
    })
    .map((thread) => thread.id);
}

function sessionRequiresStop(thread: Pick<OrchestrationThreadSummary, "session">): boolean {
  if (thread.session === null) {
    return false;
  }
  return !["idle", "stopped", "error"].includes(thread.session.status);
}

function isArchivableThread(thread: Pick<OrchestrationThreadSummary, "archivedAt" | "deletedAt">) {
  return thread.archivedAt === null && thread.deletedAt === null;
}

function isAlreadyArchivedCommandError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("is already archived");
}

function buildSessionArchivePlan(input: {
  activeSessionThreads: readonly OrchestrationThreadSummary[];
}): SessionArchivePlan {
  const activeSessionThreads = input.activeSessionThreads.filter(isArchivableThread);

  return {
    affectedProjectIds: uniqueProjectIds(
      input.activeSessionThreads.map((thread) => thread.projectId),
    ),
    threadsToInterrupt: uniqueThreadIds(
      activeSessionThreads
        .filter(
          (thread) => thread.session?.status === "running" && thread.session.activeTurnId !== null,
        )
        .map((thread) => thread.id),
    ),
    threadsToStop: uniqueThreadIds(
      activeSessionThreads.filter(sessionRequiresStop).map((thread) => thread.id),
    ),
    threadsToArchive: sortThreadIdsByDepth({
      threads: activeSessionThreads,
      order: "leaf-first",
    }),
  };
}

function resolveActiveOrchestrationRootThreadId(
  projectRootThreads: readonly OrchestrationThreadSummary[],
): ThreadId | null {
  return (
    [...projectRootThreads]
      .filter((thread) => thread.archivedAt === null)
      .toSorted(
        (left, right) =>
          (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) ||
          right.createdAt.localeCompare(left.createdAt),
      )[0]?.id ?? null
  );
}

function fetchFreshProjectThreads(input: {
  queryClient: QueryClient;
  projectId: ProjectId;
}): Promise<readonly OrchestrationThreadSummary[]> {
  return input.queryClient.fetchQuery({
    ...orchestrationProjectThreadsQueryOptions({
      projectId: input.projectId,
      includeArchived: true,
    }),
    staleTime: 0,
  });
}

function fetchFreshSessionThreads(input: {
  queryClient: QueryClient;
  rootThreadId: ThreadId;
}): Promise<readonly OrchestrationThreadSummary[]> {
  return input.queryClient.fetchQuery({
    ...orchestrationSessionThreadsQueryOptions({
      rootThreadId: input.rootThreadId,
      includeArchived: true,
    }),
    staleTime: 0,
  });
}

async function executeSessionArchivePlan(input: {
  api: NativeApi;
  plan: SessionArchivePlan;
  commandTimestamp: string;
}): Promise<void> {
  for (const threadId of input.plan.threadsToInterrupt) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId,
      createdAt: input.commandTimestamp,
    });
  }

  for (const threadId of input.plan.threadsToStop) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.session.stop",
      commandId: newCommandId(),
      threadId,
      createdAt: input.commandTimestamp,
    });
  }

  for (const threadId of input.plan.threadsToArchive) {
    try {
      await input.api.orchestration.dispatchCommand({
        type: "thread.archive",
        commandId: newCommandId(),
        threadId,
      });
    } catch (error) {
      if (!isAlreadyArchivedCommandError(error)) {
        throw error;
      }
    }
  }
}

export function buildSessionReactivationPlan(input: {
  activeRootThreadId: ThreadId | null;
  targetRootThreadId: ThreadId;
  activeSessionThreads: readonly OrchestrationThreadSummary[];
  targetSessionThreads: readonly OrchestrationThreadSummary[];
  projectRootThreads: readonly OrchestrationThreadSummary[];
}): SessionReactivationPlan {
  const targetRoot = input.projectRootThreads.find(
    (thread) => thread.id === input.targetRootThreadId,
  );
  const activeRoot =
    input.activeRootThreadId === null
      ? null
      : (input.projectRootThreads.find((thread) => thread.id === input.activeRootThreadId) ?? null);
  const isTargetAlreadyActive = input.activeRootThreadId === input.targetRootThreadId;
  const archivableActiveSessionThreads = input.activeSessionThreads.filter(isArchivableThread);

  const threadsToInterrupt = isTargetAlreadyActive
    ? []
    : uniqueThreadIds(
        archivableActiveSessionThreads
          .filter(
            (thread) =>
              thread.session?.status === "running" && thread.session.activeTurnId !== null,
          )
          .map((thread) => thread.id),
      );
  const threadsToStop = isTargetAlreadyActive
    ? []
    : uniqueThreadIds(
        archivableActiveSessionThreads.filter(sessionRequiresStop).map((thread) => thread.id),
      );
  const threadsToArchive = isTargetAlreadyActive
    ? []
    : sortThreadIdsByDepth({
        threads: archivableActiveSessionThreads,
        order: "leaf-first",
      });
  const threadsToUnarchive = isTargetAlreadyActive
    ? []
    : sortThreadIdsByDepth({
        threads: input.targetSessionThreads.filter((thread) => thread.archivedAt !== null),
        order: "root-first",
      });

  return {
    affectedProjectIds: uniqueProjectIds(
      [
        ...input.activeSessionThreads.map((thread) => thread.projectId),
        ...input.targetSessionThreads.map((thread) => thread.projectId),
        ...(activeRoot ? [activeRoot.projectId] : []),
        ...(targetRoot ? [targetRoot.projectId] : []),
      ].filter((projectId): projectId is ProjectId => projectId !== undefined),
    ),
    threadsToInterrupt,
    threadsToStop,
    threadsToArchive,
    threadsToUnarchive,
    rootThreadIdToHydrate: input.targetRootThreadId,
  };
}

export async function reactivateOrchestrationSession(input: {
  api: NativeApi;
  queryClient: QueryClient;
  projectId: ProjectId;
  activeRootThreadId: ThreadId | null;
  targetRootThreadId: ThreadId;
  activeSessionThreads: readonly OrchestrationThreadSummary[];
  targetSessionThreads: readonly OrchestrationThreadSummary[];
  projectRootThreads: readonly OrchestrationThreadSummary[];
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  navigateToThread: (threadId: ThreadId) => Promise<void>;
}): Promise<SessionReactivationPlan> {
  const plan = buildSessionReactivationPlan(input);
  const targetRoot = input.projectRootThreads.find(
    (thread) => thread.id === input.targetRootThreadId,
  );
  const shouldConfirm =
    input.activeRootThreadId !== null &&
    input.activeRootThreadId !== input.targetRootThreadId &&
    targetRoot?.archivedAt !== null;

  if (shouldConfirm) {
    const confirmed = await input.api.dialogs.confirm(
      "Reactivate this orchestration session? The current active session will be archived first.",
    );
    if (!confirmed) {
      return plan;
    }
  }

  const commandTimestamp = new Date().toISOString();
  await executeSessionArchivePlan({
    api: input.api,
    plan,
    commandTimestamp,
  });

  for (const threadId of plan.threadsToUnarchive) {
    await input.api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId,
    });
  }

  await input.api.orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: input.projectId,
    currentSessionRootThreadId: input.targetRootThreadId,
  });

  await invalidateOrchestrationProjectCatalogs(input.queryClient, plan.affectedProjectIds);
  await invalidateOrchestrationSessionCatalogs(
    input.queryClient,
    uniqueThreadIds(
      [input.activeRootThreadId, input.targetRootThreadId].filter(
        (threadId): threadId is ThreadId => threadId !== null,
      ),
    ),
  );

  const readModel = await loadCurrentStateWithThreadDetail(input.api, plan.rootThreadIdToHydrate);
  input.syncServerReadModel(readModel);

  await input.queryClient.fetchQuery(
    orchestrationSessionThreadsQueryOptions({
      rootThreadId: input.targetRootThreadId,
      includeArchived: true,
    }),
  );

  await input.navigateToThread(plan.rootThreadIdToHydrate);

  return plan;
}

export async function createNewOrchestrationSession(input: {
  api: NativeApi;
  queryClient: QueryClient;
  projectId: ProjectId;
  projectName: string;
  projectModelSelection: ModelSelection;
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  navigateToThread: (threadId: ThreadId) => Promise<void>;
}): Promise<ThreadId | null> {
  const projectRootThreads = await fetchFreshProjectThreads({
    queryClient: input.queryClient,
    projectId: input.projectId,
  });
  const activeRootThreadId = resolveActiveOrchestrationRootThreadId(projectRootThreads);
  const activeSessionThreads =
    activeRootThreadId === null
      ? []
      : await fetchFreshSessionThreads({
          queryClient: input.queryClient,
          rootThreadId: activeRootThreadId,
        });

  if (activeRootThreadId !== null && activeSessionThreads.length > 0) {
    const confirmed = await input.api.dialogs.confirm(
      `Create a new ${input.projectName} session? Current workers in this session will be archived, but you can restore the session later.`,
    );
    if (!confirmed) {
      return null;
    }
  }

  const commandTimestamp = new Date().toISOString();
  const archivePlan = buildSessionArchivePlan({
    activeSessionThreads,
  });
  await executeSessionArchivePlan({
    api: input.api,
    plan: archivePlan,
    commandTimestamp,
  });

  const newRootThreadId = newThreadId();
  await input.api.orchestration.dispatchCommand({
    type: "thread.create",
    commandId: newCommandId(),
    threadId: newRootThreadId,
    projectId: input.projectId,
    title: `New ${input.projectName} Session`,
    modelSelection: input.projectModelSelection,
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    spawnRole: "orchestrator",
    createdAt: commandTimestamp,
  });

  await input.api.orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: input.projectId,
    currentSessionRootThreadId: newRootThreadId,
  });

  await invalidateOrchestrationProjectCatalogs(input.queryClient, [
    input.projectId,
    ...archivePlan.affectedProjectIds,
  ]);
  await invalidateOrchestrationSessionCatalogs(
    input.queryClient,
    uniqueThreadIds(
      [activeRootThreadId, newRootThreadId].filter(
        (threadId): threadId is ThreadId => threadId !== null,
      ),
    ),
  );

  const readModel = await loadCurrentStateWithThreadDetail(input.api, newRootThreadId);
  input.syncServerReadModel(readModel);

  await input.queryClient.fetchQuery(
    orchestrationSessionThreadsQueryOptions({
      rootThreadId: newRootThreadId,
      includeArchived: true,
    }),
  );

  await input.navigateToThread(newRootThreadId);
  return newRootThreadId;
}
