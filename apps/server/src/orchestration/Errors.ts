export {
  OrchestrationCommandDecodeError,
  OrchestrationCommandInvariantError,
  OrchestrationCommandJsonParseError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationListenerCallbackError,
  OrchestrationProjectorDecodeError,
  toListenerCallbackError,
  toOrchestrationCommandDecodeError,
  toOrchestrationJsonParseError,
  toProjectorDecodeError,
} from "@t3tools/orchestration-core/errors";

import type {
  OrchestrationCommandDecodeError,
  OrchestrationCommandInvariantError,
  OrchestrationCommandJsonParseError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationListenerCallbackError,
  OrchestrationProjectorDecodeError,
} from "@t3tools/orchestration-core/errors";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";

export type OrchestrationDispatchError =
  | ProjectionRepositoryError
  | OrchestrationCommandInvariantError
  | OrchestrationCommandPreviouslyRejectedError
  | OrchestrationProjectorDecodeError
  | OrchestrationListenerCallbackError;

export type OrchestrationEngineError =
  | OrchestrationDispatchError
  | OrchestrationCommandJsonParseError
  | OrchestrationCommandDecodeError;
