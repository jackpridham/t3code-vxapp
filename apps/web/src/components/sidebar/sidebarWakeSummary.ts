import { type OrchestratorWakeItem, type ThreadId } from "@t3tools/contracts";

export interface SidebarWakeSummary {
  openWakeCount: number;
}

export function buildSidebarWakeSummaryByThreadId(
  wakeItems: readonly OrchestratorWakeItem[],
): Map<ThreadId, SidebarWakeSummary> {
  const summaryByThreadId = new Map<ThreadId, SidebarWakeSummary>();

  for (const wakeItem of wakeItems) {
    if (wakeItem.state !== "pending" && wakeItem.state !== "delivering") {
      continue;
    }

    const orchestratorSummary = summaryByThreadId.get(wakeItem.orchestratorThreadId) ?? {
      openWakeCount: 0,
    };
    summaryByThreadId.set(wakeItem.orchestratorThreadId, {
      openWakeCount: orchestratorSummary.openWakeCount + 1,
    });

    const workerSummary = summaryByThreadId.get(wakeItem.workerThreadId) ?? {
      openWakeCount: 0,
    };
    summaryByThreadId.set(wakeItem.workerThreadId, {
      openWakeCount: workerSummary.openWakeCount + 1,
    });
  }

  return summaryByThreadId;
}
