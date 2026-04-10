import { type OrchestratorWakeItem, type ThreadId } from "@t3tools/contracts";

export interface SidebarWakeSummary {
  pendingCount: number;
  deliveringCount: number;
  workerState: "pending" | "delivering" | null;
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
      pendingCount: 0,
      deliveringCount: 0,
      workerState: null,
    };
    summaryByThreadId.set(wakeItem.orchestratorThreadId, {
      ...orchestratorSummary,
      pendingCount: orchestratorSummary.pendingCount + (wakeItem.state === "pending" ? 1 : 0),
      deliveringCount:
        orchestratorSummary.deliveringCount + (wakeItem.state === "delivering" ? 1 : 0),
    });

    const workerSummary = summaryByThreadId.get(wakeItem.workerThreadId) ?? {
      pendingCount: 0,
      deliveringCount: 0,
      workerState: null,
    };
    summaryByThreadId.set(wakeItem.workerThreadId, {
      ...workerSummary,
      workerState:
        wakeItem.state === "delivering" ? "delivering" : (workerSummary.workerState ?? "pending"),
    });
  }

  return summaryByThreadId;
}
