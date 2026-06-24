import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappSidebarAuthoritySnapshot: vi.fn(),
}));

import { fetchAgentsVxappSidebarAuthoritySnapshot } from "../agentsVxappOwnerClient.ts";
import { AgentsVxappSidebar } from "../Services/AgentsVxappSidebar.ts";
import { AgentsVxappSidebarError } from "../Services/AgentsVxappSidebar.ts";
import { AgentsVxappSidebarLive } from "./AgentsVxappSidebar.ts";

const mockedSidebarAuthoritySnapshot = vi.mocked(fetchAgentsVxappSidebarAuthoritySnapshot);

const ownerAuthoritySnapshot = {
  programs: [
    {
      program: {
        id: ProgramId.makeUnsafe("program-owner"),
        title: "Owner Program",
        objective: null,
        status: "active",
        baseStatus: null,
        currentStatus: null,
        executiveProjectId: ProjectId.makeUnsafe("project-owner"),
        executiveThreadId: ThreadId.makeUnsafe("thread-owner"),
        currentOrchestratorThreadId: null,
        metadata: null,
        closeout: null,
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:01.000Z",
        completedAt: null,
        deletedAt: null,
      },
      display: {
        label: "Owner display",
        tone: "owner-invented-tone",
      },
      currentTodo: null,
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
};

afterEach(() => {
  mockedSidebarAuthoritySnapshot.mockReset();
});

describe("AgentsVxappSidebarLive", () => {
  it("returns the owner-backed sidebar authority snapshot without normalizing owner vocabularies", async () => {
    mockedSidebarAuthoritySnapshot.mockResolvedValueOnce(ownerAuthoritySnapshot);

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const sidebar = yield* AgentsVxappSidebar;
        return yield* sidebar.getAuthoritySnapshot({ page: 2, limit: 20 });
      }).pipe(Effect.provide(AgentsVxappSidebarLive)),
    );

    expect(mockedSidebarAuthoritySnapshot).toHaveBeenCalledWith({ page: 2, limit: 20 });
    expect(snapshot.programs[0]?.display?.tone).toBe("owner-invented-tone");
  });

  it("decodes missing nested TODO arrays in raw sidebar owner snapshots", async () => {
    mockedSidebarAuthoritySnapshot.mockResolvedValueOnce({
      programs: [
        {
          ...ownerAuthoritySnapshot.programs[0],
          currentTodo: {
            todoId: "todo-owner",
            agent: "jasper",
            programId: "program-owner",
            title: "Repair crash",
            summary: null,
            nextAction: null,
            status: "ready",
            priority: "normal",
            filePath: null,
            owner: null,
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
        },
      ],
      todos: [
        {
          todoId: "todo-owner",
          agent: "jasper",
          programId: "program-owner",
          title: "Repair crash",
          summary: null,
          nextAction: null,
          status: "ready",
          priority: "normal",
          filePath: null,
          owner: null,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      currentTodos: [],
      ownerDiagnostics: [],
      hints: [],
      pagination: null,
    } as unknown as typeof ownerAuthoritySnapshot);

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const sidebar = yield* AgentsVxappSidebar;
        return yield* sidebar.getAuthoritySnapshot({ page: 1, limit: 20 });
      }).pipe(Effect.provide(AgentsVxappSidebarLive)),
    );

    expect(snapshot.todos[0]).toMatchObject({ planLinks: [], notes: [] });
    expect(snapshot.programs[0]?.currentTodo).toMatchObject({ planLinks: [], notes: [] });
  });

  it("decodes null nested TODO arrays in raw sidebar owner snapshots", async () => {
    mockedSidebarAuthoritySnapshot.mockResolvedValueOnce({
      programs: [
        {
          ...ownerAuthoritySnapshot.programs[0],
          currentTodo: {
            todoId: "todo-owner",
            agent: "jasper",
            programId: "program-owner",
            title: "Repair crash",
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
          },
        },
      ],
      todos: [
        {
          todoId: "todo-owner",
          agent: "jasper",
          programId: "program-owner",
          title: "Repair crash",
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
        },
      ],
      currentTodos: [],
      ownerDiagnostics: [],
      hints: [],
      pagination: null,
    } as unknown as typeof ownerAuthoritySnapshot);

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const sidebar = yield* AgentsVxappSidebar;
        return yield* sidebar.getAuthoritySnapshot({ page: 1, limit: 20 });
      }).pipe(Effect.provide(AgentsVxappSidebarLive)),
    );

    expect(snapshot.todos[0]).toMatchObject({ planLinks: [], notes: [] });
    expect(snapshot.programs[0]?.currentTodo).toMatchObject({ planLinks: [], notes: [] });
  });

  it("fails sidebar owner snapshots at the boundary when contract decode fails", async () => {
    mockedSidebarAuthoritySnapshot.mockResolvedValueOnce({
      ...ownerAuthoritySnapshot,
      todos: "not-an-array",
    } as unknown as typeof ownerAuthoritySnapshot);

    await expect(
      Effect.gen(function* () {
        const sidebar = yield* AgentsVxappSidebar;
        return yield* sidebar.getAuthoritySnapshot({ page: 1, limit: 20 });
      }).pipe(Effect.provide(AgentsVxappSidebarLive), Effect.runPromise),
    ).rejects.toMatchObject({
      _tag: "AgentsVxappSidebarError",
      ownerCommand: "t3code-sidebar-authority-snapshot",
      authoritySurface: "sidebar_authority_snapshot",
    } satisfies Partial<AgentsVxappSidebarError>);
  });
});
