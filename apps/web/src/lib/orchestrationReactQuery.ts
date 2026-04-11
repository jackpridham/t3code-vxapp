import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const ORCHESTRATION_PROJECT_CATALOG_STALE_TIME_MS = 15_000;
const ORCHESTRATION_SESSION_CATALOG_STALE_TIME_MS = 10_000;

export const orchestrationQueryKeys = {
  all: ["orchestration-query"] as const,
  projectThreads: (projectId: ProjectId | null, includeArchived: boolean) =>
    ["orchestration-query", "projectThreads", projectId, includeArchived] as const,
  sessionThreads: (rootThreadId: ThreadId | null, includeArchived: boolean) =>
    ["orchestration-query", "sessionThreads", rootThreadId, includeArchived] as const,
};

export function orchestrationProjectThreadsQueryOptions(input: {
  projectId: ProjectId | null;
  includeArchived: boolean;
}) {
  return queryOptions({
    queryKey: orchestrationQueryKeys.projectThreads(input.projectId, input.includeArchived),
    enabled: input.projectId !== null,
    staleTime: ORCHESTRATION_PROJECT_CATALOG_STALE_TIME_MS,
    queryFn: async () => {
      if (!input.projectId) {
        throw new Error("Project thread catalog is unavailable.");
      }
      return ensureNativeApi().orchestration.listProjectThreads({
        projectId: input.projectId,
        includeArchived: input.includeArchived,
        includeDeleted: false,
      });
    },
  });
}

export function orchestrationSessionThreadsQueryOptions(input: {
  rootThreadId: ThreadId | null;
  includeArchived: boolean;
}) {
  return queryOptions({
    queryKey: orchestrationQueryKeys.sessionThreads(input.rootThreadId, input.includeArchived),
    enabled: input.rootThreadId !== null,
    staleTime: ORCHESTRATION_SESSION_CATALOG_STALE_TIME_MS,
    queryFn: async () => {
      if (!input.rootThreadId) {
        throw new Error("Session thread catalog is unavailable.");
      }
      return ensureNativeApi().orchestration.listSessionThreads({
        rootThreadId: input.rootThreadId,
        includeArchived: input.includeArchived,
        includeDeleted: false,
      });
    },
  });
}

export function invalidateOrchestrationProjectCatalogs(
  queryClient: QueryClient,
  projectIds: readonly ProjectId[],
): Promise<unknown[]> {
  return Promise.all(
    [...new Set(projectIds)].map((projectId) =>
      queryClient.invalidateQueries({
        queryKey: orchestrationQueryKeys.projectThreads(projectId, true),
      }),
    ),
  );
}

export function invalidateOrchestrationSessionCatalogs(
  queryClient: QueryClient,
  rootThreadIds: readonly ThreadId[],
): Promise<unknown[]> {
  return Promise.all(
    [...new Set(rootThreadIds)].map((rootThreadId) =>
      queryClient.invalidateQueries({
        queryKey: orchestrationQueryKeys.sessionThreads(rootThreadId, true),
      }),
    ),
  );
}

export function invalidateOrchestrationSessionCatalog(
  queryClient: QueryClient,
  rootThreadId: ThreadId,
): Promise<unknown[]> {
  return invalidateOrchestrationSessionCatalogs(queryClient, [rootThreadId]);
}

export function invalidateAllOrchestrationQueries(queryClient: QueryClient): Promise<unknown[]> {
  return queryClient
    .invalidateQueries({
      queryKey: orchestrationQueryKeys.all,
    })
    .then((result) => [result]);
}
