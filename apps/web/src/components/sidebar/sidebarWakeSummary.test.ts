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
  it("counts only open wakes for both orchestrator and worker thread ids", () => {
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
      openWakeCount: 2,
    });
    expect(summary.get(workerThreadId)).toEqual({
      openWakeCount: 2,
    });
  });

  it("excludes closed and non-open wakes from the neutral count-only summary", () => {
    const orchestratorThreadId = ThreadId.makeUnsafe("thread-orch-1");
    const workerThreadId = ThreadId.makeUnsafe("thread-worker-1");

    const summary = buildSidebarWakeSummaryByThreadId([
      makeWakeItem({
        wakeId: "wake-1",
        orchestratorThreadId,
        workerThreadId,
        state: "delivered",
      }),
      makeWakeItem({
        wakeId: "wake-2",
        orchestratorThreadId,
        workerThreadId,
        state: "consumed",
      }),
      makeWakeItem({
        wakeId: "wake-3",
        orchestratorThreadId,
        workerThreadId,
        state: "dropped",
      }),
    ]);

    expect(summary.has(orchestratorThreadId)).toBe(false);
    expect(summary.has(workerThreadId)).toBe(false);
  });

  it("returns a neutral count-only shape with no state-derived fields", () => {
    const summary = buildSidebarWakeSummaryByThreadId([
      makeWakeItem({
        wakeId: "wake-1",
        state: "pending",
      }),
    ]);

    expect(summary.get(ThreadId.makeUnsafe("thread-orch-1"))).toEqual({
      openWakeCount: 1,
    });
  });
});
