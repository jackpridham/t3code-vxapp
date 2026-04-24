import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  collectIdeDrawerThreads,
  resolveIdeDrawerPrimaryThreadId,
  resolveIdeExplorerRoot,
} from "./ide";

type IdeDrawerThread = Parameters<typeof collectIdeDrawerThreads>[0]["threads"][number];
type IdeDrawerProject = Parameters<typeof collectIdeDrawerThreads>[0]["projects"][number];

function makeProject(overrides: Partial<IdeDrawerProject> = {}): IdeDrawerProject {
  return {
    cwd: "/repo/app",
    id: ProjectId.makeUnsafe("project-app"),
    kind: "project",
    name: "App",
    sidebarParentProjectId: undefined,
    ...overrides,
  };
}

function makeThread(overrides: Partial<IdeDrawerThread> = {}): IdeDrawerThread {
  return {
    archivedAt: null,
    createdAt: "2026-04-24T10:00:00.000Z",
    executiveProjectId: undefined,
    executiveThreadId: undefined,
    id: ThreadId.makeUnsafe("thread-app"),
    labels: undefined,
    modelSelection: {
      model: "gpt-5",
      provider: "codex",
    },
    orchestratorProjectId: undefined,
    orchestratorThreadId: undefined,
    parentThreadId: undefined,
    projectId: ProjectId.makeUnsafe("project-app"),
    session: null,
    spawnRole: undefined,
    spawnedBy: undefined,
    title: "App Thread",
    updatedAt: "2026-04-24T10:05:00.000Z",
    worktreePath: "/repo/app",
    workflowId: undefined,
    ...overrides,
  };
}

describe("collectIdeDrawerThreads", () => {
  it("keeps threads within the active canonical project bucket", () => {
    const rootProject = makeProject({
      cwd: "/repo/app",
      id: ProjectId.makeUnsafe("project-root"),
      name: "Root",
    });
    const childProject = makeProject({
      cwd: "/repo/app/packages/child",
      id: ProjectId.makeUnsafe("project-child"),
      name: "Child",
      sidebarParentProjectId: rootProject.id,
    });
    const otherProject = makeProject({
      cwd: "/repo/other",
      id: ProjectId.makeUnsafe("project-other"),
      name: "Other",
    });

    const activeThread = makeThread({
      id: ThreadId.makeUnsafe("thread-child"),
      projectId: childProject.id,
      updatedAt: "2026-04-24T10:05:00.000Z",
      worktreePath: "/repo/app/packages/child",
    });
    const siblingThread = makeThread({
      id: ThreadId.makeUnsafe("thread-root"),
      projectId: rootProject.id,
      updatedAt: "2026-04-24T10:10:00.000Z",
      worktreePath: "/repo/app",
    });
    const otherThread = makeThread({
      id: ThreadId.makeUnsafe("thread-other"),
      projectId: otherProject.id,
      updatedAt: "2026-04-24T10:20:00.000Z",
      worktreePath: "/repo/other",
    });

    const threads = collectIdeDrawerThreads({
      activeThreadId: activeThread.id,
      projects: [rootProject, childProject, otherProject],
      threads: [activeThread, siblingThread, otherThread],
    });

    expect(threads.map((thread) => thread.id)).toEqual([siblingThread.id, activeThread.id]);
  });

  it("includes explicitly linked special-project threads in the drawer list", () => {
    const project = makeProject({
      id: ProjectId.makeUnsafe("project-app"),
    });
    const executiveProject = makeProject({
      cwd: "/repo/app/.vx/executive",
      id: ProjectId.makeUnsafe("project-executive"),
      kind: "executive",
      name: "Executive",
    });
    const activeThread = makeThread({
      executiveProjectId: executiveProject.id,
      id: ThreadId.makeUnsafe("thread-app"),
      projectId: project.id,
    });
    const executiveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-executive"),
      projectId: executiveProject.id,
      updatedAt: "2026-04-24T11:00:00.000Z",
      worktreePath: "/repo/app/.vx/executive",
    });

    const threads = collectIdeDrawerThreads({
      activeThreadId: activeThread.id,
      projects: [project, executiveProject],
      threads: [activeThread, executiveThread],
    });

    expect(threads.map((thread) => thread.id)).toEqual([executiveThread.id, activeThread.id]);
  });
});

describe("resolveIdeExplorerRoot", () => {
  it("prefers the canonical parent project cwd over the active worktree path", () => {
    const rootProject = makeProject({
      cwd: "/repo/app",
      id: ProjectId.makeUnsafe("project-root"),
      name: "Root",
    });
    const childProject = makeProject({
      cwd: "/repo/app/.worktrees/feature-a",
      id: ProjectId.makeUnsafe("project-child"),
      name: "Feature A",
      sidebarParentProjectId: rootProject.id,
    });
    const activeThread = makeThread({
      id: ThreadId.makeUnsafe("thread-child"),
      projectId: childProject.id,
      worktreePath: "/repo/app/.worktrees/feature-a",
    });

    expect(
      resolveIdeExplorerRoot({
        activeThreadId: activeThread.id,
        projects: [rootProject, childProject],
        threads: [activeThread],
      }),
    ).toEqual({
      cwd: rootProject.cwd,
      projectId: rootProject.id,
      projectName: rootProject.name,
    });
  });

  it("falls back to the thread worktree when no canonical project cwd resolves", () => {
    const orphanThread = makeThread({
      id: ThreadId.makeUnsafe("thread-orphan"),
      projectId: ProjectId.makeUnsafe("missing-project"),
      worktreePath: "/repo/app/.worktrees/feature-b",
    });

    expect(
      resolveIdeExplorerRoot({
        activeThreadId: orphanThread.id,
        projects: [],
        threads: [orphanThread],
      }),
    ).toEqual({
      cwd: orphanThread.worktreePath,
      projectId: null,
      projectName: null,
    });
  });
});

describe("resolveIdeDrawerPrimaryThreadId", () => {
  it("prefers the linked executive project thread", () => {
    const project = makeProject();
    const executiveProject = makeProject({
      cwd: "/repo/app/.vx/executive",
      id: ProjectId.makeUnsafe("project-executive"),
      kind: "executive",
      name: "Executive",
    });
    const activeThread = makeThread({
      executiveProjectId: executiveProject.id,
      id: ThreadId.makeUnsafe("thread-active"),
      projectId: project.id,
    });
    const executiveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-executive"),
      projectId: executiveProject.id,
      updatedAt: "2026-04-24T11:00:00.000Z",
      worktreePath: "/repo/app/.vx/executive",
    });

    expect(
      resolveIdeDrawerPrimaryThreadId({
        activeThreadId: activeThread.id,
        kind: "executive",
        projects: [project, executiveProject],
        threads: [activeThread, executiveThread],
      }),
    ).toBe(executiveThread.id);
  });

  it("prefers the executive project's selected root thread over recency", () => {
    const project = makeProject();
    const executiveProject = makeProject({
      cwd: "/repo/app/.vx/executive",
      currentSessionRootThreadId: ThreadId.makeUnsafe("thread-executive-selected"),
      id: ProjectId.makeUnsafe("project-executive"),
      kind: "executive",
      name: "Executive",
    });
    const activeThread = makeThread({
      executiveProjectId: executiveProject.id,
      id: ThreadId.makeUnsafe("thread-active"),
      projectId: project.id,
    });
    const selectedExecutiveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-executive-selected"),
      projectId: executiveProject.id,
      updatedAt: "2026-04-24T09:00:00.000Z",
      worktreePath: "/repo/app/.vx/executive",
    });
    const newerExecutiveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-executive-newer"),
      projectId: executiveProject.id,
      updatedAt: "2026-04-24T12:00:00.000Z",
      worktreePath: "/repo/app/.vx/executive",
    });

    expect(
      resolveIdeDrawerPrimaryThreadId({
        activeThreadId: activeThread.id,
        kind: "executive",
        projects: [project, executiveProject],
        threads: [activeThread, selectedExecutiveThread, newerExecutiveThread],
      }),
    ).toBe(selectedExecutiveThread.id);
  });

  it("prefers the linked orchestrator project thread", () => {
    const project = makeProject();
    const orchestratorProject = makeProject({
      cwd: "/repo/app/.vx/orchestrator",
      id: ProjectId.makeUnsafe("project-orchestrator"),
      kind: "orchestrator",
      name: "Orchestrator",
    });
    const activeThread = makeThread({
      id: ThreadId.makeUnsafe("thread-active"),
      orchestratorProjectId: orchestratorProject.id,
      projectId: project.id,
    });
    const orchestratorThread = makeThread({
      id: ThreadId.makeUnsafe("thread-orchestrator"),
      projectId: orchestratorProject.id,
      spawnRole: "orchestrator",
      updatedAt: "2026-04-24T11:00:00.000Z",
      worktreePath: "/repo/app/.vx/orchestrator",
    });

    expect(
      resolveIdeDrawerPrimaryThreadId({
        activeThreadId: activeThread.id,
        kind: "orchestrator",
        projects: [project, orchestratorProject],
        threads: [activeThread, orchestratorThread],
      }),
    ).toBe(orchestratorThread.id);
  });

  it("falls back to the parent orchestrator thread for worker threads", () => {
    const project = makeProject();
    const orchestratorThread = makeThread({
      id: ThreadId.makeUnsafe("thread-orchestrator"),
      projectId: project.id,
      spawnRole: "orchestrator",
      updatedAt: "2026-04-24T11:00:00.000Z",
    });
    const workerThread = makeThread({
      id: ThreadId.makeUnsafe("thread-worker"),
      parentThreadId: orchestratorThread.id,
      projectId: project.id,
      spawnRole: "worker",
      updatedAt: "2026-04-24T11:05:00.000Z",
    });

    expect(
      resolveIdeDrawerPrimaryThreadId({
        activeThreadId: workerThread.id,
        kind: "orchestrator",
        projects: [project],
        threads: [orchestratorThread, workerThread],
      }),
    ).toBe(orchestratorThread.id);
  });
});
