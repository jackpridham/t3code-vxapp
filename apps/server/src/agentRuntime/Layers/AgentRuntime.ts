import { GetAgentRuntimeSnapshotResult as GetAgentRuntimeSnapshotResultSchema } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { fetchAgentsVxappAgentRuntimeSnapshot } from "../../extensions/vxapp/agentsVxappOwnerClient.ts";
import {
  AgentRuntime,
  AgentRuntimeError,
  type AgentRuntimeShape,
} from "../Services/AgentRuntime.ts";

const decodeSnapshot = Schema.decodeUnknownEffect(GetAgentRuntimeSnapshotResultSchema);

function decodeSnapshotResult(snapshot: unknown) {
  return decodeSnapshot(snapshot).pipe(
    Effect.mapError(
      () =>
        new AgentRuntimeError({
          message: "Agent runtime snapshot normalization failed.",
        }),
    ),
  );
}

export const makeAgentRuntime = Effect.succeed({
  getSnapshot: (input) =>
    Effect.tryPromise({
      try: () => fetchAgentsVxappAgentRuntimeSnapshot(input),
      catch: (cause) =>
        new AgentRuntimeError({
          message:
            cause instanceof Error
              ? cause.message
              : "Failed to fetch agent runtime owner snapshot.",
        }),
    }).pipe(Effect.flatMap(decodeSnapshotResult)),
} satisfies AgentRuntimeShape);

export const AgentRuntimeLive = Layer.effect(AgentRuntime, makeAgentRuntime);
