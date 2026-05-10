import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const AGENTS_VXAPP_SIDEBAR_STALE_TIME_MS = 10_000;

export const agentsVxappSidebarQueryKeys = {
  all: ["agents-vxapp-sidebar"] as const,
  graph: () => ["agents-vxapp-sidebar", "graph"] as const,
};

export function agentsVxappSidebarGraphQueryOptions() {
  return queryOptions({
    queryKey: agentsVxappSidebarQueryKeys.graph(),
    staleTime: AGENTS_VXAPP_SIDEBAR_STALE_TIME_MS,
    queryFn: async () => ensureNativeApi().server.getAgentsVxappSidebarGraph({}),
  });
}
