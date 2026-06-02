import { describe, expect, it } from "vitest";
import {
  ProgramId,
  ThreadId,
  type ServerGetAgentsVxappControlPlaneSnapshotResult,
  type ServerAgentsVxappProgramSnapshot,
  type ServerAgentsVxappTodoSnapshot,
} from "@t3tools/contracts";
import {
  buildProgramTodoGroups,
  chooseCreateProgramScopeTemplate,
  readProgramScope,
  resolveProgramLanePolicy,
  resolveProgramLifecycleOptions,
  resolveOrchestratorOptions,
  resolveProgramOrchestratorLabel,
  resolveTodoPriorityOptions,
  resolveTodoStatusOptions,
  validateProgramScope,
} from "./programsTodosModel";

function makeProgram(
  overrides: Partial<ServerAgentsVxappProgramSnapshot> &
    Pick<ServerAgentsVxappProgramSnapshot, "id" | "title">,
): ServerAgentsVxappProgramSnapshot {
  const { id, title, ...rest } = overrides;
  return {
    closeout: null,
    completedAt: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    currentOrchestratorThreadId: null,
    currentStatus: "active",
    baseStatus: "active",
    deletedAt: null,
    executiveProjectId: null,
    executiveThreadId: null,
    id,
    metadata: null,
    objective: null,
    status: "active",
    title,
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...rest,
  };
}

function makeTodo(
  overrides: Partial<ServerAgentsVxappTodoSnapshot> &
    Pick<ServerAgentsVxappTodoSnapshot, "agent" | "title" | "todoId">,
): ServerAgentsVxappTodoSnapshot {
  const { agent, title, todoId, ...rest } = overrides;
  return {
    agent,
    createdAt: "2026-05-10T00:00:00.000Z",
    filePath: null,
    nextAction: null,
    notes: [],
    owner: null,
    planLinks: [],
    priority: "normal",
    programId: null,
    status: "ready",
    summary: null,
    title,
    todoId,
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...rest,
  };
}

function makeControlPlaneSnapshotWithOptions(options: Record<string, unknown>) {
  return {
    fetchedAt: "2026-05-10T00:00:00.000Z",
    dbPath: "/tmp/vx_agents.sqlite3",
    todoRootPath: "/tmp/todos",
    agents: [],
    programs: [],
    todos: [],
    currentTodos: [],
    hints: [],
    pagination: null,
    options,
  } as ServerGetAgentsVxappControlPlaneSnapshotResult & { options: Record<string, unknown> };
}

describe("programsTodosModel", () => {
  it("chooses the first valid scope template for new Programs", () => {
    const invalidProgram = makeProgram({
      id: ProgramId.makeUnsafe("program-invalid"),
      title: "Invalid",
      closeout: {
        scope: {
          declaredRepos: [],
          repoLaneContracts: [],
        },
      },
    });
    const validProgram = makeProgram({
      id: ProgramId.makeUnsafe("program-valid"),
      title: "Valid",
      closeout: {
        scope: {
          declaredRepos: ["api-vxapp"],
          repoLaneContracts: [
            {
              repo: "api-vxapp",
              baseBranch: "development",
              allowedHeadBranchPatterns: ["task/example-*"],
              allowedWorktreePatterns: ["/home/gizmo/worktrees/*"],
              requireManagedWorktree: true,
              worktreeMode: "write",
            },
          ],
          appTargets: [],
          requiredLocalSuites: [],
          requiredExternalE2ESuites: [],
        },
      },
    });

    const template = chooseCreateProgramScopeTemplate([invalidProgram, validProgram]);

    expect(template.sourceProgramId).toBe(validProgram.id);
    expect(template.sourceProgramTitle).toBe("Valid");
    expect(template.usedFallback).toBe(false);
    expect(validateProgramScope(readProgramScope(validProgram)!)).toEqual([]);
  });

  it("groups Program, unassigned, and detached TODOs separately", () => {
    const program = makeProgram({
      id: ProgramId.makeUnsafe("program-1"),
      title: "Program One",
    });

    const groups = buildProgramTodoGroups({
      currentTodoByProgramId: new Map([[program.id, "todo-current"]]),
      programs: [program],
      todos: [
        makeTodo({
          agent: "jasper",
          programId: program.id,
          title: "Assigned",
          todoId: "todo-current",
        }),
        makeTodo({
          agent: "jasper",
          programId: null,
          title: "Unassigned",
          todoId: "todo-unassigned",
        }),
        makeTodo({
          agent: "jasper",
          programId: ProgramId.makeUnsafe("missing-program"),
          title: "Detached",
          todoId: "todo-detached",
        }),
      ],
    });

    expect(groups.map((group) => [group.kind, group.todos.length])).toEqual([
      ["program", 1],
      ["unassigned", 1],
      ["detached", 1],
    ]);
    expect(groups[0]?.currentTodoId).toBe("todo-current");
    expect(groups[2]?.kind).toBe("detached");
    expect(
      groups[2] && "referencedProgramId" in groups[2] ? groups[2].referencedProgramId : null,
    ).toBe("missing-program");
  });

  it("validates required scope fields", () => {
    expect(
      validateProgramScope({
        declaredRepos: [],
        repoLaneContracts: [],
      }),
    ).toContain("At least one declared repo is required.");

    expect(
      validateProgramScope({
        declaredRepos: ["api-vxapp"],
        repoLaneContracts: [
          {
            repo: "api-vxapp",
            baseBranch: "development",
            allowedHeadBranchPatterns: ["task/example-*"],
            allowedWorktreePatterns: ["/home/gizmo/worktrees/*"],
            requireManagedWorktree: true,
            worktreeMode: "write",
          },
        ],
        appTargets: [],
        requiredLocalSuites: [],
        requiredExternalE2ESuites: [],
      }),
    ).toEqual([]);
  });

  it("keeps local placeholder Program scope non-submittable", () => {
    const template = chooseCreateProgramScopeTemplate([]);

    expect(template.usedFallback).toBe(true);
    expect(template.scope).toMatchObject({
      authoritySource: "local_placeholder",
      ownerPayloadRequired: true,
      placeholders: { submittable: false },
    });
    expect(validateProgramScope(template.scope)).toContain(
      "Local placeholder Program scope cannot be submitted.",
    );
  });

  it("resolves owner-provided Program lane policy", () => {
    const snapshot = {
      programLanePolicy: {
        allowedBranchPatterns: ["task/*", "program/*"],
        defaultBaseBranch: "main",
        defaultEnvironment: "development",
        ownerPayloadRequired: true,
        placeholders: { submittable: false },
        worktreePattern: "task/{programId}-{laneId}",
      },
    } as unknown as ServerGetAgentsVxappControlPlaneSnapshotResult;

    expect(resolveProgramLanePolicy(snapshot)).toEqual({
      allowedBranchPatterns: ["task/*", "program/*"],
      defaultBaseBranch: "main",
      defaultEnvironment: "development",
      ownerPayloadRequired: true,
      placeholders: { submittable: false },
      worktreePattern: "task/{programId}-{laneId}",
    });
  });

  it("prefers role-session labels for orchestrator options", () => {
    const program = makeProgram({
      currentOrchestratorThreadId: ThreadId.makeUnsafe("orch-jasper"),
      id: ProgramId.makeUnsafe("program-jasper"),
      title: "Program Jasper",
    });

    const options = resolveOrchestratorOptions({
      programs: [program],
      threads: [],
      threadLinks: [
        {
          threadId: ThreadId.makeUnsafe("orch-jasper"),
          title: "workspace",
          roleSession: {
            role: "jasper",
            sessionId: "jasper-123",
          },
          workspaceRoot: null,
          worktreePath: null,
          spawnRole: "orchestrator",
        },
      ],
    });

    expect(resolveProgramOrchestratorLabel(program, options)).toBe("Jasper");
  });

  it("reads Program lifecycle options directly from owner option arrays", () => {
    const snapshot = makeControlPlaneSnapshotWithOptions({
      programLifecycleOptions: [
        {
          value: "awaiting_external",
          display: {
            label: "Awaiting External Approval",
            sortKey: "20",
            tone: "warning",
          },
          action: "set-awaiting-external",
        },
        {
          value: "completed",
          display: {
            label: "Ship Complete",
            sortKey: "90",
            tone: "success",
          },
          action: "mark-complete",
        },
      ],
    });

    expect(resolveProgramLifecycleOptions(snapshot)).toEqual([
      {
        action: "set-awaiting-external",
        label: "Awaiting External Approval",
        sortKey: "20",
        tone: "warning",
        value: "awaiting_external",
      },
      {
        action: "mark-complete",
        label: "Ship Complete",
        sortKey: "90",
        tone: "success",
        value: "completed",
      },
    ]);
  });

  it("reads TODO status options directly from owner option arrays", () => {
    const snapshot = makeControlPlaneSnapshotWithOptions({
      todoStatusOptions: [
        {
          value: "needs_triage",
          display: {
            label: "Needs Triage",
            sortKey: "10",
            tone: "warning",
          },
        },
        {
          value: "blocked_on_owner",
          display: {
            label: "Blocked on Owner",
            sortKey: "40",
            tone: "critical",
          },
        },
      ],
    });

    expect(resolveTodoStatusOptions(snapshot)).toEqual([
      {
        action: null,
        label: "Needs Triage",
        sortKey: "10",
        tone: "warning",
        value: "needs_triage",
      },
      {
        action: null,
        label: "Blocked on Owner",
        sortKey: "40",
        tone: "critical",
        value: "blocked_on_owner",
      },
    ]);
  });

  it("reads TODO priority options directly from owner option arrays", () => {
    const snapshot = makeControlPlaneSnapshotWithOptions({
      todoPriorityOptions: [
        {
          value: "rush",
          display: {
            label: "Rush Queue",
            sortKey: "05",
            tone: "critical",
          },
        },
        {
          value: "background",
          display: {
            label: "Background",
            sortKey: "80",
            tone: "muted",
          },
        },
      ],
    });

    expect(resolveTodoPriorityOptions(snapshot)).toEqual([
      {
        action: null,
        label: "Rush Queue",
        sortKey: "05",
        tone: "critical",
        value: "rush",
      },
      {
        action: null,
        label: "Background",
        sortKey: "80",
        tone: "muted",
        value: "background",
      },
    ]);
  });
});
