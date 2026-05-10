import { type ServerGetWorkerRuntimeSnapshotResult, type ThreadId } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const WORKER_RUNTIME_STALE_TIME_MS = 30_000;

export const workerRuntimeQueryKeys = {
  all: ["worker-runtime"] as const,
  snapshot: (threadId: ThreadId | null, worktreePath: string | null) =>
    ["worker-runtime", "snapshot", threadId, worktreePath] as const,
};

export function workerRuntimeSnapshotQueryOptions(input: {
  threadId: ThreadId | null;
  worktreePath?: string | null;
}) {
  return queryOptions({
    queryKey: workerRuntimeQueryKeys.snapshot(input.threadId, input.worktreePath ?? null),
    enabled: input.threadId !== null,
    staleTime: WORKER_RUNTIME_STALE_TIME_MS,
    queryFn: async () => {
      if (!input.threadId) {
        throw new Error("Worker runtime snapshot is unavailable.");
      }
      return ensureNativeApi().server.getWorkerRuntimeSnapshot({
        threadId: input.threadId,
        ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
      });
    },
  });
}

export function getWorkerRuntimeRepoLabel(
  snapshot: ServerGetWorkerRuntimeSnapshotResult | null | undefined,
): string | null {
  const repo = snapshot?.summary.repo;
  return typeof repo === "string" && repo.trim().length > 0 ? repo.trim() : null;
}

export function workerRuntimeRepoQueryOptions(input: {
  threadId: ThreadId | null;
  worktreePath?: string | null;
}) {
  const snapshotOptions = workerRuntimeSnapshotQueryOptions(input);
  return queryOptions({
    ...snapshotOptions,
    select: (data) => getWorkerRuntimeRepoLabel(data),
  });
}
