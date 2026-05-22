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
  fetchAgentsVxappControlPlaneSnapshot,
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
const mockedControlPlaneSnapshot = vi.mocked(fetchAgentsVxappControlPlaneSnapshot);

const emptySnapshot = {
  fetchedAt: "2026-05-16T00:00:00.000Z",
  dbPath: "owner-db",
  todoRootPath: "owner-todos",
  agents: [],
  programs: [],
  todos: [],
  currentTodos: [],
  hints: [],
  pagination: null,
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("AgentsVxappControlPlaneLive", () => {
  it("projects the owner control-plane snapshot into binding, notification, attention, and watch exports", async () => {
    mockedControlPlaneSnapshot.mockResolvedValue({
      selection: {
        activeProgram: {
          id: "program-owner",
          currentOrchestratorThreadId: "thread-owner",
        },
        jasper: {
          thread: {
            id: "thread-owner",
            programId: "program-owner",
            projectId: "project-owner",
          },
        },
      },
      notifications: [
        {
          notificationId: "notification-owner",
          programId: "program-owner",
          executiveProjectId: "project-owner",
          executiveThreadId: "thread-owner",
          kind: "status_update",
          severity: "info",
          summary: "Owner notification",
          state: "pending",
          queuedAt: "2026-05-16T00:00:00.000Z",
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
        {
          notificationId: "notification-incomplete",
          programId: "program-owner",
        },
      ],
      attention: [
        {
          attentionId: "attention-active",
          programId: "program-owner",
          executiveProjectId: "project-owner",
          executiveThreadId: "thread-owner",
          kind: "control_plane_repair_required",
          severity: "warning",
          summary: "Owner attention",
          state: "pending",
          queuedAt: "2026-05-16T00:00:00.000Z",
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
        {
          attentionId: "attention-resolved",
          notificationId: "notification-resolved",
          programId: "program-owner",
          executiveProjectId: "project-owner",
          executiveThreadId: "thread-owner",
          kind: "closeout_review_required",
          severity: "info",
          summary: "Owner resolved attention",
          state: "resolved",
          queuedAt: "2026-05-16T00:00:00.000Z",
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
        {
          attentionId: "attention-incomplete",
          programId: "program-owner",
          state: "pending",
        },
      ],
      watches: [
        {
          enabled: true,
          programId: "program-owner",
          classification: "cto_attention_required",
          reason: "review",
        },
      ],
      wakes: [{ wakeId: "wake-owner" }],
      diagnostics: [],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        const binding = yield* controlPlane.getBindingAuthorityExport();
        const notifications = yield* controlPlane.getNotificationSummaryExport();
        const attention = yield* controlPlane.getAttentionSummaryExport();
        const watch = yield* controlPlane.getWatchSummaryExport();
        return { attention, binding, notifications, watch };
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
    );

    expect(result.binding.jasper.currentThread).toMatchObject({
      id: "thread-owner",
      programId: "program-owner",
      projectId: "project-owner",
    });
    expect(result.notifications.notifications).toHaveLength(1);
    expect(result.notifications.attention).toHaveLength(2);
    expect(result.notifications.attention[0]).toMatchObject({
      attentionId: "attention-active",
      notificationId: "attention-active",
    });
    expect(result.attention.attention).toHaveLength(2);
    expect(result.attention.resolvedAttention).toEqual([
      expect.objectContaining({ attentionId: "attention-resolved" }),
    ]);
    expect(result.watch).toMatchObject({
      enabledPrograms: ["program-owner"],
      classification: "cto_attention_required",
      recommendedAction: "review",
      wakeDecision: { wakeId: "wake-owner" },
    });
    expect(mockedControlPlaneSnapshot).toHaveBeenCalledTimes(4);
  });

  it("fetches startup-safe Program authority snapshots through the owner client", async () => {
    mockedProgramsAuthority.mockResolvedValueOnce({
      programs: [
        {
          program_id: "program-owner",
          title: "Owner Program",
          status: "active",
          executive_project_id: "project-owner",
          executive_thread_id: "thread-owner",
          current_orchestrator_thread_id: "orchestrator-owner",
          created_at: "2026-05-16T00:00:00.000Z",
          updated_at: "2026-05-16T00:00:00.000Z",
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        return yield* controlPlane.getProgramsAuthoritySnapshot();
      }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
    );

    expect(result).toEqual({
      programs: [
        expect.objectContaining({
          id: "program-owner",
          title: "Owner Program",
          status: "active",
          executiveProjectId: "project-owner",
          executiveThreadId: "thread-owner",
          currentOrchestratorThreadId: "orchestrator-owner",
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
          completedAt: null,
          deletedAt: null,
        }),
      ],
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
