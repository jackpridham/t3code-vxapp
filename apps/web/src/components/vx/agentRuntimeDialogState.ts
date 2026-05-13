import type { ServerGetAgentRuntimeSnapshotResult } from "@t3tools/contracts";
import type { WorkerRuntimeUnavailableHint } from "./workerRuntimeDialogState";

export type AgentRuntimeDialogMode =
  | "loading"
  | "error"
  | "missing"
  | "invalid"
  | WorkerRuntimeUnavailableHint
  | "ready";

export function deriveAgentRuntimeDialogState(input: {
  data: ServerGetAgentRuntimeSnapshotResult | null | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  threadId: string | null;
  unavailableHint?: {
    kind: WorkerRuntimeUnavailableHint;
    message: string | null;
  } | null;
}): {
  message: string | null;
  mode: AgentRuntimeDialogMode;
} {
  if (!input.threadId) {
    return {
      mode: "missing",
      message: "Live runtime details are unavailable for this agent.",
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

  const invalidSourceFile = input.data.sourceFiles.find(
    (sourceFile) => sourceFile.status === "invalid-json" || sourceFile.status === "schema-error",
  );
  if (invalidSourceFile) {
    return {
      mode: "invalid",
      message:
        invalidSourceFile.detail?.trim() ||
        `Runtime file '${invalidSourceFile.fileName}' is invalid.`,
    };
  }

  const missingSourceFile = input.data.sourceFiles.find(
    (sourceFile) => sourceFile.status === "missing" && sourceFile.detail?.trim(),
  );
  if (input.data.sourceFiles.every((sourceFile) => sourceFile.status === "missing")) {
    return {
      mode: "missing",
      message:
        missingSourceFile?.detail?.trim() ??
        "Runtime details are not available for this agent yet.",
    };
  }

  return {
    mode: "ready",
    message: null,
  };
}
