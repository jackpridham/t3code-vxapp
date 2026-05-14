import type { OrchestrationThreadErrorPresentationSource } from "@t3tools/contracts";

const ACTIVE_THREAD_FAILURE_MESSAGE = "Thread failed.";

export interface ThreadErrorPresentation {
  readonly hasActiveError: boolean;
  readonly activeError: string | null;
  readonly historicalError: string | null;
  readonly errorPresentationSource: OrchestrationThreadErrorPresentationSource;
}

export function resolveThreadErrorPresentation(input: {
  sessionStatus: string | null | undefined;
  sessionLastError: string | null | undefined;
}): ThreadErrorPresentation {
  const sessionLastError =
    typeof input.sessionLastError === "string" && input.sessionLastError.length > 0
      ? input.sessionLastError
      : null;

  if (input.sessionStatus === "error") {
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
