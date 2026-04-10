import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import type { Project, Thread } from "../types";
import { getWorkerLineageWarningDescription } from "./workerLineage";

function makeThread(
  overrides: Partial<
    Pick<
      Thread,
      | "id"
      | "projectId"
      | "title"
      | "spawnRole"
      | "orchestratorProjectId"
      | "orchestratorThreadId"
      | "parentThreadId"
      | "workflowId"
    >
  > = {},
): Pick<
  Thread,
  | "id"
  | "projectId"
  | "title"
  | "spawnRole"
  | "orchestratorProjectId"
  | "orchestratorThreadId"
  | "parentThreadId"
  | "workflowId"
> {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    spawnRole: "worker",
    orchestratorProjectId: ProjectId.makeUnsafe("project-orchestrator"),
    orchestratorThreadId: ThreadId.makeUnsafe("root-1"),
    parentThreadId: ThreadId.makeUnsafe("root-1"),
    workflowId: "wf-1",
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<Pick<Project, "id" | "name" | "cwd">> = {},
): Pick<Project, "id" | "name" | "cwd"> {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project 1",
    cwd: "/tmp/project-1",
    ...overrides,
  };
}

describe("getWorkerLineageWarningDescription", () => {
  it("returns null for a worker whose lineage resolves cleanly", () => {
    const orchestratorProject = makeProject({
      id: ProjectId.makeUnsafe("project-orchestrator"),
      name: "Jasper",
      cwd: "/tmp/jasper",
    });
    const rootThread = makeThread({
      id: ThreadId.makeUnsafe("root-1"),
      projectId: orchestratorProject.id,
      spawnRole: "orchestrator",
      orchestratorProjectId: undefined,
      orchestratorThreadId: undefined,
      parentThreadId: undefined,
      workflowId: "wf-1",
    });

    expect(
      getWorkerLineageWarningDescription({
        thread: makeThread(),
        threads: [rootThread, makeThread()],
        projects: [makeProject(), orchestratorProject],
      }),
    ).toBeNull();
  });

  it("returns a warning when required worker lineage fields are missing", () => {
    expect(
      getWorkerLineageWarningDescription({
        thread: makeThread({
          orchestratorProjectId: undefined,
          orchestratorThreadId: undefined,
          parentThreadId: undefined,
          workflowId: undefined,
        }),
      }),
    ).toContain("Worker lineage warning:");
  });
});
