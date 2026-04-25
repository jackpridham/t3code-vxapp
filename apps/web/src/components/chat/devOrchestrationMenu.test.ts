import { ProgramId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildDevProgramNotificationCommand,
  buildDevWakeUpsertCommand,
  resolveDevOrchestratorTargets,
  resolveDevProgramTargets,
} from "./devOrchestrationMenu";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Program,
  type Project,
  type Thread,
} from "../../types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project",
    cwd: "/tmp/project",
    kind: "project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    scripts: [],
    hooks: [],
    ...overrides,
  };
}

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: ProgramId.makeUnsafe("program-1"),
    title: "Program One",
    objective: null,
    status: "active",
    executiveProjectId: ProjectId.makeUnsafe("project-exec"),
    executiveThreadId: ThreadId.makeUnsafe("thread-exec"),
    currentOrchestratorThreadId: ThreadId.makeUnsafe("thread-orch"),
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread One",
    labels: [],
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-26T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    persistedFileChanges: [],
    activities: [],
    ...overrides,
  };
}

describe("devOrchestrationMenu", () => {
  it("resolves a program target for an executive thread and carries orchestrator project metadata", () => {
    const executiveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-exec"),
      projectId: ProjectId.makeUnsafe("project-exec"),
      title: "Executive Thread",
      programId: "program-1",
      executiveProjectId: "project-exec",
      executiveThreadId: "thread-exec",
    });
    const orchestratorThread = makeThread({
      id: ThreadId.makeUnsafe("thread-orch"),
      projectId: ProjectId.makeUnsafe("project-orch"),
      title: "Orchestrator Thread",
      spawnRole: "orchestrator",
    });

    const targets = resolveDevProgramTargets({
      thread: executiveThread,
      project: makeProject({
        id: ProjectId.makeUnsafe("project-exec"),
        kind: "executive",
      }),
      programs: [makeProgram()],
      threads: [executiveThread, orchestratorThread],
    });

    expect(targets).toEqual([
      expect.objectContaining({
        programId: "program-1",
        executiveThreadId: "thread-exec",
        orchestratorThreadId: "thread-orch",
        orchestratorProjectId: "project-orch",
        roles: expect.arrayContaining(["executive"]),
      }),
    ]);
  });

  it("resolves an orchestrator wake target from the active orchestrator thread even without lineage metadata", () => {
    const orchestratorThread = makeThread({
      id: ThreadId.makeUnsafe("thread-orch"),
      projectId: ProjectId.makeUnsafe("project-orch"),
      title: "Orchestrator Thread",
      spawnRole: "orchestrator",
    });

    const wakeTargets = resolveDevOrchestratorTargets({
      thread: orchestratorThread,
      project: makeProject({
        id: ProjectId.makeUnsafe("project-orch"),
        kind: "orchestrator",
      }),
      threads: [orchestratorThread],
      programTargets: [],
    });

    expect(wakeTargets).toEqual([
      expect.objectContaining({
        orchestratorThreadId: "thread-orch",
        orchestratorProjectId: "project-orch",
      }),
    ]);
  });

  it("builds a program notification upsert command with resolved executive and orchestrator ids", () => {
    const executiveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-exec"),
      projectId: ProjectId.makeUnsafe("project-exec"),
      title: "Executive Thread",
      programId: "program-1",
      executiveProjectId: "project-exec",
      executiveThreadId: "thread-exec",
    });
    const target = resolveDevProgramTargets({
      thread: executiveThread,
      project: makeProject({
        id: ProjectId.makeUnsafe("project-exec"),
        kind: "executive",
      }),
      programs: [makeProgram()],
      threads: [
        executiveThread,
        makeThread({
          id: ThreadId.makeUnsafe("thread-orch"),
          projectId: ProjectId.makeUnsafe("project-orch"),
        }),
      ],
    })[0];

    expect(target).toBeDefined();
    if (!target) {
      throw new Error("Expected dev program target.");
    }

    const command = buildDevProgramNotificationCommand({
      target,
      sourceThread: executiveThread,
      kind: "decision_required",
      now: "2026-04-26T01:02:03.000Z",
    });

    expect(command).toMatchObject({
      type: "program.notification.upsert",
      programId: "program-1",
      executiveProjectId: "project-exec",
      executiveThreadId: "thread-exec",
      orchestratorThreadId: "thread-orch",
      kind: "decision_required",
      severity: "warning",
      queuedAt: "2026-04-26T01:02:03.000Z",
      createdAt: "2026-04-26T01:02:03.000Z",
      evidence: expect.objectContaining({
        devMenu: true,
        sourceThreadId: "thread-exec",
        sourceRole: "executive",
        programId: "program-1",
      }),
    });
  });

  it("builds a wake upsert command and uses a synthetic worker id when targeting the active orchestrator thread itself", () => {
    const orchestratorThread = makeThread({
      id: ThreadId.makeUnsafe("thread-orch"),
      projectId: ProjectId.makeUnsafe("project-orch"),
      title: "Orchestrator Thread",
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-orch-latest"),
        state: "completed",
        requestedAt: "2026-04-26T00:00:00.000Z",
        startedAt: "2026-04-26T00:00:01.000Z",
        completedAt: "2026-04-26T00:00:02.000Z",
        assistantMessageId: null,
      },
      spawnRole: "orchestrator",
    });

    const command = buildDevWakeUpsertCommand({
      target: {
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch"),
        orchestratorProjectId: ProjectId.makeUnsafe("project-orch"),
        programId: ProgramId.makeUnsafe("program-1"),
        programTitle: "Program One",
      },
      sourceThread: orchestratorThread,
      outcome: "failed",
      now: "2026-04-26T02:03:04.000Z",
    });

    expect(command).toMatchObject({
      type: "thread.orchestrator-wake.upsert",
      threadId: "thread-orch",
      createdAt: "2026-04-26T02:03:04.000Z",
      wakeItem: expect.objectContaining({
        orchestratorThreadId: "thread-orch",
        orchestratorProjectId: "project-orch",
        workerProjectId: "project-orch",
        workerTurnId: "turn-orch-latest",
        outcome: "failed",
        state: "pending",
      }),
    });
    expect(command.wakeItem.workerThreadId).not.toBe("thread-orch");
  });
});
