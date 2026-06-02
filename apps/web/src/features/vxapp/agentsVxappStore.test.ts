import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  ServerAgentsVxappSidebarAuthorityProgramCard,
} from "@t3tools/contracts";

const mocks = vi.hoisted(() => ({
  fetchAgentsVxappSidebarAuthoritySnapshotFromOwner: vi.fn(),
}));

vi.mock("./agentsVxappStoreBridge", () => ({
  fetchAgentsVxappSidebarAuthoritySnapshotFromOwner:
    mocks.fetchAgentsVxappSidebarAuthoritySnapshotFromOwner,
  normalizeAgentsVxappSidebarAuthoritySnapshot: (
    snapshot: ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  ) => ({
    attentionItems: [],
    snapshot,
    currentTodoIdByProgramId: new Map(),
    diagnosticsByProgramId: new Map(),
    notifications: [],
    openWakes: [],
    programCardById: new Map(snapshot.programs.map((card) => [card.program.id, card] as const)),
    programCards: snapshot.programs,
    runtimeTargetByThreadId: new Map(),
    todosByProgramId: new Map(),
  }),
}));

import {
  invalidateAgentsVxappStore,
  refreshAgentsVxappStore,
  useAgentsVxappStore,
} from "./agentsVxappStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeSnapshot(programId: string): ServerGetAgentsVxappSidebarAuthoritySnapshotResult {
  const programCard = {
    program: {
      id: programId,
      title: programId,
      status: "active",
    },
    todos: [],
    notifications: [],
    attentionItems: [],
    openWakes: [],
    ownerDiagnostics: [],
    workers: [],
  } as unknown as ServerAgentsVxappSidebarAuthorityProgramCard;
  return {
    programs: [programCard],
    todos: [],
    currentTodos: [],
    ownerDiagnostics: [],
    notifications: [],
    attentionItems: [],
    openWakes: [],
    error: null,
  } as unknown as ServerGetAgentsVxappSidebarAuthoritySnapshotResult;
}

describe("agents vxapp sidebar authority store", () => {
  beforeEach(() => {
    mocks.fetchAgentsVxappSidebarAuthoritySnapshotFromOwner.mockReset();
    useAgentsVxappStore.setState({
      snapshot: null,
      status: "idle",
      error: null,
      fetchedAt: null,
      inFlightRefresh: null,
      authorityGeneration: 0,
      attentionItems: [],
      notifications: [],
      openWakes: [],
      openWakeSummaryByThreadId: new Map(),
      programCards: [],
      programCardById: new Map(),
      runtimeTargetByThreadId: new Map(),
      currentTodoIdByProgramId: new Map(),
      diagnosticsByProgramId: new Map(),
      todosByProgramId: new Map(),
    });
  });

  it("ignores a sidebar authority read that resolves after mutation invalidation", async () => {
    const staleRead = deferred<ServerGetAgentsVxappSidebarAuthoritySnapshotResult>();
    const freshRead = deferred<ServerGetAgentsVxappSidebarAuthoritySnapshotResult>();
    mocks.fetchAgentsVxappSidebarAuthoritySnapshotFromOwner
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(freshRead.promise);

    const staleRefresh = refreshAgentsVxappStore();
    invalidateAgentsVxappStore();
    const freshRefresh = refreshAgentsVxappStore({ force: true });

    freshRead.resolve(makeSnapshot("program-fresh"));
    await freshRefresh;
    staleRead.resolve(makeSnapshot("program-stale"));
    await staleRefresh;

    expect(mocks.fetchAgentsVxappSidebarAuthoritySnapshotFromOwner).toHaveBeenCalledTimes(2);
    expect(useAgentsVxappStore.getState().snapshot?.programs[0]?.program.id).toBe("program-fresh");
  });
});
