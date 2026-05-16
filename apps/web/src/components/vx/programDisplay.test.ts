import { describe, expect, it } from "vitest";
import {
  ProgramId,
  ProjectId,
  ThreadId,
  type ServerAgentsVxappProgramSnapshot,
} from "@t3tools/contracts";
import { readProgramCloseoutVerdict, resolveProgramDisplay } from "./programDisplay";

function makeProgram(
  input: Partial<ServerAgentsVxappProgramSnapshot> &
    Pick<ServerAgentsVxappProgramSnapshot, "id" | "title" | "status">,
): ServerAgentsVxappProgramSnapshot {
  return {
    baseStatus: input.status,
    closeout: null,
    completedAt: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    currentOrchestratorThreadId: null,
    currentStatus: input.status,
    deletedAt: null,
    executiveProjectId: ProjectId.makeUnsafe("exec-project"),
    executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
    metadata: null,
    objective: null,
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...input,
  };
}

describe("programDisplay", () => {
  it("prefers owner display metadata for labels, tones, headings, and summaries", () => {
    const display = resolveProgramDisplay(
      makeProgram({
        id: ProgramId.makeUnsafe("program-1"),
        title: "Program One",
        status: "blocked",
        objective: "fallback summary",
        metadata: {
          display: {
            heading: "Owner heading",
            label: "Owner label",
            summary: "Owner summary",
            tone: "owner-tone-critical",
            sortKey: "002",
          },
        },
      }),
    );

    expect(display).toEqual({
      heading: "Owner heading",
      label: "Owner label",
      sortKey: "002",
      summary: "Owner summary",
      tone: "owner-tone-critical",
    });
  });

  it("falls back to direct owner payload fields without relabeling status strings", () => {
    const display = resolveProgramDisplay(
      makeProgram({
        id: ProgramId.makeUnsafe("program-2"),
        title: "Program Two",
        status: "founder_review_ready",
        objective: "Direct summary",
      }),
    );

    expect(display.label).toBe("founder_review_ready");
    expect(display.heading).toBe("Program Two");
    expect(display.summary).toBe("Direct summary");
    expect(display.tone).toBeNull();
  });

  it("reads the closeout verdict directly from owner payload data", () => {
    expect(
      readProgramCloseoutVerdict(
        makeProgram({
          id: ProgramId.makeUnsafe("program-3"),
          title: "Program Three",
          status: "completed",
          closeout: {
            closeout: {
              lastVerdict: "ready",
            },
          },
        }),
      ),
    ).toBe("ready");
  });
});
