import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ProgramId,
  ProjectId,
  ThreadId,
  type NativeApi,
  type ServerAgentsVxappSidebarAuthorityProgramCard,
  type ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
} from "@t3tools/contracts";
import * as nativeApi from "~/nativeApi";
import {
  fetchAgentsVxappSidebarAuthoritySnapshotFromOwner,
  normalizeAgentsVxappSidebarAuthoritySnapshot,
} from "./agentsVxappStoreBridge";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeProgramCard(
  overrides: Partial<ServerAgentsVxappSidebarAuthorityProgramCard> = {},
): ServerAgentsVxappSidebarAuthorityProgramCard {
  return {
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
      executiveProjectId: ProjectId.makeUnsafe("exec-project"),
      executiveThreadId: ThreadId.makeUnsafe("exec-thread"),
      id: ProgramId.makeUnsafe("program-owner"),
      metadata: null,
      objective: null,
      status: "active",
      title: "Owner Program",
      updatedAt: "2026-05-10T00:00:00.000Z",
    },
    watchProjection: null,
    workers: [],
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ServerGetAgentsVxappSidebarAuthoritySnapshotResult> = {},
): ServerGetAgentsVxappSidebarAuthoritySnapshotResult {
  return {
    currentTodos: [],
    hints: [],
    ownerDiagnostics: [],
    pagination: { page: 1, limit: 20, total: 1, hasMore: false },
    programs: [makeProgramCard()],
    todos: [],
    ...overrides,
  };
}

describe("agentsVxappStoreBridge", () => {
  it("requests bounded Program authority pages from the owner API", async () => {
    const getAgentsVxappSidebarAuthoritySnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      server: { getAgentsVxappSidebarAuthoritySnapshot },
    } as unknown as NativeApi);

    await fetchAgentsVxappSidebarAuthoritySnapshotFromOwner({ page: 2, limit: 20 });

    expect(getAgentsVxappSidebarAuthoritySnapshot).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
    });
  });

  it("preserves owner pagination and hints on successful snapshots", () => {
    const snapshot = makeSnapshot({
      hints: [{ command: "vx t3 programs list --limit 20 --json", reason: "Inspect Programs." }],
      pagination: { page: 2, limit: 20, total: 41, hasMore: true },
    });

    const normalized = normalizeAgentsVxappSidebarAuthoritySnapshot(snapshot);

    expect(normalized.snapshot.pagination).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      hasMore: true,
    });
    expect(normalized.snapshot.hints).toEqual([
      { command: "vx t3 programs list --limit 20 --json", reason: "Inspect Programs." },
    ]);
    expect(normalized.programCards.map((card) => card.program.id)).toEqual(["program-owner"]);
  });

  it("surfaces owner errors with hints instead of returning empty rows", async () => {
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      server: {
        getAgentsVxappSidebarAuthoritySnapshot: vi.fn().mockResolvedValue(
          makeSnapshot({
            error: {
              code: "missing_required_flags",
              message: "Missing required Program authority flags.",
              hints: [
                {
                  command: "vx t3 programs list --limit 20 --json",
                  reason: "Inspect the owner Program page.",
                },
              ],
            },
            programs: [],
          }),
        ),
      },
    } as unknown as NativeApi);

    await expect(fetchAgentsVxappSidebarAuthoritySnapshotFromOwner()).rejects.toMatchObject({
      ownerErrorCode: "missing_required_flags",
      hints: [
        {
          command: "vx t3 programs list --limit 20 --json",
          reason: "Inspect the owner Program page.",
        },
      ],
    });
  });
});
