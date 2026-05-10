import { describe, expect, it } from "vitest";
import {
  ProgramId,
  ThreadId,
  type ServerAgentsVxappProgramSnapshot,
  type ServerAgentsVxappTodoSnapshot,
} from "@t3tools/contracts";
import {
  buildProgramTodoGroups,
  chooseCreateProgramScopeTemplate,
  readProgramScope,
  resolveOrchestratorOptions,
  resolveProgramOrchestratorLabel,
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
          workspaceRoot:
            "/home/gizmo/agents-vxapp/.agents/runtime/role-sessions/jasper/jasper-123/workspace",
          worktreePath:
            "/home/gizmo/agents-vxapp/.agents/runtime/role-sessions/jasper/jasper-123/workspace",
          spawnRole: "orchestrator",
        },
      ],
    });

    expect(resolveProgramOrchestratorLabel(program, options)).toBe("Jasper");
  });
});
