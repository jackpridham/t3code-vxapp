import { Effect } from "effect";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agentsVxappOwnerClient.ts")>();
  return {
    ...actual,
    fetchAgentsVxappControlPlaneSnapshot: vi.fn(),
    fetchAgentsVxappProgramsAuthoritySnapshot: vi.fn(),
    fetchAgentsVxappProgramsTodosSnapshot: vi.fn(),
    requestAgentsVxappProgramMutation: vi.fn(),
    requestAgentsVxappTodoMutation: vi.fn(),
  };
});

import {
  fetchAgentsVxappProgramsAuthoritySnapshot,
  fetchAgentsVxappProgramsTodosSnapshot,
  requestAgentsVxappProgramMutation,
  requestAgentsVxappTodoMutation,
} from "../agentsVxappOwnerClient.ts";
import { AgentsVxappControlPlane } from "../Services/AgentsVxappControlPlane.ts";
import { AgentsVxappOwnerClientError } from "../agentsVxappOwnerClient.ts";
import { AgentsVxappControlPlaneLive } from "./AgentsVxappControlPlane.ts";

const mockedProgramsAuthority = vi.mocked(fetchAgentsVxappProgramsAuthoritySnapshot);
const mockedProgramsTodos = vi.mocked(fetchAgentsVxappProgramsTodosSnapshot);
const mockedProgramMutation = vi.mocked(requestAgentsVxappProgramMutation);
const mockedTodoMutation = vi.mocked(requestAgentsVxappTodoMutation);

const emptySnapshot = {
  fetchedAt: "2026-05-16T00:00:00.000Z",
  dbPath: "owner-db",
  todoRootPath: "owner-todos",
  agents: [],
  programs: [],
  todos: [],
  currentTodos: [],
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("AgentsVxappControlPlaneLive", () => {
  it("fetches startup-safe Program authority snapshots through the owner client", async () => {
    mockedProgramsAuthority.mockResolvedValueOnce({
      programs: [{ id: "program-owner", title: "Owner Program", status: "active" }],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.getProgramsAuthoritySnapshot();
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
    );

    expect(result).toEqual({
      programs: [{ id: "program-owner", title: "Owner Program", status: "active" }],
    });
    expect(mockedProgramsAuthority).toHaveBeenCalledTimes(1);
  });

  it("fetches strict Program and TODO snapshots through the owner client", async () => {
    mockedProgramsTodos.mockResolvedValueOnce(emptySnapshot);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.getProgramsTodosSnapshot({});
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
    );

    expect(result).toEqual(emptySnapshot);
    expect(mockedProgramsTodos).toHaveBeenCalledTimes(1);
  });

  it("routes Program mutations through owner-client calls", async () => {
    mockedProgramMutation.mockResolvedValueOnce({ ok: true, action: "create" });

    await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.createProgram({
          title: "Owner program",
          executiveProjectId: ProjectId.makeUnsafe("project-owner"),
          executiveThreadId: ThreadId.makeUnsafe("thread-owner"),
        });
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
    );

    expect(mockedProgramMutation).toHaveBeenCalledWith({
      action: "create",
      input: {
        title: "Owner program",
        executiveProjectId: "project-owner",
        executiveThreadId: "thread-owner",
      },
    });
  });

  it("routes TODO mutations through owner-client calls", async () => {
    mockedTodoMutation.mockResolvedValueOnce({ ok: true, action: "update" });

    await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.updateTodo({
          agent: "jasper",
          todoId: "todo-1",
          title: "Owner TODO",
        });
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
    );

    expect(mockedTodoMutation).toHaveBeenCalledWith({
      action: "update",
      input: {
        agent: "jasper",
        todoId: "todo-1",
        title: "Owner TODO",
      },
    });
  });

  it("preserves owner diagnostics when the control-plane layer maps owner failures", async () => {
    mockedProgramsTodos.mockRejectedValueOnce(
      new AgentsVxappOwnerClientError({
        message: "owner refused snapshot",
        ownerCommand: "t3code-programs-todos-snapshot",
        authoritySurface: "programs_todos_snapshot",
        ownerErrorCode: "owner_snapshot_failed",
        authorityStore: "sqlite",
        authoritySource: "owner-command",
        contractFamily: "agents-vxapp-t3code-authority",
        contractVersion: "v1",
        exitCode: 12,
        stdout: '{"ok":false}',
        stderr: "stderr detail",
      }),
    );

    await expect(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.getProgramsTodosSnapshot({});
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive), Effect.runPromise),
    ).rejects.toMatchObject({
      detail: "owner refused snapshot",
      ownerCommand: "t3code-programs-todos-snapshot",
      authoritySurface: "programs_todos_snapshot",
      ownerErrorCode: "owner_snapshot_failed",
      authorityStore: "sqlite",
      authoritySource: "owner-command",
      contractFamily: "agents-vxapp-t3code-authority",
      contractVersion: "v1",
      exitCode: 12,
      stdout: '{"ok":false}',
      stderr: "stderr detail",
    });
  });
});
