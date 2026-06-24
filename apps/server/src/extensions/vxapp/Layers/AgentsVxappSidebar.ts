import { Effect, Layer, Schema } from "effect";
import {
  AgentsVxappSidebar,
  AgentsVxappSidebarError,
  type AgentsVxappSidebarShape,
} from "../Services/AgentsVxappSidebar.ts";
import {
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  type ServerGetAgentsVxappSidebarAuthoritySnapshotResult as ServerGetAgentsVxappSidebarAuthoritySnapshotResultType,
} from "@t3tools/contracts";
import {
  fetchAgentsVxappSidebarAuthoritySnapshot,
  AgentsVxappOwnerClientError,
} from "../agentsVxappOwnerClient.ts";

const isAgentsVxappSidebarError = Schema.is(AgentsVxappSidebarError);
const decodeSidebarAuthoritySnapshot = Schema.decodeUnknownSync(
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult as never,
) as (input: unknown) => ServerGetAgentsVxappSidebarAuthoritySnapshotResultType;

function parseSidebarAuthoritySnapshot(
  snapshot: unknown,
): ServerGetAgentsVxappSidebarAuthoritySnapshotResultType {
  try {
    return decodeSidebarAuthoritySnapshot(snapshot);
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : "Unknown owner sidebar authority decode failure.";
    throw new AgentsVxappSidebarError({
      message: `Owner sidebar authority snapshot failed contract decode: ${reason}`,
      ownerCommand: "t3code-sidebar-authority-snapshot",
      authoritySurface: "sidebar_authority_snapshot",
    });
  }
}

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
      try: () =>
        fetchAgentsVxappSidebarAuthoritySnapshot(input).then(parseSidebarAuthoritySnapshot),
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
