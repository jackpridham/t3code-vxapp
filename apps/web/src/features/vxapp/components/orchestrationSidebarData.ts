import type {
  AgentRuntimeAgentKind,
  ServerGetAgentRuntimeSnapshotResult,
  ServerGetWorkerRuntimeSnapshotResult,
} from "@t3tools/contracts";
import { useEffect, useMemo } from "react";
import { useSettings } from "~/hooks/useSettings";
import { useUiStateStore } from "~/uiStateStore";
import { useStore } from "~/store";
import { useAgentsVxappStore } from "~/features/vxapp/agentsVxappStore";
import { ORCHESTRATION_SIDEBAR_DEMO_STATE } from "./orchestrationSidebarDemoData";

export function useOrchestrationSidebarData() {
  const sidebarOrchestrationDataMode = useSettings().sidebarOrchestrationDataMode;
  const authoritySnapshot = useAgentsVxappStore((store) => store.snapshot);
  const authorityStatus = useAgentsVxappStore((store) => store.status);
  const authorityError = useAgentsVxappStore((store) => store.error);
  const refreshSidebarAuthority = useAgentsVxappStore((store) => store.refreshSidebarAuthority);
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);

  useEffect(() => {
    if (sidebarOrchestrationDataMode !== "live") {
      return;
    }
    void refreshSidebarAuthority();
  }, [refreshSidebarAuthority, sidebarOrchestrationDataMode]);

  return useMemo(() => {
    if (sidebarOrchestrationDataMode === "demo") {
      return {
        ...ORCHESTRATION_SIDEBAR_DEMO_STATE,
        dataMode: "demo" as const,
      };
    }

    return {
      authorityError,
      authoritySnapshot,
      authorityStatus,
      dataMode: "live" as const,
      getAgentRuntimeSnapshot: (
        _agentKind: AgentRuntimeAgentKind,
        _threadId: string | null,
      ): ServerGetAgentRuntimeSnapshotResult | null => null,
      getWorkerRuntimeSnapshot: (
        _threadId: string | null,
      ): ServerGetWorkerRuntimeSnapshotResult | null => null,
      isReadOnly: false,
      projects,
      refreshSidebarAuthority,
      threadLastVisitedAtById,
      threads,
    };
  }, [
    sidebarOrchestrationDataMode,
    authorityError,
    authoritySnapshot,
    authorityStatus,
    projects,
    refreshSidebarAuthority,
    threadLastVisitedAtById,
    threads,
  ]);
}
