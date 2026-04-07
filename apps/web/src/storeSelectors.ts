import { type OrchestratorWakeItem, type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { selectProjectById, selectThreadById, useStore } from "./store";
import { type Project, type Thread } from "./types";

const EMPTY_WAKE_ITEMS: OrchestratorWakeItem[] = [];

interface WakeItemsState {
  orchestratorWakeItems: OrchestratorWakeItem[];
}

export function useProjectById(projectId: Project["id"] | null | undefined): Project | undefined {
  const selector = useMemo(() => selectProjectById(projectId), [projectId]);
  return useStore(selector);
}

export function useThreadById(threadId: ThreadId | null | undefined): Thread | undefined {
  const selector = useMemo(() => selectThreadById(threadId), [threadId]);
  return useStore(selector);
}

type WakeThreadKey = "orchestratorThreadId" | "workerThreadId";

export function createWakeItemsForThreadSelector(
  threadId: ThreadId | null | undefined,
  key: WakeThreadKey,
): (state: WakeItemsState) => OrchestratorWakeItem[] {
  let previousWakeItems: OrchestratorWakeItem[] | null = null;
  let previousResult = EMPTY_WAKE_ITEMS;

  return (state: WakeItemsState): OrchestratorWakeItem[] => {
    if (!threadId) {
      return EMPTY_WAKE_ITEMS;
    }

    if (state.orchestratorWakeItems === previousWakeItems) {
      return previousResult;
    }

    previousWakeItems = state.orchestratorWakeItems;
    previousResult = state.orchestratorWakeItems.filter((wakeItem) => wakeItem[key] === threadId);
    return previousResult;
  };
}

export function useWakeItemsForOrchestratorThread(
  threadId: ThreadId | null | undefined,
): OrchestratorWakeItem[] {
  const selector = useMemo(
    () => createWakeItemsForThreadSelector(threadId, "orchestratorThreadId"),
    [threadId],
  );
  return useStore(selector);
}

export function useWakeItemsForWorkerThread(
  threadId: ThreadId | null | undefined,
): OrchestratorWakeItem[] {
  const selector = useMemo(
    () => createWakeItemsForThreadSelector(threadId, "workerThreadId"),
    [threadId],
  );
  return useStore(selector);
}
