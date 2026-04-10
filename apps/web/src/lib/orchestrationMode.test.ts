import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Project, Thread } from "../types";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import {
  buildOrchestrationModeRowDescriptor,
  buildOrchestrationSessionCatalog,
  collapseThreadToCanonicalProject,
  collectSessionThreadIds,
} from "./orchestrationMode";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    labels: [],
    modelSelection: {
      provider: "codex",
      model: "gpt-5.4",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    persistedFileChanges: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-10T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-04-10T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project 1",
    cwd: "/tmp/project-1",
    kind: "project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.4",
    },
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    scripts: [],
    hooks: [],
    ...overrides,
  };
}

describe("buildOrchestrationSessionCatalog", () => {
  it("builds distinct catalog entries for explicit orchestrator roots", () => {
    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("root-new"),
        title: "New root",
        spawnRole: "orchestrator",
        createdAt: "2026-04-10T02:00:00.000Z",
        updatedAt: "2026-04-10T02:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("worker-new"),
        title: "New worker",
        projectId: ProjectId.makeUnsafe("project-worker"),
        parentThreadId: ThreadId.makeUnsafe("root-new"),
        orchestratorThreadId: ThreadId.makeUnsafe("root-new"),
      }),
      makeThread({
        id: ThreadId.makeUnsafe("root-old"),
        title: "Old root",
        spawnRole: "orchestrator",
        createdAt: "2026-04-09T02:00:00.000Z",
        updatedAt: "2026-04-09T02:00:00.000Z",
      }),
    ];

    expect(buildOrchestrationSessionCatalog({ threads })).toMatchObject([
      {
        rootThreadId: "root-new",
        workerThreadCount: 1,
      },
      {
        rootThreadId: "root-old",
        workerThreadCount: 0,
      },
    ]);
  });

  it("falls back to lineage references when older data lacks an explicit orchestrator role", () => {
    const root = makeThread({
      id: ThreadId.makeUnsafe("root-legacy"),
      title: "Legacy root",
      spawnRole: undefined,
    });
    const worker = makeThread({
      id: ThreadId.makeUnsafe("worker-legacy"),
      projectId: ProjectId.makeUnsafe("project-worker"),
      spawnedBy: "root-legacy",
      parentThreadId: ThreadId.makeUnsafe("root-legacy"),
    });

    expect(buildOrchestrationSessionCatalog({ threads: [root, worker] })).toMatchObject([
      {
        rootThreadId: "root-legacy",
        workerThreadCount: 1,
      },
    ]);
  });
});

describe("collectSessionThreadIds", () => {
  it("collects one session subtree and excludes workers from another root", () => {
    const rootThreadId = ThreadId.makeUnsafe("root-a");
    const threads = [
      makeThread({
        id: rootThreadId,
        spawnRole: "orchestrator",
        workflowId: "wf-a",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("worker-a-1"),
        orchestratorThreadId: rootThreadId,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("worker-a-2"),
        parentThreadId: ThreadId.makeUnsafe("worker-a-1"),
      }),
      makeThread({
        id: ThreadId.makeUnsafe("root-b"),
        spawnRole: "orchestrator",
        workflowId: "wf-b",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("worker-b-1"),
        orchestratorThreadId: ThreadId.makeUnsafe("root-b"),
      }),
    ];

    expect([...collectSessionThreadIds({ rootThreadId, threads })]).toEqual([
      "root-a",
      "worker-a-1",
      "worker-a-2",
    ]);
  });
});

describe("collapseThreadToCanonicalProject", () => {
  it("keeps same-project worktrees under their real project bucket", () => {
    const projects = [
      makeProject({
        id: ProjectId.makeUnsafe("project-worker-a"),
        name: "Worker A",
        cwd: "/tmp/worker-a",
      }),
    ];

    expect(
      collapseThreadToCanonicalProject({
        thread: {
          projectId: ProjectId.makeUnsafe("project-worker-a"),
          worktreePath: "/tmp/worker-a/worktrees/worker-a-1",
          orchestratorProjectId: ProjectId.makeUnsafe("project-orchestrator"),
        },
        projects,
      }),
    ).toMatchObject({
      canonicalProjectId: "project-worker-a",
      canonicalProjectName: "Worker A",
    });
  });

  it("keeps cross-project workers separated even when they share an orchestrator project id", () => {
    const projects = [
      makeProject({
        id: ProjectId.makeUnsafe("project-orchestrator"),
        name: "Orchestrator",
        cwd: "/tmp/orchestrator",
        kind: "orchestrator",
      }),
      makeProject({
        id: ProjectId.makeUnsafe("project-worker-a"),
        name: "Worker A",
        cwd: "/tmp/worker-a",
      }),
      makeProject({
        id: ProjectId.makeUnsafe("project-worker-b"),
        name: "Worker B",
        cwd: "/tmp/worker-b",
      }),
    ];

    const workerA = collapseThreadToCanonicalProject({
      thread: {
        projectId: ProjectId.makeUnsafe("project-worker-a"),
        worktreePath: "/tmp/worker-a",
        orchestratorProjectId: ProjectId.makeUnsafe("project-orchestrator"),
      },
      projects,
    });
    const workerB = collapseThreadToCanonicalProject({
      thread: {
        projectId: ProjectId.makeUnsafe("project-worker-b"),
        worktreePath: "/tmp/worker-b",
        orchestratorProjectId: ProjectId.makeUnsafe("project-orchestrator"),
      },
      projects,
    });

    expect(workerA).toMatchObject({
      canonicalProjectId: "project-worker-a",
      canonicalProjectName: "Worker A",
    });
    expect(workerB).toMatchObject({
      canonicalProjectId: "project-worker-b",
      canonicalProjectName: "Worker B",
    });
  });
});

describe("buildOrchestrationModeRowDescriptor", () => {
  it("builds label-first badges and keeps the model visible", () => {
    const descriptor = buildOrchestrationModeRowDescriptor({
      thread: makeThread({
        id: ThreadId.makeUnsafe("thread-labeled"),
        labels: ["worker", "worker", "needs-review"],
        spawnRole: "worker",
      }),
    });

    expect(descriptor.accessibleTitle).toBe("Thread");
    expect(descriptor.visibleBadges.map((badge) => badge.label)).toEqual([
      "worker",
      "needs-review",
      "gpt-5.4",
    ]);
  });

  it("falls back to role and model badges when labels are missing", () => {
    const descriptor = buildOrchestrationModeRowDescriptor({
      thread: makeThread({
        id: ThreadId.makeUnsafe("thread-unlabeled"),
        labels: [],
        spawnRole: "worker",
      }),
    });

    expect(descriptor.visibleBadges.map((badge) => badge.label)).toEqual(["worker", "gpt-5.4"]);
  });
});
