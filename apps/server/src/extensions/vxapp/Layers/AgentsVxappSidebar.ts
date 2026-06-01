import { Effect, Layer, Schema } from "effect";
import {
  AgentsVxappSidebar,
  AgentsVxappSidebarError,
  type AgentsVxappSidebarShape,
} from "../Services/AgentsVxappSidebar.ts";
import {
  fetchAgentsVxappSidebarAuthoritySnapshot,
  AgentsVxappOwnerClientError,
} from "../agentsVxappOwnerClient.ts";

const isAgentsVxappSidebarError = Schema.is(AgentsVxappSidebarError);

function makeAgentsVxappSidebar(): AgentsVxappSidebarShape {
  function mapSidebarError(message: string, cause: unknown): AgentsVxappSidebarError {
    if (isAgentsVxappSidebarError(cause)) {
      return cause;
    }
    if (cause instanceof AgentsVxappOwnerClientError) {
      return new AgentsVxappSidebarError({
        message,
        ownerCommand: cause.ownerCommand,
        authoritySurface: cause.authoritySurface,
        ownerErrorCode: cause.ownerErrorCode,
        details: cause.details,
        hints: [...cause.hints],
      });
    }
    return new AgentsVxappSidebarError({ message });
  }

  const getAuthoritySnapshot: AgentsVxappSidebarShape["getAuthoritySnapshot"] = (input) =>
    Effect.tryPromise({
      try: () => fetchAgentsVxappSidebarAuthoritySnapshot(input),
      catch: (error) =>
        mapSidebarError(
          error instanceof Error
            ? error.message
            : "Failed to fetch vxapp sidebar authority owner snapshot.",
          error,
        ),
    });

  return {
    getAuthoritySnapshot,
  } satisfies AgentsVxappSidebarShape;
}

export const AgentsVxappSidebarLive = Layer.succeed(AgentsVxappSidebar, makeAgentsVxappSidebar());
