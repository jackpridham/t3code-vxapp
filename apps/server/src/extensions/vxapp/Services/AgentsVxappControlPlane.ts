import type {
  ServerAgentsVxappOwnerMutationResult,
  ServerCreateAgentsVxappProgramInput,
  ServerCreateAgentsVxappTodoInput,
  ServerDeleteAgentsVxappProgramInput,
  ServerDeleteAgentsVxappTodoInput,
  ServerGetAgentsVxappControlPlaneSnapshotInput,
  ServerGetAgentsVxappControlPlaneSnapshotResult,
  ServerSetAgentsVxappProgramLifecycleInput,
  ServerUpdateAgentsVxappProgramInput,
  ServerUpdateAgentsVxappTodoInput,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class AgentsVxappControlPlaneError extends Schema.TaggedErrorClass<AgentsVxappControlPlaneError>()(
  "AgentsVxappControlPlaneError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface AgentsVxappControlPlaneShape {
  readonly getSnapshot: (
    input: ServerGetAgentsVxappControlPlaneSnapshotInput,
  ) => Effect.Effect<ServerGetAgentsVxappControlPlaneSnapshotResult, AgentsVxappControlPlaneError>;
  readonly createProgram: (
    input: ServerCreateAgentsVxappProgramInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly updateProgram: (
    input: ServerUpdateAgentsVxappProgramInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly deleteProgram: (
    input: ServerDeleteAgentsVxappProgramInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly setProgramLifecycle: (
    input: ServerSetAgentsVxappProgramLifecycleInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly createTodo: (
    input: ServerCreateAgentsVxappTodoInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly updateTodo: (
    input: ServerUpdateAgentsVxappTodoInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly deleteTodo: (
    input: ServerDeleteAgentsVxappTodoInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
}

export class AgentsVxappControlPlane extends ServiceMap.Service<
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneShape
>()("t3/extensions/vxapp/Services/AgentsVxappControlPlane") {}
