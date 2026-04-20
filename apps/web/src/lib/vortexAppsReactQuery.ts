import { queryOptions } from "@tanstack/react-query";
import { ServerListVortexAppArtifactsResult } from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";

export const vortexAppsQueryKeys = {
  all: ["vortexApps"] as const,
  list: () => ["vortexApps", "list"] as const,
  artifacts: {
    all: ["vortexApps", "artifacts"] as const,
    list: (targetId: string, includeArchived: boolean) =>
      ["vortexApps", "artifacts", targetId, includeArchived ? "withArchived" : "active"] as const,
  },
};

export function vortexAppsListQueryOptions() {
  return queryOptions({
    queryKey: vortexAppsQueryKeys.list(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listVortexApps();
    },
    staleTime: 30_000,
  });
}

export function vortexAppArtifactsQueryOptions(input: {
  targetId: string;
  includeArchived?: boolean;
  enabled?: boolean;
  staleTime?: number;
}) {
  const includeArchived = input.includeArchived === true;
  return queryOptions<ServerListVortexAppArtifactsResult>({
    queryKey: vortexAppsQueryKeys.artifacts.list(input.targetId, includeArchived),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listVortexAppArtifacts({
        target_id: input.targetId,
        includeArchived,
      });
    },
    enabled: input.enabled ?? true,
    staleTime: input.staleTime ?? 60_000,
  });
}
