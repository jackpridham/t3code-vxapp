import { type OrchestratorWakeItem, type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { selectProjectById, selectThreadById, useStore } from "./store";
import { type Project, type Thread } from "./types";

export function useProjectById(projectId: Project["id"] | null | undefined): Project | undefined {
  const selector = useMemo(() => selectProjectById(projectId), [projectId]);
  return useStore(selector);
}

export function useThreadById(threadId: ThreadId | null | undefined): Thread | undefined {
  const selector = useMemo(() => selectThreadById(threadId), [threadId]);
  return useStore(selector);
}

export function useWakeItemsForOrchestratorThread(
  threadId: ThreadId | null | undefined,
): OrchestratorWakeItem[] {
  const selector = useMemo(
    () => (state: { orchestratorWakeItems: OrchestratorWakeItem[] }) =>
      threadId
        ? state.orchestratorWakeItems.filter(
            (wakeItem) => wakeItem.orchestratorThreadId === threadId,
          )
        : [],
    [threadId],
  );
  return useStore(selector);
}

export function useWakeItemsForWorkerThread(
  threadId: ThreadId | null | undefined,
): OrchestratorWakeItem[] {
  const selector = useMemo(
    () => (state: { orchestratorWakeItems: OrchestratorWakeItem[] }) =>
      threadId
        ? state.orchestratorWakeItems.filter((wakeItem) => wakeItem.workerThreadId === threadId)
        : [],
    [threadId],
  );
  return useStore(selector);
}
