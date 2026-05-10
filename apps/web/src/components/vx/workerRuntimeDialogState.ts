import type { ServerGetWorkerRuntimeSnapshotResult } from "@t3tools/contracts";

export type WorkerRuntimeUnavailableHint = "pending-worktree" | "transient" | "stale-lineage";

export type WorkerRuntimeDialogMode =
  | "loading"
  | "error"
  | "missing"
  | "invalid"
  | "pending-worktree"
  | "transient"
  | "stale-lineage"
  | "ready";

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

  const sourceFiles = Object.values(input.data.sourceFiles);
  const invalidSourceFile = sourceFiles.find(
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

  const missingSourceFile = sourceFiles.find(
    (sourceFile) => sourceFile.status === "missing" && sourceFile.detail?.trim(),
  );
  if (sourceFiles.every((sourceFile) => sourceFile.status === "missing")) {
    return {
      mode: "missing",
      message:
        missingSourceFile?.detail?.trim() ??
        "Runtime details are not available for this worker yet.",
    };
  }

  return {
    mode: "ready",
    message: null,
  };
}
