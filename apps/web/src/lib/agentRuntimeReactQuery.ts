import type {
  AgentRuntimeAgentKind,
  ServerGetAgentRuntimeSnapshotResult,
  ThreadId,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

const AGENT_RUNTIME_STALE_TIME_MS = 30_000;

export const agentRuntimeQueryKeys = {
  all: ["agent-runtime"] as const,
  snapshot: (threadId: ThreadId | null, agentKind: AgentRuntimeAgentKind) =>
    ["agent-runtime", "snapshot", agentKind, threadId] as const,
};

export function agentRuntimeSnapshotQueryOptions(input: {
  agentKind: AgentRuntimeAgentKind;
  threadId: ThreadId | null;
}) {
  return queryOptions({
    queryKey: agentRuntimeQueryKeys.snapshot(input.threadId, input.agentKind),
    enabled: true,
    staleTime: AGENT_RUNTIME_STALE_TIME_MS,
    queryFn: async () => {
      return ensureNativeApi().server.getAgentRuntimeSnapshot({
        agentKind: input.agentKind,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      });
    },
  });
}

export function getAgentRuntimeRepoLabel(
  snapshot: ServerGetAgentRuntimeSnapshotResult | null | undefined,
): string | null {
  const repo = snapshot?.summary.repo;
  return typeof repo === "string" && repo.trim().length > 0 ? repo.trim() : null;
}
