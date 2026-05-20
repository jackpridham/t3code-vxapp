import type {
  GetAgentRuntimeSnapshotInput,
  GetAgentRuntimeSnapshotResult,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";
import type { ProjectionRepositoryError } from "../../../persistence/Errors.ts";

export class AgentRuntimeError extends Schema.TaggedErrorClass<AgentRuntimeError>()(
  "AgentRuntimeError",
  {
    message: Schema.String,
  },
) {}

export interface AgentRuntimeShape {
  readonly getSnapshot: (
    input: GetAgentRuntimeSnapshotInput,
  ) => Effect.Effect<GetAgentRuntimeSnapshotResult, ProjectionRepositoryError | AgentRuntimeError>;
}

export class AgentRuntime extends ServiceMap.Service<AgentRuntime, AgentRuntimeShape>()(
  "t3/extensions/vxapp/Services/AgentRuntime",
) {}
