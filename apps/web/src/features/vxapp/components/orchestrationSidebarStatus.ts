import type {
  AgentsVxappOwnerLoadStatus,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
} from "@t3tools/contracts";

export function deriveOrchestrationSidebarEmptyState(input: {
  authorityStatus: AgentsVxappOwnerLoadStatus;
  authoritySnapshot: ServerGetAgentsVxappSidebarAuthoritySnapshotResult | null;
}): { title: string; description: string } | null {
  const snapshot = input.authoritySnapshot;
  if (input.authorityStatus === "error" || !snapshot || snapshot.programs.length > 0) {
    return null;
  }
  const message = snapshot.ownerDiagnostics[0]?.message ?? null;
  if (message) {
    return {
      title: "Owner snapshot is incomplete",
      description: `The sidebar owner returned no visible programs. ${message}`,
    };
  }
  return {
    title: "No active programs published",
    description: "The sidebar owner returned zero visible programs for this authority snapshot.",
  };
}
