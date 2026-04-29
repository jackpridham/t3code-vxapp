import type {
  GetWorkerRuntimeSnapshotInput,
  GetWorkerRuntimeSnapshotResult,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export class WorkerRuntimeError extends Schema.TaggedErrorClass<WorkerRuntimeError>()(
  "WorkerRuntimeError",
  {
    message: Schema.String,
  },
) {}

export interface WorkerRuntimeShape {
  readonly getSnapshot: (
    input: GetWorkerRuntimeSnapshotInput,
  ) => Effect.Effect<
    GetWorkerRuntimeSnapshotResult,
    ProjectionRepositoryError | WorkerRuntimeError
  >;
}

export class WorkerRuntime extends ServiceMap.Service<WorkerRuntime, WorkerRuntimeShape>()(
  "t3/workerRuntime/Services/WorkerRuntime",
) {}
