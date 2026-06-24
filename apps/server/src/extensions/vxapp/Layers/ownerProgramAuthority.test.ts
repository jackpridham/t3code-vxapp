import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { filterOwnerProgramsWithExecutiveIds } from "./ownerProgramAuthority.ts";

describe("filterOwnerProgramsWithExecutiveIds", () => {
  it("drops owner programs missing either executive id", () => {
    const result = filterOwnerProgramsWithExecutiveIds([
      {
        id: ProgramId.makeUnsafe("program-good"),
        title: "Good",
        objective: null,
        status: "awaiting_founder",
        executiveProjectId: ProjectId.makeUnsafe("project-cto"),
        executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
        currentOrchestratorThreadId: null,
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        completedAt: null,
        deletedAt: null,
      },
      {
        id: ProgramId.makeUnsafe("program-bad"),
        title: "Bad",
        objective: null,
        status: "awaiting_founder",
        executiveProjectId: null,
        executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
        currentOrchestratorThreadId: null,
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        completedAt: null,
        deletedAt: null,
      },
      {
        id: ProgramId.makeUnsafe("program-bad-thread"),
        title: "Bad Thread",
        objective: null,
        status: "awaiting_founder",
        executiveProjectId: ProjectId.makeUnsafe("project-cto"),
        executiveThreadId: null,
        currentOrchestratorThreadId: null,
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        completedAt: null,
        deletedAt: null,
      },
    ]);

    expect(result.map((program) => program.id)).toEqual(["program-good"]);
  });
});
