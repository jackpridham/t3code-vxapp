import { type ThreadId } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const WORKER_RUNTIME_STALE_TIME_MS = 30_000;

export const workerRuntimeQueryKeys = {
  all: ["worker-runtime"] as const,
  snapshot: (threadId: ThreadId | null) => ["worker-runtime", "snapshot", threadId] as const,
};

export function workerRuntimeSnapshotQueryOptions(input: { threadId: ThreadId | null }) {
  return queryOptions({
    queryKey: workerRuntimeQueryKeys.snapshot(input.threadId),
    enabled: input.threadId !== null,
    staleTime: WORKER_RUNTIME_STALE_TIME_MS,
    queryFn: async () => {
      if (!input.threadId) {
        throw new Error("Worker runtime snapshot is unavailable.");
      }
      return ensureNativeApi().server.getWorkerRuntimeSnapshot({
        threadId: input.threadId,
      });
    },
  });
}
