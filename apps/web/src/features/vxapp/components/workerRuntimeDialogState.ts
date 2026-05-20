import type { ServerGetWorkerRuntimeSnapshotResult } from "@t3tools/contracts";

export type WorkerRuntimeUnavailableHint =
  | "degraded"
  | "unavailable"
  | "pending-worktree"
  | "transient"
  | "stale-lineage";

export type WorkerRuntimeDialogMode =
  | "loading"
  | "error"
  | "missing"
  | "invalid"
  | "degraded"
  | "unavailable"
  | "pending-worktree"
  | "transient"
  | "stale-lineage"
  | "ready";

function describeRuntimeReasonCode(reasonCode: string | null): string {
  switch (reasonCode) {
    case "runtime_files_missing":
      return "Runtime files are missing.";
    case "runtime_payload_invalid":
      return "Runtime payload is invalid.";
    case "runtime_authority_missing":
      return "Runtime authority is missing.";
    default:
      return "Runtime details are not available yet.";
  }
}

export function deriveWorkerRuntimeDialogState(input: {
  data: ServerGetWorkerRuntimeSnapshotResult | null | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  unavailableHint?: {
    kind: WorkerRuntimeUnavailableHint;
    message: string | null;
  } | null;
  threadId: string | null;
}): {
  message: string | null;
  mode: WorkerRuntimeDialogMode;
} {
  if (!input.threadId) {
    return {
      mode: "missing",
      message: "Live runtime details are unavailable for this worker.",
    };
  }
  if (input.isLoading) {
    return {
      mode: "loading",
      message: "Loading runtime files and contract summary.",
    };
  }
  if (input.unavailableHint) {
    return {
      mode: input.unavailableHint.kind,
      message: input.unavailableHint.message,
    };
  }
  if (input.isError) {
    return {
      mode: "error",
      message: input.error?.message ?? "Runtime details could not be loaded.",
    };
  }
  if (!input.data) {
    return {
      mode: "missing",
      message: "Runtime details are not available yet.",
    };
  }
  if (input.data.availability !== "inspectable") {
    return {
      mode: input.data.availability,
      message: describeRuntimeReasonCode(input.data.reasonCode),
    };
  }

  return {
    mode: "ready",
    message: null,
  };
}
