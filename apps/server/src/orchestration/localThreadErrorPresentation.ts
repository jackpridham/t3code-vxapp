import type { OrchestrationThreadErrorPresentationSource } from "@t3tools/contracts";

const ACTIVE_THREAD_FAILURE_MESSAGE = "Thread failed.";

/**
 * Local/native orchestration-only error presentation.
 *
 * Do not use this for vxapp-backed threads. Those threads must consume the
 * authoritative `agents-vxapp` fields parsed by the external role authority
 * bridge instead of recomputing from raw session or turn state.
 */
export interface LocalThreadErrorPresentation {
  readonly hasActiveError: boolean;
  readonly activeError: string | null;
  readonly historicalError: string | null;
  readonly errorPresentationSource: OrchestrationThreadErrorPresentationSource;
}

export function resolveLocalThreadErrorPresentation(input: {
  archivedAt: string | null | undefined;
  deletedAt: string | null | undefined;
  latestTurnState: string | null | undefined;
  sessionStatus: string | null | undefined;
  sessionLastError: string | null | undefined;
}): LocalThreadErrorPresentation {
  const sessionLastError =
    typeof input.sessionLastError === "string" && input.sessionLastError.length > 0
      ? input.sessionLastError
      : null;
  const isArchivedResidue = input.archivedAt != null || input.deletedAt != null;
  if (isArchivedResidue) {
    return {
      hasActiveError: false,
      activeError: null,
      historicalError: sessionLastError,
      errorPresentationSource: sessionLastError === null ? "none" : "historical_session_last_error",
    };
  }

  const isActiveFailure = input.latestTurnState === "error" || input.sessionStatus === "error";
  if (isActiveFailure) {
    return {
      hasActiveError: true,
      activeError: sessionLastError ?? ACTIVE_THREAD_FAILURE_MESSAGE,
      historicalError: null,
      errorPresentationSource:
        sessionLastError === null ? "active_runtime_failure" : "active_session_last_error",
    };
  }

  return {
    hasActiveError: false,
    activeError: null,
    historicalError: sessionLastError,
    errorPresentationSource: sessionLastError === null ? "none" : "historical_session_last_error",
  };
}
