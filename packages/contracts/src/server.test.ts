import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ServerAgentsVxappTodoSnapshot,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
} from "./server";

const decodeTodo = Schema.decodeUnknownSync(ServerAgentsVxappTodoSnapshot as never) as (
  input: unknown,
) => Schema.Schema.Type<typeof ServerAgentsVxappTodoSnapshot>;

const decodeSidebarSnapshot = Schema.decodeUnknownSync(
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult as never,
) as (
  input: unknown,
) => Schema.Schema.Type<typeof ServerGetAgentsVxappSidebarAuthoritySnapshotResult>;

describe("ServerAgentsVxappTodoSnapshot", () => {
  it("defaults missing planLinks and notes to empty arrays", () => {
    expect(
      decodeTodo({
        todoId: "todo-1",
        agent: "jasper",
        programId: null,
        title: "Repair owner payload crash",
        summary: null,
        nextAction: null,
        status: "ready",
        priority: "normal",
        filePath: null,
        owner: null,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      }),
    ).toMatchObject({
      planLinks: [],
      notes: [],
    });
  });

  it("defaults null planLinks and notes to empty arrays", () => {
    expect(
      decodeTodo({
        todoId: "todo-1",
        agent: "jasper",
        programId: null,
        title: "Repair owner payload crash",
        summary: null,
        nextAction: null,
        status: "ready",
        priority: "normal",
        filePath: null,
        owner: null,
        planLinks: null,
        notes: null,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      }),
    ).toMatchObject({
      planLinks: [],
      notes: [],
    });
  });
});

describe("ServerGetAgentsVxappSidebarAuthoritySnapshotResult", () => {
  it("defaults nested currentTodo arrays through the TODO schema", () => {
    const snapshot = decodeSidebarSnapshot({
      programs: [
        {
          program: {
            id: "program-1",
            title: "Owner Program",
            objective: null,
            status: "active",
            baseStatus: null,
            currentStatus: null,
            executiveProjectId: null,
            executiveThreadId: null,
            currentOrchestratorThreadId: null,
            metadata: null,
            closeout: null,
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
            completedAt: null,
            deletedAt: null,
          },
          currentTodo: {
            todoId: "todo-1",
            agent: "jasper",
            programId: "program-1",
            title: "Repair owner payload crash",
            summary: null,
            nextAction: null,
            status: "ready",
            priority: "normal",
            filePath: null,
            owner: null,
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
          display: null,
          executive: null,
          orchestrator: null,
          workers: [],
          notifications: [],
          attentionItems: [],
          openWakes: [],
          watchProjection: null,
          activeAllocations: [],
          ownerDiagnostics: [],
        },
      ],
      todos: [],
      currentTodos: [],
      ownerDiagnostics: [],
      hints: [],
      pagination: null,
    });

    expect(snapshot.programs[0]?.currentTodo).toMatchObject({
      planLinks: [],
      notes: [],
    });
  });
});
