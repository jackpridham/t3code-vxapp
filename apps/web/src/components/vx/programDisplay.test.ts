import { describe, expect, it } from "vitest";
import {
  ProgramId,
  ProjectId,
  ThreadId,
  type ServerAgentsVxappProgramSnapshot,
} from "@t3tools/contracts";
import { formatProgramStatusLabel, summarizeProgramCloseout } from "./programDisplay";

function makeProgram(
  input: Partial<ServerAgentsVxappProgramSnapshot> &
    Pick<ServerAgentsVxappProgramSnapshot, "id" | "title" | "status">,
): ServerAgentsVxappProgramSnapshot {
  const { id, status, title, ...rest } = input;
  return {
    baseStatus: status,
    closeout: null,
    completedAt: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    currentOrchestratorThreadId: null,
    currentStatus: status,
    deletedAt: null,
    executiveProjectId: ProjectId.makeUnsafe("exec-project"),
    executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
    id,
    metadata: null,
    objective: null,
    status,
    title,
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...rest,
  };
}

describe("programDisplay", () => {
  it("formats program status labels for display", () => {
    expect(formatProgramStatusLabel("founder_review_ready")).toBe("founder review ready");
  });

  it("summarizes closeout gaps from authoritative program closeout data", () => {
    const summary = summarizeProgramCloseout(
      makeProgram({
        id: ProgramId.makeUnsafe("program-closeout"),
        title: "Closeout Program",
        status: "blocked",
        closeout: {
          closeout: {
            lastMissing: ["PR", { label: "observer review" }],
            lastVerdict: "blocked",
          },
          scope: {
            declaredRepos: ["api-vxapp", "vue-vxapp"],
            appTargets: ["api", "web"],
            requiredExternalE2ESuites: ["ms-o365"],
            requiredLocalSuites: ["pnpm:type-check", "vitest:o365"],
            requireDevelopmentDeploy: true,
            requireExternalE2E: true,
          },
        },
      }),
    );

    expect(summary.hasPostFlight).toBe(false);
    expect(summary.requiredLocalSuiteCount).toBe(2);
    expect(summary.requiredExternalSuiteCount).toBe(1);
    expect(summary.requiresDevelopmentDeploy).toBe(true);
    expect(summary.requiresExternalE2E).toBe(true);
    expect(summary.verdict).toBe("blocked");
    expect(summary.missingItems).toEqual(
      expect.arrayContaining([
        "PR",
        "observer review",
        "post-flight",
        "development deploy",
        "1 external e2e suite",
        "2 local suites",
      ]),
    );
  });

  it("preserves post-flight summary and verdict when closeout evidence exists", () => {
    const summary = summarizeProgramCloseout(
      makeProgram({
        id: ProgramId.makeUnsafe("program-post-flight"),
        title: "Observed Program",
        status: "closeout_in_progress",
        closeout: {
          closeout: {
            lastMissing: [],
            lastVerdict: "ready",
          },
          evidence: {
            postFlight: {
              summary: "Observer validation passed with no regressions.",
            },
          },
          scope: {
            declaredRepos: ["api-vxapp"],
            appTargets: ["api"],
            requiredExternalE2ESuites: [],
            requiredLocalSuites: [],
          },
        },
      }),
    );

    expect(summary.hasPostFlight).toBe(true);
    expect(summary.postFlightSummary).toBe("Observer validation passed with no regressions.");
    expect(summary.verdict).toBe("ready");
    expect(summary.missingItems).toEqual([]);
  });
});
