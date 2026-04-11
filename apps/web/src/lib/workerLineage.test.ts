import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import type { Project, Thread } from "../types";
import { getWorkerLineageIndicator } from "./workerLineage";

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
  workflowId: undefined,
});

function getIndicatorForWorker(
  threadOverrides: Partial<
    Pick<Thread, "orchestratorProjectId" | "orchestratorThreadId" | "parentThreadId" | "workflowId">
  > = {},
  resolutionOverrides: {
    threads?: readonly Pick<Thread, "id">[];
    projects?: readonly Pick<Project, "id">[];
  } = {},
) {
  return getWorkerLineageIndicator({
    thread: makeThread(threadOverrides),
    threads: resolutionOverrides.threads ?? [rootThread, makeThread()],
    projects: resolutionOverrides.projects ?? [makeProject(), orchestratorProject],
  });
}

describe("getWorkerLineageIndicator", () => {
  it("returns null for a root orchestrator with null lineage fields", () => {
    expect(
      getWorkerLineageIndicator({
        thread: rootThread,
        threads: [rootThread],
        projects: [orchestratorProject],
      }),
    ).toBeNull();
  });

  it("returns null for a worker whose lineage resolves cleanly", () => {
    expect(getIndicatorForWorker()).toBeNull();
  });

  it("returns info when only workflowId is missing", () => {
    const indicator = getIndicatorForWorker({ workflowId: undefined });

    expect(indicator).toMatchObject({
      severity: "info",
      label: "Worker lineage note",
      description: "Worker lineage note: Missing workflowId.",
    });
    expect(indicator?.issues).toEqual([
      {
        key: "missing-workflow-id",
        severity: "info",
        message: "Missing workflowId.",
      },
    ]);
  });

  it("returns error for missing orchestrator linkage", () => {
    const indicator = getIndicatorForWorker({
      orchestratorProjectId: undefined,
      orchestratorThreadId: undefined,
    });

    expect(indicator).toMatchObject({
      severity: "error",
      label: "Worker ownership problem",
    });
    expect(indicator?.issues.map((issue) => [issue.key, issue.severity])).toEqual([
      ["missing-orchestrator-project-id", "error"],
      ["missing-orchestrator-thread-id", "error"],
    ]);
  });

  it("returns error for unknown orchestrator linkage", () => {
    const indicator = getIndicatorForWorker(
      {
        orchestratorProjectId: ProjectId.makeUnsafe("missing-project"),
        orchestratorThreadId: ThreadId.makeUnsafe("missing-root"),
      },
      {
        threads: [rootThread, makeThread()],
        projects: [makeProject(), orchestratorProject],
      },
    );

    expect(indicator).toMatchObject({
      severity: "error",
      label: "Worker ownership problem",
    });
    expect(indicator?.issues.map((issue) => [issue.key, issue.severity])).toEqual([
      ["unknown-orchestrator-project", "error"],
      ["unknown-orchestrator-thread", "error"],
    ]);
  });

  it("returns warning for missing parent linkage", () => {
    const indicator = getIndicatorForWorker({ parentThreadId: undefined });

    expect(indicator).toMatchObject({
      severity: "warning",
      label: "Worker lineage warning",
    });
    expect(indicator?.issues).toEqual([
      {
        key: "missing-parent-thread-id",
        severity: "warning",
        message: "Missing parentThreadId.",
      },
    ]);
  });

  it("returns warning for unknown parent linkage", () => {
    const indicator = getIndicatorForWorker({
      parentThreadId: ThreadId.makeUnsafe("missing-parent"),
    });

    expect(indicator).toMatchObject({
      severity: "warning",
      label: "Worker lineage warning",
    });
    expect(indicator?.issues.map((issue) => [issue.key, issue.severity])).toEqual([
      ["unknown-parent-thread", "warning"],
    ]);
  });

  it("uses the highest severity while preserving every issue message", () => {
    const indicator = getIndicatorForWorker({
      orchestratorThreadId: undefined,
      parentThreadId: undefined,
      workflowId: undefined,
    });

    expect(indicator).toMatchObject({
      severity: "error",
      label: "Worker ownership problem",
    });
    expect(indicator?.description).toBe(
      "Worker ownership problem: Missing orchestratorThreadId. Missing parentThreadId. Missing workflowId.",
    );
    expect(indicator?.issues.map((issue) => [issue.key, issue.severity, issue.message])).toEqual([
      ["missing-orchestrator-thread-id", "error", "Missing orchestratorThreadId."],
      ["missing-parent-thread-id", "warning", "Missing parentThreadId."],
      ["missing-workflow-id", "info", "Missing workflowId."],
    ]);
  });
});
