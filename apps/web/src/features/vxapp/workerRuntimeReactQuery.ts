import { type ServerGetWorkerRuntimeSnapshotResult, type ThreadId } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const WORKER_RUNTIME_STALE_TIME_MS = 30_000;

export const workerRuntimeQueryKeys = {
  all: ["worker-runtime"] as const,
  snapshot: (threadId: ThreadId | null, workspace: string | null) =>
    ["worker-runtime", "snapshot", threadId, workspace] as const,
};

export function workerRuntimeSnapshotQueryOptions(input: {
  threadId: ThreadId | null;
  workspace?: string | null;
}) {
  return queryOptions({
    queryKey: workerRuntimeQueryKeys.snapshot(input.threadId, input.workspace ?? null),
    enabled:
      input.threadId !== null && typeof input.workspace === "string" && input.workspace.length > 0,
    staleTime: WORKER_RUNTIME_STALE_TIME_MS,
    queryFn: async () => {
      if (!input.threadId) {
        throw new Error("Worker runtime snapshot is unavailable.");
      }
      if (!input.workspace) {
        throw new Error("Worker runtime workspace is unavailable.");
      }
      return ensureNativeApi().server.getWorkerRuntimeSnapshot({
        threadId: input.threadId,
        workspace: input.workspace,
      });
    },
  });
}

export function getWorkerRuntimeRepoLabel(
  snapshot: ServerGetWorkerRuntimeSnapshotResult | null | undefined,
): string | null {
  const candidates = [
    snapshot?.contextPlan?.repo,
    snapshot?.dispatchContract?.repo,
    snapshot?.installedPacks?.repo,
    snapshot?.audit.repo,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export function workerRuntimeRepoQueryOptions(input: {
  threadId: ThreadId | null;
  workspace?: string | null;
}) {
  const snapshotOptions = workerRuntimeSnapshotQueryOptions(input);
  return queryOptions({
    ...snapshotOptions,
    select: (data) => getWorkerRuntimeRepoLabel(data),
  });
}
