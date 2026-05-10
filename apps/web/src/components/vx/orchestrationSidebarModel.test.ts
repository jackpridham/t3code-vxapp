import { describe, expect, it } from "vitest";
import {
  ProgramId,
  ProjectId,
  ThreadId,
  type ServerGetAgentsVxappSidebarGraphResult,
} from "@t3tools/contracts";
import {
  buildOrchestrationSidebarModel,
  resolveSidebarRootThreadIds,
} from "./orchestrationSidebarModel";
import type { Program, Project, Thread } from "~/types";

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

function makeProgram(input: Partial<Program> & Pick<Program, "id" | "title" | "status">): Program {
  return {
    affectedAppTargets: [],
    completedAt: null,
    currentOrchestratorThreadId: null,
    declaredRepos: [],
    deletedAt: null,
    executiveProjectId: ProjectId.makeUnsafe("exec-project"),
    executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
    objective: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...input,
  } as Program;
}

function makeSqliteGraph(
  overrides: Partial<ServerGetAgentsVxappSidebarGraphResult> = {},
): ServerGetAgentsVxappSidebarGraphResult {
  return {
    attentionItems: [],
    dbPath: "/home/gizmo/agents-vxapp/.agents/state/vx_agents.sqlite3",
    fallbackReason: null,
    mirrorDiagnostics: {
      divergentProgramIds: [],
      missingProgramIds: [],
      missingProjectIds: [],
      missingThreadIds: [],
      staleMirror: false,
    },
    notifications: [],
    openWakes: [],
    programs: [],
    source: "sqlite",
    threadLinks: [],
    watchProjections: [],
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
      programs: [],
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
        programs: [
          {
            closeout: null,
            completedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            id: ProgramId.makeUnsafe("program-1"),
            metadata: null,
            objective: null,
            status: "active",
            title: "Program A",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
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
    expect(model.executives[0]?.programs[0]?.orchestrator?.workers[0]?.thread?.title).toBe(
      "worker/ket Repair the OAuth callback flow",
    );
    expect(model.executives[0]?.programs[0]?.orchestrator?.workers[0]?.title).toBe(
      "Repair the OAuth callback flow",
    );
    expect(model.executives[0]?.programs[0]?.orchestrator?.workers[0]?.provenanceLabel).toBe(
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

    expect(model.executives[0]?.programs[0]?.orchestrator).toBeNull();
  });

  it("derives the orchestrator name from generated role-session workspaces instead of 'workspace'", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [],
      projects: [
        makeProject({
          id: ProjectId.makeUnsafe("workspace-project"),
          name: "workspace",
          cwd: "/home/gizmo/agents-vxapp/.agents/runtime/role-sessions/jasper/jasper-123/workspace",
        }),
      ],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        programs: [
          {
            closeout: null,
            completedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-role-session"),
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            id: ProgramId.makeUnsafe("program-1"),
            metadata: null,
            objective: null,
            status: "active",
            title: "PartyMore.ai launch plan and first delivery wave",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
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
            session: null,
            spawnRole: "orchestrator",
            spawnedBy: "cto",
            threadId: ThreadId.makeUnsafe("orch-role-session"),
            title: "PartyMore.ai launch plan and first delivery wave",
            updatedAt: "2026-05-10T00:00:00.000Z",
            workflowId: null,
            workspaceRoot:
              "/home/gizmo/agents-vxapp/.agents/runtime/role-sessions/jasper/jasper-123/workspace",
            worktreePath:
              "/home/gizmo/agents-vxapp/.agents/runtime/role-sessions/jasper/jasper-123/workspace",
          },
        ],
      }),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("orch-role-session"),
          projectId: ProjectId.makeUnsafe("workspace-project"),
          title: "PartyMore.ai launch plan and first delivery wave",
          worktreePath:
            "/home/gizmo/agents-vxapp/.agents/runtime/role-sessions/jasper/jasper-123/workspace",
        }),
      ],
      wakeItems: [],
    });

    expect(model.executives[0]?.programs[0]?.orchestrator?.title).toBe("Jasper");
  });

  it("flags a stale mirrored dev DB when sqlite graph rows do not exist in live T3 state", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [],
      projects: [],
      sessionWorkerThreadsByRootId: new Map(),
      sqliteGraph: makeSqliteGraph({
        mirrorDiagnostics: {
          divergentProgramIds: [],
          missingProgramIds: [ProgramId.makeUnsafe("program-missing")],
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
        programs: [
          {
            closeout: null,
            completedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-missing"),
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-missing"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread-missing"),
            id: ProgramId.makeUnsafe("program-missing"),
            metadata: null,
            objective: null,
            status: "active",
            title: "Missing Program",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
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
    expect(model.diagnostics.divergentProgramIds).toEqual([]);
    expect(model.diagnostics.missingProgramIds).toEqual(["program-missing"]);
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
        missingProgramIds: [ProgramId.makeUnsafe("program-missing")],
        missingProjectIds: [],
        missingThreadIds: [],
        staleMirror: true,
      } as unknown as ServerGetAgentsVxappSidebarGraphResult["mirrorDiagnostics"],
    });
    delete (sqliteGraph.mirrorDiagnostics as Record<string, unknown>).divergentProgramIds;

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

    expect(model.diagnostics.divergentProgramIds).toEqual([]);
    expect(model.diagnostics.missingProgramIds).toEqual(["program-missing"]);
    expect(model.diagnostics.staleMirror).toBe(true);
  });

  it("fails closed to live T3 programs when sqlite mirror has divergent program lineage", () => {
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
          divergentProgramIds: [liveProgramId],
          missingProgramIds: [],
          missingProjectIds: [],
          missingThreadIds: [],
          staleMirror: true,
        },
        programs: [
          {
            closeout: null,
            completedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-stale"),
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            id: liveProgramId,
            metadata: null,
            objective: null,
            status: "active",
            title: "Stale Sqlite Program",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
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

    expect(model.source).toBe("t3");
    expect(model.executives[0]?.programs[0]?.title).toBe("Live Program");
    expect(model.executives[0]?.programs[0]?.orchestrator?.id).toBe("orch-live");
    expect(model.diagnostics.divergentProgramIds).toEqual(["program-live"]);
  });

  it("resolves sidebar root thread ids from live programs when sqlite mirror is stale", () => {
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
        sqliteGraph: makeSqliteGraph({
          mirrorDiagnostics: {
            divergentProgramIds: [ProgramId.makeUnsafe("program-live")],
            missingProgramIds: [],
            missingProjectIds: [],
            missingThreadIds: [],
            staleMirror: true,
          },
          programs: [
            {
              closeout: null,
              completedAt: null,
              createdAt: "2026-05-10T00:00:00.000Z",
              currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-stale"),
              deletedAt: null,
              executiveProjectId: ProjectId.makeUnsafe("exec-project"),
              executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
              id: ProgramId.makeUnsafe("program-live"),
              metadata: null,
              objective: null,
              status: "active",
              title: "Stale Sqlite Program",
              updatedAt: "2026-05-10T00:00:00.000Z",
            },
          ],
        }),
      }),
    ).toEqual([ThreadId.makeUnsafe("orch-live")]);
  });

  it("excludes sqlite-only worker rows from the live worker list", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [],
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
        programs: [
          {
            closeout: null,
            completedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            id: ProgramId.makeUnsafe("program-1"),
            metadata: null,
            objective: null,
            status: "active",
            title: "Program A",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
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

    expect(model.executives[0]?.programs[0]?.orchestrator?.workers).toEqual([]);
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

    expect(model.executives[0]?.programs[0]?.orchestrator?.workers[0]?.runtimeState).toBe(
      "transient",
    );
  });

  it("keeps workers inspectable when live thread is missing worktreePath but sqlite lineage has it", () => {
    const model = buildOrchestrationSidebarModel({
      ctoAttentionItems: [],
      programNotifications: [],
      programs: [],
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
        programs: [
          {
            closeout: null,
            completedAt: null,
            createdAt: "2026-05-10T00:00:00.000Z",
            currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-1"),
            deletedAt: null,
            executiveProjectId: ProjectId.makeUnsafe("exec-project"),
            executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
            id: ProgramId.makeUnsafe("program-1"),
            metadata: null,
            objective: null,
            status: "active",
            title: "Program A",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        ],
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

    expect(model.executives[0]?.programs[0]?.orchestrator?.workers[0]?.runtimeState).toBe(
      "inspectable",
    );
    expect(model.executives[0]?.programs[0]?.orchestrator?.workers[0]?.worktreePathHint).toBe(
      "/api",
    );
  });
});
