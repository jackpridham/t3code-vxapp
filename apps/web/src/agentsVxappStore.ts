import { useEffect } from "react";
import type {
  AgentsVxappSidebarAuthorityDiagnostic,
  AgentsVxappOwnerBoundaryError,
  AgentsVxappOwnerLoadStatus,
  ServerAgentsVxappSidebarAttentionItem,
  ServerAgentsVxappSidebarProgramNotification,
  ServerAgentsVxappSidebarAuthorityProgramCard,
  ServerAgentsVxappSidebarWake,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
} from "@t3tools/contracts";
import { create } from "zustand";
import {
  fetchAgentsVxappSidebarAuthoritySnapshotFromOwner,
  normalizeAgentsVxappSidebarAuthoritySnapshot,
  type AgentsVxappSidebarAuthorityNormalizedSnapshot,
} from "./lib/agentsVxappStoreBridge";

const AGENTS_VXAPP_SIDEBAR_AUTHORITY_STALE_TIME_MS = 10_000;
type SidebarTodoList = ServerGetAgentsVxappSidebarAuthoritySnapshotResult["todos"][number][];
type SidebarWakeSummary = {
  openWakeCount: number;
};

type AgentsVxappStoreState = {
  attentionItems: readonly ServerAgentsVxappSidebarAttentionItem[];
  currentTodoIdByProgramId: ReadonlyMap<string, string>;
  diagnosticsByProgramId: ReadonlyMap<string, readonly AgentsVxappSidebarAuthorityDiagnostic[]>;
  error: AgentsVxappOwnerBoundaryError | null;
  fetchedAt: number | null;
  inFlightRefresh: Promise<void> | null;
  notifications: readonly ServerAgentsVxappSidebarProgramNotification[];
  openWakes: readonly ServerAgentsVxappSidebarWake[];
  openWakeSummaryByThreadId: ReadonlyMap<string, SidebarWakeSummary>;
  programCardById: ReadonlyMap<string, ServerAgentsVxappSidebarAuthorityProgramCard>;
  programCards: readonly ServerAgentsVxappSidebarAuthorityProgramCard[];
  runtimeTargetByThreadId: ReadonlyMap<
    string,
    ServerAgentsVxappSidebarAuthorityProgramCard["executive"]
  >;
  refreshSidebarAuthority: (input?: { force?: boolean }) => Promise<void>;
  setNormalizedSnapshot: (snapshot: AgentsVxappSidebarAuthorityNormalizedSnapshot) => void;
  snapshot: ServerGetAgentsVxappSidebarAuthoritySnapshotResult | null;
  status: AgentsVxappOwnerLoadStatus;
  todosByProgramId: ReadonlyMap<string, SidebarTodoList>;
  invalidate: () => void;
};

const EMPTY_STRING_MAP = new Map<string, string>();
const EMPTY_PROGRAM_CARD_MAP = new Map<string, ServerAgentsVxappSidebarAuthorityProgramCard>();
const EMPTY_RUNTIME_TARGET_MAP = new Map<
  string,
  ServerAgentsVxappSidebarAuthorityProgramCard["executive"]
>();
const EMPTY_DIAGNOSTICS_MAP = new Map<string, readonly AgentsVxappSidebarAuthorityDiagnostic[]>();
const EMPTY_TODOS_MAP = new Map<string, SidebarTodoList>();
const EMPTY_WAKE_SUMMARY_MAP = new Map<string, SidebarWakeSummary>();

function buildOpenWakeSummaryByThreadId(
  wakeItems: readonly ServerAgentsVxappSidebarWake[],
): ReadonlyMap<string, SidebarWakeSummary> {
  const summaryByThreadId = new Map<string, SidebarWakeSummary>();

  for (const wakeItem of wakeItems) {
    if (wakeItem.state !== "pending" && wakeItem.state !== "delivering") {
      continue;
    }

    const orchestratorSummary = summaryByThreadId.get(wakeItem.orchestratorThreadId) ?? {
      openWakeCount: 0,
    };
    summaryByThreadId.set(wakeItem.orchestratorThreadId, {
      openWakeCount: orchestratorSummary.openWakeCount + 1,
    });

    const workerThreadId =
      wakeItem.payload && typeof wakeItem.payload.workerThreadId === "string"
        ? wakeItem.payload.workerThreadId
        : null;
    if (!workerThreadId) {
      continue;
    }

    const workerSummary = summaryByThreadId.get(workerThreadId) ?? {
      openWakeCount: 0,
    };
    summaryByThreadId.set(workerThreadId, {
      openWakeCount: workerSummary.openWakeCount + 1,
    });
  }

  return summaryByThreadId;
}

function hasFreshSnapshot(input: {
  fetchedAt: number | null;
  snapshot: ServerGetAgentsVxappSidebarAuthoritySnapshotResult | null;
}) {
  return (
    input.snapshot !== null &&
    input.fetchedAt !== null &&
    Date.now() - input.fetchedAt < AGENTS_VXAPP_SIDEBAR_AUTHORITY_STALE_TIME_MS
  );
}

export const useAgentsVxappStore = create<AgentsVxappStoreState>((set, get) => ({
  snapshot: null,
  status: "idle",
  error: null,
  fetchedAt: null,
  inFlightRefresh: null,
  attentionItems: [],
  notifications: [],
  openWakes: [],
  openWakeSummaryByThreadId: EMPTY_WAKE_SUMMARY_MAP,
  programCards: [],
  programCardById: EMPTY_PROGRAM_CARD_MAP,
  runtimeTargetByThreadId: EMPTY_RUNTIME_TARGET_MAP,
  currentTodoIdByProgramId: EMPTY_STRING_MAP,
  diagnosticsByProgramId: EMPTY_DIAGNOSTICS_MAP,
  todosByProgramId: EMPTY_TODOS_MAP,
  setNormalizedSnapshot: (normalized) =>
    set({
      attentionItems: normalized.attentionItems,
      snapshot: normalized.snapshot,
      status: "ready",
      error: null,
      fetchedAt: Date.now(),
      notifications: normalized.notifications,
      openWakes: normalized.openWakes,
      openWakeSummaryByThreadId: buildOpenWakeSummaryByThreadId(normalized.openWakes),
      programCards: normalized.programCards,
      programCardById: normalized.programCardById,
      runtimeTargetByThreadId: normalized.runtimeTargetByThreadId,
      currentTodoIdByProgramId: normalized.currentTodoIdByProgramId,
      diagnosticsByProgramId: normalized.diagnosticsByProgramId,
      todosByProgramId: normalized.todosByProgramId,
    }),
  invalidate: () =>
    set({
      fetchedAt: null,
    }),
  refreshSidebarAuthority: async (input) => {
    const existing = get();
    if (!input?.force && hasFreshSnapshot(existing)) {
      return;
    }
    if (existing.inFlightRefresh) {
      await existing.inFlightRefresh;
      return;
    }
    const refreshPromise = (async () => {
      set((state) => ({
        status: state.snapshot === null ? "loading" : state.status,
        error: null,
      }));
      try {
        const snapshot = await fetchAgentsVxappSidebarAuthoritySnapshotFromOwner();
        get().setNormalizedSnapshot(normalizeAgentsVxappSidebarAuthoritySnapshot(snapshot));
      } catch (error) {
        const boundaryError: AgentsVxappOwnerBoundaryError =
          error && typeof error === "object" && "kind" in error && "message" in error
            ? (error as AgentsVxappOwnerBoundaryError)
            : {
                kind: "owner_contract_error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to refresh agents-vxapp sidebar authority snapshot.",
              };
        set({
          status: "error",
          error: boundaryError,
        });
      }
    })();
    set({ inFlightRefresh: refreshPromise });
    try {
      await refreshPromise;
    } finally {
      if (get().inFlightRefresh === refreshPromise) {
        set({ inFlightRefresh: null });
      }
    }
  },
}));

export function invalidateAgentsVxappStore() {
  useAgentsVxappStore.getState().invalidate();
}

export function refreshAgentsVxappStore(input?: { force?: boolean }) {
  return useAgentsVxappStore.getState().refreshSidebarAuthority(input);
}

export function useAgentsVxappSidebarAuthorityBootstrap() {
  const refreshSidebarAuthority = useAgentsVxappStore((store) => store.refreshSidebarAuthority);
  useEffect(() => {
    void refreshSidebarAuthority();
  }, [refreshSidebarAuthority]);
}
