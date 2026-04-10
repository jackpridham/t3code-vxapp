import { ProjectId, ThreadId, TurnId, type OrchestratorWakeItem } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildSidebarWakeSummaryByThreadId } from "./sidebarWakeSummary";

function makeWakeItem(
  overrides: Partial<OrchestratorWakeItem> & Pick<OrchestratorWakeItem, "wakeId">,
): OrchestratorWakeItem {
  return {
    wakeId: overrides.wakeId,
    orchestratorThreadId: overrides.orchestratorThreadId ?? ThreadId.makeUnsafe("thread-orch-1"),
    orchestratorProjectId:
      overrides.orchestratorProjectId ?? ProjectId.makeUnsafe("project-orch-1"),
    workerThreadId: overrides.workerThreadId ?? ThreadId.makeUnsafe("thread-worker-1"),
    workerProjectId: overrides.workerProjectId ?? ProjectId.makeUnsafe("project-worker-1"),
    workerTurnId: overrides.workerTurnId ?? TurnId.makeUnsafe("turn-1"),
    workflowId: overrides.workflowId ?? undefined,
    workerTitleSnapshot: overrides.workerTitleSnapshot ?? "Worker 1",
    outcome: overrides.outcome ?? "completed",
    summary: overrides.summary ?? "Completed work",
    queuedAt: overrides.queuedAt ?? "2026-04-05T10:00:00.000Z",
    state: overrides.state ?? "pending",
    deliveryMessageId: overrides.deliveryMessageId ?? undefined,
    deliveredAt: overrides.deliveredAt ?? null,
    consumedAt: overrides.consumedAt ?? null,
    consumeReason: overrides.consumeReason ?? undefined,
  };
}

describe("buildSidebarWakeSummaryByThreadId", () => {
  it("aggregates orchestrator totals and worker wake state", () => {
    const orchestratorThreadId = ThreadId.makeUnsafe("thread-orch-1");
    const workerThreadId = ThreadId.makeUnsafe("thread-worker-1");

    const summary = buildSidebarWakeSummaryByThreadId([
      makeWakeItem({
        wakeId: "wake-1",
        orchestratorThreadId,
        workerThreadId,
        state: "pending",
      }),
      makeWakeItem({
        wakeId: "wake-2",
        orchestratorThreadId,
        workerThreadId,
        state: "delivering",
      }),
    ]);

    expect(summary.get(orchestratorThreadId)).toEqual({
      pendingCount: 1,
      deliveringCount: 1,
      workerState: null,
    });
    expect(summary.get(workerThreadId)).toEqual({
      pendingCount: 0,
      deliveringCount: 0,
      workerState: "delivering",
    });
  });

  it("ignores wake items that are no longer pending delivery", () => {
    const orchestratorThreadId = ThreadId.makeUnsafe("thread-orch-1");

    const summary = buildSidebarWakeSummaryByThreadId([
      makeWakeItem({
        wakeId: "wake-1",
        orchestratorThreadId,
        state: "consumed",
      }),
    ]);

    expect(summary.has(orchestratorThreadId)).toBe(false);
  });
});
