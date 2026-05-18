import type {
  ServerGetAgentsVxappSidebarGraphInput,
  ServerGetAgentsVxappSidebarGraphResult,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class AgentsVxappSidebarError extends Schema.TaggedErrorClass<AgentsVxappSidebarError>()(
  "AgentsVxappSidebarError",
  {
    message: Schema.String,
  },
) {}

export type AgentsVxappSidebarOwnerGraphSnapshot = Omit<
  ServerGetAgentsVxappSidebarGraphResult,
  "mirrorDiagnostics"
>;

export interface AgentsVxappSidebarShape {
  readonly getGraph: (
    input: ServerGetAgentsVxappSidebarGraphInput,
  ) => Effect.Effect<ServerGetAgentsVxappSidebarGraphResult, AgentsVxappSidebarError>;
}

export class AgentsVxappSidebar extends ServiceMap.Service<
  AgentsVxappSidebar,
  AgentsVxappSidebarShape
>()("t3/extensions/vxapp/Services/AgentsVxappSidebar") {}
