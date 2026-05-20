import {
  ORCHESTRATION_WS_METHODS,
  type OrchestrationListOrchestratorWakesInput,
  type ServerCreateAgentsVxappProgramInput,
  type ServerCreateAgentsVxappTodoInput,
  type ServerDeleteAgentsVxappProgramInput,
  type ServerDeleteAgentsVxappTodoInput,
  type ServerGetAgentsVxappSidebarAuthoritySnapshotInput,
  type ServerGetAgentsVxappControlPlaneSnapshotInput,
  type ServerGetAgentsVxappSidebarGraphInput,
  type ServerListVortexAppArtifactsInput,
  type ServerSetAgentsVxappProgramLifecycleInput,
  type ServerUpdateAgentsVxappProgramInput,
  type ServerUpdateAgentsVxappTodoInput,
  WS_METHODS,
  type WebSocketRequest,
} from "@t3tools/contracts";
import { Effect } from "effect";

import {
  AgentsVxappControlPlane,
  type AgentsVxappControlPlaneError,
} from "./Services/AgentsVxappControlPlane.ts";
import { AgentsVxappSidebar, type AgentsVxappSidebarError } from "./Services/AgentsVxappSidebar.ts";
import { ProjectionOperationalQuery } from "../../orchestration/Services/ProjectionOperationalQuery";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { VortexApps, type VortexAppsError } from "./Services/VortexApps.ts";
import type { AgentsVxappOwnerClientError } from "./agentsVxappOwnerClient.ts";

export type VxappWsRouteHandlerError =
  | AgentsVxappControlPlaneError
  | AgentsVxappSidebarError
  | AgentsVxappOwnerClientError
  | ProjectionRepositoryError
  | VortexAppsError;

export interface VxappWsRouteHandler {
  readonly handle: (request: WebSocketRequest) => Effect.Effect<unknown, VxappWsRouteHandlerError>;
}

export type VxappWsRouteHandlerMap = ReadonlyMap<string, VxappWsRouteHandler>;
export type VxappWsRouteHandlerServices =
  | AgentsVxappControlPlane
  | AgentsVxappSidebar
  | ProjectionOperationalQuery
  | VortexApps;

function stripRequestTag<T extends { _tag: string }>(body: T) {
  const { _tag, ...rest } = body;
  void _tag;
  return rest;
}

export const makeVxappWsRouteHandlers: Effect.Effect<
  VxappWsRouteHandlerMap,
  never,
  VxappWsRouteHandlerServices
> = Effect.gen(function* () {
  const agentsVxappControlPlane = yield* AgentsVxappControlPlane;
  const agentsVxappSidebar = yield* AgentsVxappSidebar;
  const projectionOperationalQuery = yield* ProjectionOperationalQuery;
  const vortexApps = yield* VortexApps;

  return new Map<string, VxappWsRouteHandler>([
    [
      ORCHESTRATION_WS_METHODS.listOrchestratorWakes,
      {
        handle: (request) =>
          projectionOperationalQuery.listOrchestratorWakes(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof ORCHESTRATION_WS_METHODS.listOrchestratorWakes }
              >,
            ) as OrchestrationListOrchestratorWakesInput,
          ),
      },
    ],
    [
      WS_METHODS.serverListVortexApps,
      {
        handle: () => vortexApps.listApps,
      },
    ],
    [
      WS_METHODS.serverListVortexAppArtifacts,
      {
        handle: (request) =>
          vortexApps.listAppArtifacts(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverListVortexAppArtifacts }
              >,
            ) as ServerListVortexAppArtifactsInput,
          ),
      },
    ],
    [
      WS_METHODS.serverGetAgentsVxappSidebarGraph,
      {
        handle: (request) =>
          agentsVxappSidebar.getGraph(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverGetAgentsVxappSidebarGraph }
              >,
            ) as ServerGetAgentsVxappSidebarGraphInput,
          ),
      },
    ],
    [
      WS_METHODS.serverGetAgentsVxappSidebarAuthoritySnapshot,
      {
        handle: (request) =>
          agentsVxappSidebar.getAuthoritySnapshot(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverGetAgentsVxappSidebarAuthoritySnapshot }
              >,
            ) as ServerGetAgentsVxappSidebarAuthoritySnapshotInput,
          ),
      },
    ],
    [
      WS_METHODS.serverGetAgentsVxappControlPlaneSnapshot,
      {
        handle: (request) =>
          agentsVxappControlPlane.getProgramsTodosSnapshot(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverGetAgentsVxappControlPlaneSnapshot }
              >,
            ) as ServerGetAgentsVxappControlPlaneSnapshotInput,
          ),
      },
    ],
    [
      WS_METHODS.serverCreateAgentsVxappProgram,
      {
        handle: (request) =>
          agentsVxappControlPlane.createProgram(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverCreateAgentsVxappProgram }
              >,
            ) as ServerCreateAgentsVxappProgramInput,
          ),
      },
    ],
    [
      WS_METHODS.serverUpdateAgentsVxappProgram,
      {
        handle: (request) =>
          agentsVxappControlPlane.updateProgram(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverUpdateAgentsVxappProgram }
              >,
            ) as ServerUpdateAgentsVxappProgramInput,
          ),
      },
    ],
    [
      WS_METHODS.serverDeleteAgentsVxappProgram,
      {
        handle: (request) =>
          agentsVxappControlPlane.deleteProgram(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverDeleteAgentsVxappProgram }
              >,
            ) as ServerDeleteAgentsVxappProgramInput,
          ),
      },
    ],
    [
      WS_METHODS.serverSetAgentsVxappProgramLifecycle,
      {
        handle: (request) =>
          agentsVxappControlPlane.setProgramLifecycle(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverSetAgentsVxappProgramLifecycle }
              >,
            ) as ServerSetAgentsVxappProgramLifecycleInput,
          ),
      },
    ],
    [
      WS_METHODS.serverCreateAgentsVxappTodo,
      {
        handle: (request) =>
          agentsVxappControlPlane.createTodo(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverCreateAgentsVxappTodo }
              >,
            ) as ServerCreateAgentsVxappTodoInput,
          ),
      },
    ],
    [
      WS_METHODS.serverUpdateAgentsVxappTodo,
      {
        handle: (request) =>
          agentsVxappControlPlane.updateTodo(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverUpdateAgentsVxappTodo }
              >,
            ) as ServerUpdateAgentsVxappTodoInput,
          ),
      },
    ],
    [
      WS_METHODS.serverDeleteAgentsVxappTodo,
      {
        handle: (request) =>
          agentsVxappControlPlane.deleteTodo(
            stripRequestTag(
              request.body as Extract<
                WebSocketRequest["body"],
                { _tag: typeof WS_METHODS.serverDeleteAgentsVxappTodo }
              >,
            ) as ServerDeleteAgentsVxappTodoInput,
          ),
      },
    ],
  ]);
});
