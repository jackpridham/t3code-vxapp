import {
  ORCHESTRATION_WS_METHODS,
  type OrchestrationListOrchestratorWakesInput,
  type ServerListVortexAppArtifactsInput,
  WS_METHODS,
  type WebSocketRequest,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { ProjectionOperationalQuery } from "../../orchestration/Services/ProjectionOperationalQuery";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { VortexApps, type VortexAppsError } from "../../vortexApps/Services/VortexApps.ts";

export type VxappWsRouteHandlerError = ProjectionRepositoryError | VortexAppsError;

export interface VxappWsRouteHandler {
  readonly handle: (request: WebSocketRequest) => Effect.Effect<unknown, VxappWsRouteHandlerError>;
}

export type VxappWsRouteHandlerMap = ReadonlyMap<string, VxappWsRouteHandler>;
export type VxappWsRouteHandlerServices = ProjectionOperationalQuery | VortexApps;

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
  ]);
});
