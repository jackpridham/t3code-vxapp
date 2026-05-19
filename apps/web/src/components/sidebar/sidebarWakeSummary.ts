import type {
  OrchestratorWakeItem,
  ServerAgentsVxappSidebarWake,
  ThreadId,
} from "@t3tools/contracts";

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

export function buildAuthoritySidebarWakeSummaryByThreadId(
  wakeItems: readonly ServerAgentsVxappSidebarWake[],
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

    const workerThreadId =
      wakeItem.payload && typeof wakeItem.payload.workerThreadId === "string"
        ? wakeItem.payload.workerThreadId
        : null;
    if (!workerThreadId) {
      continue;
    }

    const workerSummary = summaryByThreadId.get(workerThreadId as ThreadId) ?? {
      openWakeCount: 0,
    };
    summaryByThreadId.set(workerThreadId as ThreadId, {
      openWakeCount: workerSummary.openWakeCount + 1,
    });
  }

  return summaryByThreadId;
}
