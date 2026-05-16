import { GetWorkerRuntimeSnapshotResult as GetWorkerRuntimeSnapshotResultSchema } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { fetchAgentsVxappWorkerRuntimeSnapshot } from "../../extensions/vxapp/agentsVxappOwnerClient.ts";
import {
  WorkerRuntime,
  WorkerRuntimeError,
  type WorkerRuntimeShape,
} from "../Services/WorkerRuntime.ts";

const decodeSnapshot = Schema.decodeUnknownEffect(GetWorkerRuntimeSnapshotResultSchema);

function decodeSnapshotResult(snapshot: unknown) {
  return decodeSnapshot(snapshot).pipe(
    Effect.mapError(
      () =>
        new WorkerRuntimeError({
          message: "Worker runtime snapshot normalization failed.",
        }),
    ),
  );
}

export const makeWorkerRuntime = Effect.succeed({
  getSnapshot: (input) =>
    Effect.tryPromise({
      try: () => fetchAgentsVxappWorkerRuntimeSnapshot(input),
      catch: (cause) =>
        new WorkerRuntimeError({
          message:
            cause instanceof Error
              ? cause.message
              : "Failed to fetch worker runtime owner snapshot.",
        }),
    }).pipe(Effect.flatMap(decodeSnapshotResult)),
} satisfies WorkerRuntimeShape);

export const WorkerRuntimeLive = Layer.effect(WorkerRuntime, makeWorkerRuntime);
