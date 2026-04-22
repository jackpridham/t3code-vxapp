import { type NativeApi, type OrchestrationReadModel, type ThreadId } from "@t3tools/contracts";

import { loadCurrentStateWithThreadDetail } from "./orchestrationCurrentStateHydration";
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
    thread.turnDiffSummaries.length > 0;
  if (!hasStarted) {
    return false;
  }
  const coverage = thread.snapshotCoverage;
  if (coverage === undefined) {
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
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
}): Promise<boolean> {
  if (!threadNeedsRouteHistoryHydration(input.thread)) {
    return false;
  }

  const readModel = await loadCurrentStateWithThreadDetail(input.api, input.threadId);
  input.syncServerReadModel(readModel);
  return true;
}
