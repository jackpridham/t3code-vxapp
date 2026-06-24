import { describe, expect, it } from "vitest";
import { deriveOrchestrationSidebarEmptyState } from "./orchestrationSidebarStatus";

describe("deriveOrchestrationSidebarEmptyState", () => {
  it("explains contract-valid empty snapshots that carry owner diagnostics", () => {
    expect(
      deriveOrchestrationSidebarEmptyState({
        authorityStatus: "ready",
        authoritySnapshot: {
          currentTodos: [],
          hints: [],
          ownerDiagnostics: [
            {
              code: "current_todo_authority_missing",
              message: "Current TODO authority is unavailable for this Program.",
            },
          ],
          pagination: null,
          programs: [],
          todos: [],
        },
      }),
    ).toEqual({
      title: "Owner snapshot is incomplete",
      description:
        "The sidebar owner returned no visible programs. Current TODO authority is unavailable for this Program.",
    });
  });

  it("returns null when the owner published at least one program card", () => {
    expect(
      deriveOrchestrationSidebarEmptyState({
        authorityStatus: "ready",
        authoritySnapshot: {
          currentTodos: [],
          hints: [],
          ownerDiagnostics: [],
          pagination: null,
          programs: [
            {
              activeAllocations: [],
              attentionItems: [],
              currentTodo: null,
              display: null,
              executive: null,
              notifications: [],
              openWakes: [],
              orchestrator: null,
              ownerDiagnostics: [],
              program: {
                baseStatus: "active",
                closeout: null,
                completedAt: null,
                createdAt: "2026-05-10T00:00:00.000Z",
                currentOrchestratorThreadId: null,
                currentStatus: "active",
                deletedAt: null,
                executiveProjectId: "exec-project" as never,
                executiveThreadId: "exec-thread" as never,
                id: "program-1" as never,
                metadata: null,
                objective: null,
                status: "active",
                title: "Program 1",
                updatedAt: "2026-05-10T00:00:00.000Z",
              },
              watchProjection: null,
              workers: [],
            },
          ],
          todos: [],
        },
      }),
    ).toBeNull();
  });

  it("falls back to the zero-programs copy when no owner diagnostic is available", () => {
    expect(
      deriveOrchestrationSidebarEmptyState({
        authorityStatus: "ready",
        authoritySnapshot: {
          currentTodos: [],
          hints: [],
          ownerDiagnostics: [],
          pagination: null,
          programs: [],
          todos: [],
        },
      }),
    ).toEqual({
      title: "No active programs published",
      description: "The sidebar owner returned zero visible programs for this authority snapshot.",
    });
  });
});
