import { describe, expect, it } from "vitest";
import {
  type AgentsVxappSidebarAuthorityRuntimeTarget,
  ProgramId,
  ProjectId,
  ThreadId,
  type ServerAgentsVxappProgramSnapshot,
  type ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  type ServerGetAgentsVxappSidebarGraphResult,
} from "@t3tools/contracts";
import {
  buildOrchestrationSidebarModel,
  resolveSidebarRootThreadIds,
} from "./orchestrationSidebarModel";
import type { Project, Thread } from "~/types";

function makeProject(input: Partial<Project> & Pick<Project, "id" | "name" | "cwd">): Project {
  return {
    currentSessionRootThreadId: null,
    defaultModelSelection: null,
    hooks: [],
    scripts: [],
    ...input,
  };
}

function makeThread(input: Partial<Thread> & Pick<Thread, "id" | "projectId" | "title">): Thread {
  const { id, projectId, title, ...rest } = input;
  return {
    activities: [],
    archivedAt: null,
    branch: null,
    codexThreadId: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    error: null,
    hasActiveError: false,
    activeError: null,
    historicalError: null,
    errorPresentationSource: "none",
    id,
    interactionMode: "default",
    latestTurn: null,
    messages: [],
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    persistedFileChanges: [],
    projectId,
    proposedPlans: [],
    runtimeMode: "full-access",
    session: null,
    title,
    turnDiffSummaries: [],
    updatedAt: "2026-05-10T00:00:00.000Z",
    worktreePath: null,
    ...rest,
  } as Thread;
}

function makeProgram(
  input: Partial<ServerAgentsVxappProgramSnapshot> &
    Pick<ServerAgentsVxappProgramSnapshot, "id" | "title" | "status">,
): ServerAgentsVxappProgramSnapshot {
  return {
    baseStatus: input.status,
    completedAt: null,
    currentStatus: input.status,
    currentOrchestratorThreadId: null,
    deletedAt: null,
    executiveProjectId: ProjectId.makeUnsafe("exec-project"),
    executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
    metadata: null,
    closeout: null,
    objective: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...input,
  };
}

function makeSqliteGraph(
  overrides: Partial<ServerGetAgentsVxappSidebarGraphResult> = {},
): ServerGetAgentsVxappSidebarGraphResult {
  return {
    attentionItems: [],
    dbPath: "/tmp/.vx/agents-vxapp/state/vx_agents.sqlite3",
    fallbackReason: null,
    mirrorDiagnostics: {
      missingProjectIds: [],
      missingThreadIds: [],
      staleMirror: false,
    },
    notifications: [],
    openWakes: [],
    source: "sqlite",
    threadLinks: [],
    watchProjections: [],
    ...overrides,
  };
}

function makeAuthorityRuntimeTarget(
  overrides: Partial<AgentsVxappSidebarAuthorityRuntimeTarget> = {},
): AgentsVxappSidebarAuthorityRuntimeTarget {
  return {
    agentKind: "worker",
    availability: "inspectable",
    kind: "worker",
    reasonCode: null,
    threadId: null,
    workspace: null,
    ...overrides,
  };
}

function makeAuthoritySnapshot(
  overrides: Partial<ServerGetAgentsVxappSidebarAuthoritySnapshotResult> = {},
): ServerGetAgentsVxappSidebarAuthoritySnapshotResult {
  return {
    currentTodos: [],
    ownerDiagnostics: [],
    programs: [],
    todos: [],
    ...overrides,
  };
}

describe("buildOrchestrationSidebarModel", () => {
  it("prefers sqlite worker lineage and merges live worker threads", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [
        {
          attentionId: "attention-1" as any,
          executiveProjectId: ProjectId.makeUnsafe("exec-project"),
          executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
          kind: "blocked",
          programId: ProgramId.makeUnsafe("program-1"),
          queuedAt: "2026-05-10T00:00:00.000Z",
          severity: "warning",
          sourceThreadId: ThreadId.makeUnsafe("worker-1"),
          state: "required",
          summary: "Needs review",
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        } as any,
      ],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("worker-project"),
          name: "api-vxapp",
          cwd: "/api",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map([
        [
          ThreadId.makeUnsafe("orch-1"),
          [
            {
              id: ThreadId.makeUnsafe("worker-1"),
              latestTurn: null,
              orchestratorProjectId: ProjectId.makeUnsafe("exec-project"),
              projectId: ProjectId.makeUnsafe("worker-project"),
              session: null,
              spawnRole: "worker",
              title: "worker/ket Repair the OAuth callback flow",
              worktreePath: "/api",
            },
          ],
        ],
      ]),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator live",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-1"),
          projectId: ProjectId.makeUnsafe("worker-project"),
          title: "worker/ket Repair the OAuth callback flow",
          spawnRole: "worker",
        }),
      ],
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-1"),
            title: "Orchestrator sqlite",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch",
            worktreePath: "/orch",
          },
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("worker-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-1"),
            title: "Worker sqlite",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/api",
            worktreePath: "/api",
          },
        ],
      }),
      wakeItems: [],
    });

    expect(model.source).toBe("sqlite");
    expect(model.executives).toHaveLength(1);
    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.thread?.title).toBe(
      "worker/ket Repair the OAuth callback flow",
    );
    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.title).toBe(
      "Repair the OAuth callback flow",
    );
    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.provenanceLabel).toBe(
      "api-vxapp",
    );
    expect(model.executives[0]?.notifications).toHaveLength(1);
  });

  it("creates an unassigned executive bucket for programs without an executive project", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          executiveProjectId: null as never,
          executiveThreadId: null as never,
          id: ProgramId.makeUnsafe("program-1"),
          title: "No Executive",
          status: "active",
        }),
      ],
      projects: [],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [],
      wakeItems: [],
    });

    expect(model.executives).toHaveLength(1);
    expect(model.executives[0]?.label).toBe("Unassigned Executive");
    expect(model.diagnostics.staleMirror).toBe(false);
  });

  it("uses hydrated project rows to label executive sidebar buckets without sqlite graph help", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          executiveProjectId: ProjectId.makeUnsafe("exec-project"),
          executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Hydrated Program",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "Executive Project",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [],
      wakeItems: [],
    });

    expect(model.executives).toHaveLength(1);
    expect(model.executives[0]?.label).toBe("Executive Project");
    expect(model.executives[0]?.programs[0]?.title).toBe("Hydrated Program");
  });

  it("excludes terminal programs from the sidebar portfolio", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-active"),
          id: ProgramId.makeUnsafe("program-active"),
          title: "Active Program",
          status: "active",
        }),
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-completed"),
          id: ProgramId.makeUnsafe("program-completed"),
          title: "Completed Program",
          status: "completed",
        }),
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-cancelled"),
          id: ProgramId.makeUnsafe("program-cancelled"),
          title: "Cancelled Program",
          status: "cancelled",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs.map((program) => program.id)).toEqual(["program-active"]);
    expect(
      resolveSidebarRootThreadIds({
        programs: [
          makeProgram({
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-active"),
            id: ProgramId.makeUnsafe("program-active"),
            title: "Active Program",
            status: "active",
          }),
          makeProgram({
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-completed"),
            id: ProgramId.makeUnsafe("program-completed"),
            title: "Completed Program",
            status: "completed",
          }),
        ],
      }),
    ).toEqual([ThreadId.makeUnsafe("orch-active")]);
  });

  it("preserves authoritative program status fields on sidebar nodes", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          baseStatus: "active",
          currentStatus: "blocked",
          id: ProgramId.makeUnsafe("program-1"),
          title: "Blocked Program",
          status: "blocked",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]).toMatchObject({
      baseStatus: "active",
      currentStatus: "blocked",
      status: "blocked",
    });
  });

  it("uses owner-published workers and suppresses base status in authority mode", () => {
    const program = makeProgram({
      baseStatus: "active",
      currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
      currentStatus: "blocked",
      id: ProgramId.makeUnsafe("program-1"),
      title: "Blocked Program",
      status: "blocked",
    });

    const model = buildOrchestrationSidebarModel({
      authoritySnapshot: makeAuthoritySnapshot({
        programs: [
          {
            activeAllocations: [],
            attentionItems: [],
            currentTodo: null,
            display: {
              label: "Control-plane repair required",
              sortKey: null,
              summary: null,
              tone: "danger",
            },
            executive: makeAuthorityRuntimeTarget({
              agentKind: "executive",
              availability: "unavailable",
              kind: "executive",
              reasonCode: "runtime_authority_missing",
            }),
            notifications: [],
            openWakes: [],
            orchestrator: makeAuthorityRuntimeTarget({
              agentKind: "orchestrator",
              availability: "unavailable",
              kind: "orchestrator",
              reasonCode: "runtime_authority_missing",
              threadId: ThreadId.makeUnsafe("orch-1"),
            }),
            ownerDiagnostics: [],
            program,
            watchProjection: null,
            workers: [],
          },
        ],
      }),
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [program],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator live",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-residue"),
          orchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          programId: ProgramId.makeUnsafe("program-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          spawnRole: "worker",
          title: "worker/ket Residual worker",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]).toMatchObject({
      activeWorkerCount: 0,
      baseStatus: null,
      currentStatus: "blocked",
    });
    expect(model.executives[0]?.programs[0]?.currentLane?.workers).toEqual([]);
  });

  it("attaches current todo, watch state, closeout summary, and worker counts to programs", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      currentTodos: [
        {
          agent: "jasper",
          createdAt: "2026-05-10T00:00:00.000Z",
          programId: ProgramId.makeUnsafe("program-1"),
          todoId: "todo-123" as any,
          updatedAt: "2026-05-10T00:00:01.000Z",
        } as any,
      ],
      programNotifications: [],
      programs: [
        makeProgram({
          closeout: {
            closeout: {
              lastMissing: ["PR missing"],
            },
            scope: {
              declaredRepos: ["api-vxapp"],
              appTargets: ["api"],
              requiredExternalE2ESuites: [],
              requiredLocalSuites: ["pnpm:type-check"],
            },
          },
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Blocked Program",
          status: "blocked",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map([
        [
          ThreadId.makeUnsafe("orch-1"),
          [
            {
              id: ThreadId.makeUnsafe("worker-1"),
              latestTurn: null,
              orchestratorProjectId: ProjectId.makeUnsafe("exec-project"),
              projectId: ProjectId.makeUnsafe("exec-project"),
              session: null,
              spawnRole: "worker",
              title: "worker/ket Validation worker",
              worktreePath: "/worker-1",
            },
          ],
        ],
      ]),
      sqliteGraph: makeSqliteGraph({
        watchProjections: [
          {
            classification: "awaiting_external",
            createdAt: "2026-05-10T00:00:00.000Z",
            enabled: true,
            programId: ProgramId.makeUnsafe("program-1"),
            reason: "Waiting for vendor callback proof.",
            updatedAt: "2026-05-10T00:00:01.000Z",
            watchId: "watch-1" as any,
          } as any,
        ],
      }),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-1"),
          orchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          spawnRole: "worker",
          title: "worker/ket Validation worker",
          worktreePath: "/worker-1",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]).toMatchObject({
      activeWorkerCount: 1,
      currentTodo: {
        agent: "jasper",
        todoId: "todo-123",
      },
      watch: {
        classification: "awaiting_external",
        enabled: true,
        reason: "Waiting for vendor callback proof.",
      },
    });
    expect(model.executives[0]?.programs[0]?.closeoutSummary.missingItems).toEqual(["PR missing"]);
    expect(model.executives[0]?.programs[0]?.statusDetail).toBeNull();
  });

  it("keeps programs with null roots in an explicit empty orchestrator state", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: null,
          id: ProgramId.makeUnsafe("program-1"),
          title: "No Root",
          status: "founder_review_ready",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane).toBeNull();
    expect(model.executives[0]?.programs[0]?.laneState).toBe("no-active-lane");
    expect(model.executives[0]?.programs[0]?.historicalOrchestratorCount).toBe(0);
    expect(model.executives[0]?.programs[0]?.historicalWorkerCount).toBe(0);
  });

  it("keeps historical lineage visible when a program has no current lane", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: null,
          id: ProgramId.makeUnsafe("program-party"),
          title: "PartyMore.ai launch plan and first delivery wave",
          status: "awaiting_founder",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: "2026-05-09T00:00:00.000Z",
            createdAt: "2026-05-08T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-party"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-older"),
            title: "PartyMore.ai launch plan and first delivery wave",
            updatedAt: "2026-05-09T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch-older",
            worktreePath: "/orch-older",
          },
          {
            archivedAt: "2026-05-10T00:00:00.000Z",
            createdAt: "2026-05-09T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-party"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-latest"),
            title: "PartyMore.ai launch plan and first delivery wave",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch-latest",
            worktreePath: "/orch-latest",
          },
          {
            archivedAt: "2026-05-10T01:00:00.000Z",
            createdAt: "2026-05-10T00:30:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-latest"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-party"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-1"),
            title: "worker/ket Historical worker one",
            updatedAt: "2026-05-10T01:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/worker-1",
            worktreePath: "/worker-1",
          },
          {
            archivedAt: "2026-05-10T01:30:00.000Z",
            createdAt: "2026-05-10T01:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-latest"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-party"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-2"),
            title: "worker/jono Historical worker two",
            updatedAt: "2026-05-10T01:30:00.000Z",
            workflowId: null,
            workspaceRoot: "/worker-2",
            worktreePath: "/worker-2",
          },
        ],
      }),
      threads: [],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane).toBeNull();
    expect(model.executives[0]?.programs[0]?.laneState).toBe("no-active-lane");
    expect(model.executives[0]?.programs[0]?.historicalOrchestratorCount).toBe(1);
    expect(model.executives[0]?.programs[0]?.historicalWorkerCount).toBe(2);
    expect(model.executives[0]?.programs[0]?.lastHistoricalLane?.id).toBe("orch-latest");
    expect(model.executives[0]?.programs[0]?.historicalLanes.map((lane) => lane.id)).toEqual([
      "orch-latest",
    ]);
    expect(
      model.executives[0]?.programs[0]?.historicalLanes.every((lane) => !lane.isActiveNow),
    ).toBe(true);
    expect(
      model.executives[0]?.programs[0]?.historicalLanes[0]?.workers.map((worker) => worker.id),
    ).toEqual(["worker-2", "worker-1"]);
  });

  it("orders programs and workers by current activity", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-idle"),
          id: ProgramId.makeUnsafe("program-idle"),
          title: "Idle Program",
          status: "active",
          updatedAt: "2026-05-10T00:10:00.000Z",
        }),
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-busy"),
          id: ProgramId.makeUnsafe("program-busy"),
          title: "Busy Program",
          status: "active",
          updatedAt: "2026-05-10T00:05:00.000Z",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-idle"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Idle Orchestrator",
          updatedAt: "2026-05-10T00:10:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("idle-worker-older"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "worker/ket Old worker",
          orchestratorThreadId: ThreadId.makeUnsafe("orch-idle"),
          spawnRole: "worker",
          updatedAt: "2026-05-10T00:15:00.000Z",
          worktreePath: "/idle-old",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("idle-worker-newer"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "worker/jono New worker",
          orchestratorThreadId: ThreadId.makeUnsafe("orch-idle"),
          spawnRole: "worker",
          updatedAt: "2026-05-10T00:20:00.000Z",
          worktreePath: "/idle-new",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("orch-busy"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Busy Orchestrator",
          updatedAt: "2026-05-10T00:30:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("busy-worker"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "worker/ket Busy worker",
          latestTurn: {
            assistantMessageId: null,
            completedAt: null,
            requestedAt: "2026-05-10T01:00:00.000Z",
            startedAt: "2026-05-10T01:01:00.000Z",
            state: "running",
            turnId: ThreadId.makeUnsafe("turn-busy") as any,
          } as any,
          orchestratorThreadId: ThreadId.makeUnsafe("orch-busy"),
          session: {
            createdAt: "2026-05-10T01:00:00.000Z",
            orchestrationStatus: "attached",
            provider: "codex",
            status: "running",
            updatedAt: "2026-05-10T01:02:00.000Z",
          } as any,
          spawnRole: "worker",
          updatedAt: "2026-05-10T01:02:00.000Z",
          worktreePath: "/busy",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs.map((program) => program.id)).toEqual([
      "program-busy",
      "program-idle",
    ]);
    expect(
      model.executives[0]?.programs[1]?.currentLane?.workers.map((worker) => worker.id),
    ).toEqual(["idle-worker-newer", "idle-worker-older"]);
  });

  it("keeps current and historical lanes distinct", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map([
        [
          ThreadId.makeUnsafe("orch-live"),
          [
            {
              id: ThreadId.makeUnsafe("worker-live"),
              latestTurn: null,
              orchestratorProjectId: ProjectId.makeUnsafe("exec-project"),
              projectId: ProjectId.makeUnsafe("exec-project"),
              session: null,
              spawnRole: "worker",
              title: "worker/ket Live worker",
              worktreePath: "/worker-live",
            },
          ],
        ],
      ]),
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-live"),
            title: "Live orchestrator",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch-live",
            worktreePath: "/orch-live",
          },
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:10:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-live"),
            title: "worker/ket Live worker",
            updatedAt: "2026-05-10T00:10:00.000Z",
            workflowId: null,
            workspaceRoot: "/worker-live",
            worktreePath: "/worker-live",
          },
          {
            archivedAt: "2026-05-09T00:00:00.000Z",
            createdAt: "2026-05-08T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-archived"),
            title: "Archived orchestrator",
            updatedAt: "2026-05-09T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch-archived",
            worktreePath: "/orch-archived",
          },
          {
            archivedAt: "2026-05-09T01:00:00.000Z",
            createdAt: "2026-05-09T00:30:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-archived"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-archived"),
            title: "worker/jono Archived worker",
            updatedAt: "2026-05-09T01:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/worker-archived",
            worktreePath: "/worker-archived",
          },
        ],
      }),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-live"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Live Orchestrator",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-live"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "worker/ket Live worker",
          orchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
          spawnRole: "worker",
          worktreePath: "/worker-live",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.laneState).toBe("active");
    expect(model.executives[0]?.programs[0]?.currentLane?.id).toBe("orch-live");
    expect(
      model.executives[0]?.programs[0]?.currentLane?.workers.map((worker) => worker.id),
    ).toEqual(["worker-live"]);
    expect(model.executives[0]?.programs[0]?.historicalOrchestratorCount).toBe(1);
    expect(model.executives[0]?.programs[0]?.historicalWorkerCount).toBe(1);
    expect(model.executives[0]?.programs[0]?.lastHistoricalLane?.id).toBe("orch-archived");
    expect(model.executives[0]?.programs[0]?.historicalLanes[0]?.isActiveNow).toBe(false);
  });

  it("hides historical orchestrators that have no associated historical workers", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: null,
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: "2026-05-09T00:00:00.000Z",
            createdAt: "2026-05-08T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: {
              activeTurnId: null,
              lastError: null,
              providerName: "codex",
              runtimeMode: "full-access",
              status: "running",
              threadId: ThreadId.makeUnsafe("orch-empty"),
              updatedAt: "2026-05-10T02:00:00.000Z",
            },
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-empty"),
            title: "Empty historical lane",
            updatedAt: "2026-05-10T02:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch-empty",
            worktreePath: "/orch-empty",
          },
          {
            archivedAt: "2026-05-10T03:00:00.000Z",
            createdAt: "2026-05-10T01:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-kept"),
            title: "Kept historical lane",
            updatedAt: "2026-05-10T03:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch-kept",
            worktreePath: "/orch-kept",
          },
          {
            archivedAt: "2026-05-10T03:30:00.000Z",
            createdAt: "2026-05-10T03:10:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-kept"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-kept"),
            title: "worker/ket Historical worker",
            updatedAt: "2026-05-10T03:30:00.000Z",
            workflowId: null,
            workspaceRoot: "/worker-kept",
            worktreePath: "/worker-kept",
          },
        ],
      }),
      threads: [],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.historicalLanes.map((lane) => lane.id)).toEqual([
      "orch-kept",
    ]);
    expect(model.executives[0]?.programs[0]?.historicalOrchestratorCount).toBe(1);
  });

  it("derives the orchestrator name from generated role-session workspaces instead of 'workspace'", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-role-session"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "PartyMore.ai launch plan and first delivery wave",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("workspace-project"),
          name: "workspace",
          cwd: "/tmp/.agents-vxapp-runtime/role-sessions/jasper/jasper-123/workspace",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("workspace-project"),
            roleSession: {
              role: "jasper",
              sessionId: "jasper-123",
              workspacePath:
                "/home/gizmo/worktrees/.015-1-runtime/role-sessions/jasper/jasper-123/workspace",
            },
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-role-session"),
            title: "PartyMore.ai launch plan and first delivery wave",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/tmp/.agents-vxapp-runtime/role-sessions/jasper/jasper-123/workspace",
            worktreePath: "/tmp/.agents-vxapp-runtime/role-sessions/jasper/jasper-123/workspace",
          },
        ],
      }),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-role-session"),
          projectId: ProjectId.makeUnsafe("workspace-project"),
          title: "PartyMore.ai launch plan and first delivery wave",
          worktreePath: "/tmp/.agents-vxapp-runtime/role-sessions/jasper/jasper-123/workspace",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane?.title).toBe("Jasper");
  });

  it("flags a stale mirrored dev DB when sqlite graph rows do not exist in live T3 state", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-missing"),
          executiveProjectId: ProjectId.makeUnsafe("exec-missing"),
          executiveThreadId: ThreadId.makeUnsafe("exec-thread-missing"),
          id: ProgramId.makeUnsafe("program-missing"),
          title: "Missing Program",
          status: "active",
        }),
      ],
      projects: [],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        mirrorDiagnostics: {
          missingProjectIds: [
            ProjectId.makeUnsafe("exec-missing"),
            ProjectId.makeUnsafe("worker-project-missing"),
          ],
          missingThreadIds: [
            ThreadId.makeUnsafe("exec-thread-missing"),
            ThreadId.makeUnsafe("orch-missing"),
            ThreadId.makeUnsafe("parent-missing"),
            ThreadId.makeUnsafe("worker-missing"),
          ],
          staleMirror: true,
        },
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-missing"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread-missing"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-missing"),
            parentThreadId: ThreadId.makeUnsafe("parent-missing"),
            programId: ProgramId.makeUnsafe("program-missing"),
            projectId: ProjectId.makeUnsafe("worker-project-missing"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "jasper",
            threadId: ThreadId.makeUnsafe("worker-missing"),
            title: "Missing Worker",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/missing",
            worktreePath: "/missing",
          },
        ],
      }),
      threads: [],
      wakeItems: [],
    });

    expect(model.diagnostics.staleMirror).toBe(true);
    expect(model.diagnostics.missingProjectIds).toEqual(["exec-missing", "worker-project-missing"]);
    expect(model.diagnostics.missingThreadIds).toEqual([
      "exec-thread-missing",
      "orch-missing",
      "parent-missing",
      "worker-missing",
    ]);
  });

  it("defaults missing divergent sqlite diagnostics to an empty list", () => {
    const sqliteGraph = makeSqliteGraph({
      mirrorDiagnostics: {
        missingProjectIds: [],
        missingThreadIds: [],
        staleMirror: true,
      } as unknown as ServerGetAgentsVxappSidebarGraphResult["mirrorDiagnostics"],
    });
    delete (sqliteGraph.mirrorDiagnostics as Record<string, unknown>).missingProjectIds;

    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [],
      projects: [],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph,
      threads: [],
      wakeItems: [],
    });

    expect(model.diagnostics.missingProjectIds).toEqual([]);
    expect(model.diagnostics.staleMirror).toBe(true);
  });

  it("keeps authoritative control-plane programs when sqlite lineage diagnostics are stale", () => {
    const liveProgramId = ProgramId.makeUnsafe("program-live");
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
          id: liveProgramId,
          title: "Live Program",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        mirrorDiagnostics: {
          missingProjectIds: [],
          missingThreadIds: [ThreadId.makeUnsafe("orch-stale")],
          staleMirror: true,
        },
      }),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-live"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Live Orchestrator",
        }),
      ],
      wakeItems: [],
    });

    expect(model.source).toBe("sqlite");
    expect(model.executives[0]?.programs[0]?.title).toBe("Live Program");
    expect(model.executives[0]?.programs[0]?.currentLane?.id).toBe("orch-live");
    expect(model.diagnostics.missingThreadIds).toEqual(["orch-stale"]);
  });

  it("still uses sqlite executive thread authority when sqlite lineage diagnostics are stale", () => {
    const liveProgramId = ProgramId.makeUnsafe("program-live");
    const executiveProjectId = ProjectId.makeUnsafe("exec-project");
    const executiveThreadId = ThreadId.makeUnsafe("exec-thread");

    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
          executiveProjectId,
          executiveThreadId: null as never,
          id: liveProgramId,
          title: "Live Program",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: executiveProjectId,
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        mirrorDiagnostics: {
          missingProjectIds: [],
          missingThreadIds: [ThreadId.makeUnsafe("orch-stale")],
          staleMirror: true,
        },
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId,
            executiveThreadId,
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: liveProgramId,
            projectId: executiveProjectId,
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: executiveThreadId,
            title: "Executive sqlite",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/exec",
            worktreePath: "/exec",
          },
        ],
      }),
      threads: [
        makeThread({
          id: executiveThreadId,
          projectId: executiveProjectId,
          title: "Executive live",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("orch-live"),
          projectId: executiveProjectId,
          title: "Live Orchestrator",
        }),
      ],
      wakeItems: [],
    });

    expect(model.source).toBe("sqlite");
    expect(model.executives[0]?.threadId).toBe("exec-thread");
    expect(model.executives[0]?.thread?.id).toBe("exec-thread");
    expect(model.executives[0]?.runtimeState).toBe("inspectable");
    expect(model.executives[0]?.programs[0]?.currentLane?.id).toBe("orch-live");
  });

  it("prefers the executive project's current session root thread over stale program executive lineage", () => {
    const liveProgramId = ProgramId.makeUnsafe("program-live");
    const executiveProjectId = ProjectId.makeUnsafe("exec-project");
    const staleExecutiveThreadId = ThreadId.makeUnsafe("exec-thread-stale");
    const currentExecutiveThreadId = ThreadId.makeUnsafe("exec-thread-current");

    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
          executiveProjectId,
          executiveThreadId: staleExecutiveThreadId,
          id: liveProgramId,
          title: "Live Program",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          currentSessionRootThreadId: currentExecutiveThreadId,
          cwd: "/exec",
          id: executiveProjectId,
          name: "CTOv2",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        mirrorDiagnostics: {
          missingProjectIds: [],
          missingThreadIds: [ThreadId.makeUnsafe("orch-stale")],
          staleMirror: true,
        },
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId,
            executiveThreadId: staleExecutiveThreadId,
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: liveProgramId,
            projectId: executiveProjectId,
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: staleExecutiveThreadId,
            title: "Executive sqlite stale",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/exec-stale",
            worktreePath: "/exec-stale",
          },
        ],
      }),
      threads: [
        makeThread({
          id: currentExecutiveThreadId,
          projectId: executiveProjectId,
          title: "Executive current",
        }),
        makeThread({
          id: staleExecutiveThreadId,
          projectId: executiveProjectId,
          title: "Executive stale",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("orch-live"),
          projectId: executiveProjectId,
          title: "Live Orchestrator",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.threadId).toBe("exec-thread-current");
    expect(model.executives[0]?.thread?.id).toBe("exec-thread-current");
    expect(model.executives[0]?.fallbackThreadLink).toBeNull();
    expect(model.executives[0]?.programs[0]?.currentLane?.id).toBe("orch-live");
  });

  it("resolves sidebar root thread ids from authoritative control-plane programs", () => {
    expect(
      resolveSidebarRootThreadIds({
        programs: [
          makeProgram({
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-live"),
            id: ProgramId.makeUnsafe("program-live"),
            title: "Live Program",
            status: "active",
          }),
        ],
      }),
    ).toEqual([ThreadId.makeUnsafe("orch-live")]);
  });

  it("excludes sqlite-only worker rows from the live worker list", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("worker-project"),
          name: "api-vxapp",
          cwd: "/api",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-1"),
            title: "Orchestrator sqlite",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch",
            worktreePath: "/orch",
          },
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("worker-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-sqlite-only"),
            title: "Worker sqlite only",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/api",
            worktreePath: "/api",
          },
        ],
      }),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator live",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane?.workers).toEqual([]);
  });

  it("classifies dormant no-worktree workers as transient runtime rows", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map([
        [
          ThreadId.makeUnsafe("orch-1"),
          [
            {
              id: ThreadId.makeUnsafe("worker-transient"),
              latestTurn: null,
              orchestratorProjectId: ProjectId.makeUnsafe("exec-project"),
              projectId: ProjectId.makeUnsafe("worker-project"),
              session: { status: "idle" } as any,
              spawnRole: "worker",
              title: "worker/ket Transient worker",
              worktreePath: null,
            },
          ],
        ],
      ]),
      sqliteGraph: null,
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Live Orchestrator",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.runtimeState).toBe(
      "transient",
    );
  });

  it("keeps workers inspectable when live thread is missing worktreePath but sqlite lineage has it", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("worker-project"),
          name: "api-vxapp",
          cwd: "/api",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map([
        [
          ThreadId.makeUnsafe("orch-1"),
          [
            {
              id: ThreadId.makeUnsafe("worker-1"),
              latestTurn: null,
              orchestratorProjectId: ProjectId.makeUnsafe("exec-project"),
              projectId: ProjectId.makeUnsafe("worker-project"),
              session: null,
              spawnRole: "worker",
              title: "worker/ket Repair the OAuth callback flow",
              worktreePath: null,
            },
          ],
        ],
      ]),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator live",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-1"),
          projectId: ProjectId.makeUnsafe("worker-project"),
          title: "worker/ket Repair the OAuth callback flow",
          spawnRole: "worker",
          worktreePath: null,
        }),
      ],
      sqliteGraph: makeSqliteGraph({
        threadLinks: [
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: null,
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("exec-project"),
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-1"),
            title: "Orchestrator sqlite",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/orch",
            worktreePath: "/orch",
          },
          {
            archivedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            labels: [],
            latestTurn: null,
            metadata: null,
            orchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
            parentThreadId: null,
            programId: ProgramId.makeUnsafe("program-1"),
            projectId: ProjectId.makeUnsafe("worker-project"),
            session: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("worker-1"),
            title: "Worker sqlite",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot: "/api",
            worktreePath: "/api",
          },
        ],
      }),
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.runtimeState).toBe(
      "inspectable",
    );
    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.worktreePathHint).toBe(
      "/api",
    );
  });

  it("keeps workers inspectable when the live worker project carries the authoritative workspace", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("worker-project"),
          name: "api-vxapp",
          cwd: "/worktrees/api-vxapp-task-1",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map([
        [
          ThreadId.makeUnsafe("orch-1"),
          [
            {
              id: ThreadId.makeUnsafe("worker-1"),
              latestTurn: null,
              orchestratorProjectId: ProjectId.makeUnsafe("exec-project"),
              projectId: ProjectId.makeUnsafe("worker-project"),
              session: null,
              spawnRole: "worker",
              title: "worker/ket Repair the OAuth callback flow",
              worktreePath: null,
            },
          ],
        ],
      ]),
      sqliteGraph: null,
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator live",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-1"),
          projectId: ProjectId.makeUnsafe("worker-project"),
          title: "worker/ket Repair the OAuth callback flow",
          spawnRole: "worker",
          worktreePath: null,
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.runtimeState).toBe(
      "inspectable",
    );
    expect(model.executives[0]?.programs[0]?.currentLane?.workers[0]?.worktreePathHint).toBe(
      "/worktrees/api-vxapp-task-1",
    );
  });

  it("marks executive and orchestrator rows inspectable from live threads even without worker worktrees", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [
        makeProgram({
          currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
          id: ProgramId.makeUnsafe("program-1"),
          title: "Program A",
          status: "active",
        }),
      ],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("exec-project"),
          name: "CTOv2",
          cwd: "/exec",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: null,
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("exec-thread"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Executive live",
          worktreePath: null,
        }),
        makeThread({
          id: ThreadId.makeUnsafe("orch-1"),
          projectId: ProjectId.makeUnsafe("exec-project"),
          title: "Orchestrator live",
          spawnRole: "orchestrator",
          worktreePath: null,
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.runtimeState).toBe("inspectable");
    expect(model.executives[0]?.worktreePathHint).toBe(null);
    expect(model.executives[0]?.programs[0]?.currentLane?.runtimeState).toBe("inspectable");
    expect(model.executives[0]?.programs[0]?.currentLane?.worktreePathHint).toBe(null);
  });
});
