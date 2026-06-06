import { describe, expect, it } from "vitest";
import { buildOrchestrationSidebarModel } from "./orchestrationSidebarModel";
import { ORCHESTRATION_SIDEBAR_DEMO_STATE } from "./orchestrationSidebarDemoData";

describe("ORCHESTRATION_SIDEBAR_DEMO_STATE", () => {
  it("builds a populated sidebar model with multiple executives and programs", () => {
    const model = buildOrchestrationSidebarModel({
      authoritySnapshot: ORCHESTRATION_SIDEBAR_DEMO_STATE.authoritySnapshot,
      ctoAttentionItems: [],
      currentTodos: ORCHESTRATION_SIDEBAR_DEMO_STATE.authoritySnapshot.currentTodos,
      programNotifications: [],
      programs: ORCHESTRATION_SIDEBAR_DEMO_STATE.authoritySnapshot.programs.map(
        (card) => card.program,
      ),
      projects: ORCHESTRATION_SIDEBAR_DEMO_STATE.projects,
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: ORCHESTRATION_SIDEBAR_DEMO_STATE.threads,
      wakeItems: [],
    });

    expect(model.executives).toHaveLength(2);
    expect(model.executives.flatMap((executive) => executive.programs)).toHaveLength(4);
    expect(
      model.executives.some((executive) =>
        executive.programs.some((program) => program.historicalLanes.length > 0),
      ),
    ).toBe(true);
    expect(
      model.executives.some((executive) =>
        executive.programs.some((program) => program.attentionCount > 0),
      ),
    ).toBe(true);
    expect(
      model.executives.some((executive) =>
        executive.programs.some((program) =>
          program.currentLane?.workers.some(
            (worker) =>
              worker.runtimeState === "inspectable" || worker.runtimeState === "unavailable",
          ),
        ),
      ),
    ).toBe(true);
  });

  it("provides inspectable runtime snapshots for demo popovers", () => {
    const executiveSnapshot = ORCHESTRATION_SIDEBAR_DEMO_STATE.getAgentRuntimeSnapshot(
      "executive",
      "demo-thread-exec-foundry",
    );
    const workerSnapshot =
      ORCHESTRATION_SIDEBAR_DEMO_STATE.getWorkerRuntimeSnapshot("demo-thread-worker-auth");

    expect(executiveSnapshot?.availability).toBe("inspectable");
    expect(executiveSnapshot?.summary.profile).toBeTruthy();
    expect(workerSnapshot?.availability).toBe("inspectable");
    expect(workerSnapshot?.installedPacks?.packs.length).toBeGreaterThan(0);
  });
});
