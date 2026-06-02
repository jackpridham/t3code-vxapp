import { type NativeApi, type OrchestrationReadModel, type ThreadId } from "@t3tools/contracts";

import {
  loadTargetedOrchestratorSessionDetailReadModel,
  loadTargetedThreadDetailReadModel,
} from "./orchestrationCurrentStateHydration";
import type { Thread } from "../types";

export function threadNeedsRouteHistoryHydration(thread: Thread | null | undefined): boolean {
  if (!thread) {
    return false;
  }
  const hasStarted =
    thread.latestTurn !== null ||
    thread.messages.length > 0 ||
    thread.session !== null ||
    thread.activities.length > 0 ||
    thread.proposedPlans.length > 0 ||
    thread.turnDiffSummaries.length > 0 ||
    thread.spawnRole === "orchestrator";
  if (!hasStarted) {
    return false;
  }
  const coverage = thread.snapshotCoverage;
  if (coverage === undefined) {
    return true;
  }

  const needsWorkerChangesDetail =
    thread.spawnRole === "orchestrator" &&
    (thread.sessionWorkerThreadCount ?? 0) > 0 &&
    coverage.checkpointLimit !== null;
  if (needsWorkerChangesDetail) {
    return true;
  }

  const hasMessageDetail = coverage.messageLimit === null || coverage.messageLimit > 0;
  const hasActivityDetail = coverage.activityLimit === null || coverage.activityLimit > 0;
  return !hasMessageDetail || !hasActivityDetail;
}

export async function hydrateRouteThreadHistory(input: {
  api: NativeApi;
  threadId: ThreadId;
  thread: Thread | null | undefined;
  baseReadModel: OrchestrationReadModel | null;
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
}): Promise<boolean> {
  if (!threadNeedsRouteHistoryHydration(input.thread)) {
    return false;
  }

  const readModel =
    input.thread?.spawnRole === "orchestrator"
      ? await loadTargetedOrchestratorSessionDetailReadModel({
          api: input.api,
          threadId: input.threadId,
          baseReadModel: input.baseReadModel,
        })
      : await loadTargetedThreadDetailReadModel({
          api: input.api,
          threadId: input.threadId,
          baseReadModel: input.baseReadModel,
        });
  input.syncServerReadModel(readModel);
  return true;
}

export async function hydrateMissingRouteThread(input: {
  api: NativeApi;
  threadId: ThreadId;
  baseReadModel: OrchestrationReadModel | null;
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
}): Promise<boolean> {
  const readModel = await loadTargetedThreadDetailReadModel({
    api: input.api,
    threadId: input.threadId,
    baseReadModel: input.baseReadModel,
  });
  const hydrated = readModel.threads.some((thread) => thread.id === input.threadId);
  if (hydrated) {
    input.syncServerReadModel(readModel);
  }
  return hydrated;
}
