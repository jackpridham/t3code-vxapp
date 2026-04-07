import { ProjectId, ThreadId, TurnId, type OrchestratorWakeItem } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { createWakeItemsForThreadSelector } from "./storeSelectors";

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

describe("createWakeItemsForThreadSelector", () => {
  it("reuses the previous array when the wake snapshot reference is unchanged", () => {
    const threadId = ThreadId.makeUnsafe("thread-orch-1");
    const selector = createWakeItemsForThreadSelector(threadId, "orchestratorThreadId");
    const wakeItems = [
      makeWakeItem({ wakeId: "wake-1" }),
      makeWakeItem({
        wakeId: "wake-2",
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch-2"),
      }),
    ];

    const first = selector({ orchestratorWakeItems: wakeItems });
    const second = selector({ orchestratorWakeItems: wakeItems });

    expect(second).toBe(first);
    expect(second).toEqual([wakeItems[0]]);
  });

  it("returns a stable empty array when no thread id is provided", () => {
    const selector = createWakeItemsForThreadSelector(null, "workerThreadId");
    const first = selector({ orchestratorWakeItems: [makeWakeItem({ wakeId: "wake-1" })] });
    const second = selector({ orchestratorWakeItems: [makeWakeItem({ wakeId: "wake-2" })] });

    expect(first).toBe(second);
    expect(first).toEqual([]);
  });

  it("recomputes when the wake snapshot reference changes", () => {
    const threadId = ThreadId.makeUnsafe("thread-worker-1");
    const selector = createWakeItemsForThreadSelector(threadId, "workerThreadId");
    const firstWake = makeWakeItem({ wakeId: "wake-1" });
    const secondWake = makeWakeItem({ wakeId: "wake-2" });

    const first = selector({ orchestratorWakeItems: [firstWake] });
    const second = selector({ orchestratorWakeItems: [firstWake, secondWake] });

    expect(second).not.toBe(first);
    expect(second).toEqual([firstWake, secondWake]);
  });
});
