import { Effect } from "effect";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappControlPlaneSnapshot: vi.fn(),
  fetchAgentsVxappProgramsTodosSnapshot: vi.fn(),
  requestAgentsVxappProgramMutation: vi.fn(),
  requestAgentsVxappTodoMutation: vi.fn(),
}));

import {
  fetchAgentsVxappProgramsTodosSnapshot,
  requestAgentsVxappProgramMutation,
  requestAgentsVxappTodoMutation,
} from "../agentsVxappOwnerClient.ts";
import { AgentsVxappControlPlane } from "../Services/AgentsVxappControlPlane.ts";
import { AgentsVxappControlPlaneLive } from "./AgentsVxappControlPlane.ts";

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
  it("fetches Program and TODO snapshots through the owner client", async () => {
    mockedProgramsTodos.mockResolvedValueOnce(emptySnapshot);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.getSnapshot({});
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
});
