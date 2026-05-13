type ThreadErrorPresentation = {
  hasActiveError: boolean;
  activeError: string | null | undefined;
  historicalError: string | null | undefined;
  errorPresentationSource:
    | "none"
    | "active_session_last_error"
    | "active_runtime_failure"
    | "historical_session_last_error";
};

function requireThreadErrorPresentation(input: ThreadErrorPresentation): asserts input is {
  hasActiveError: boolean;
  activeError: string | null;
  historicalError: string | null;
  errorPresentationSource: ThreadErrorPresentation["errorPresentationSource"];
} {
  if (input.hasActiveError && (typeof input.activeError !== "string" || input.activeError.length === 0)) {
    throw new Error("Thread payload is missing activeError for an active error presentation.");
  }
  if (!input.hasActiveError && input.errorPresentationSource.startsWith("active_")) {
    throw new Error("Thread payload has an invalid active error presentation contract.");
  }
}

export function presentThreadActiveError(input: ThreadErrorPresentation): string | null {
  requireThreadErrorPresentation(input);
  return input.hasActiveError ? input.activeError : null;
}

export function shouldDispatchThreadRateLimitNotification(input: ThreadErrorPresentation): boolean {
  const activeError = presentThreadActiveError(input);
  return typeof activeError === "string" && /rate.?limit|429|capacity|usage limit/i.test(activeError);
}
