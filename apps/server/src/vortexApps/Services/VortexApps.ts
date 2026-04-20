import type {
  ServerListVortexAppArtifactsInput,
  ServerListVortexAppArtifactsResult,
  ServerListVortexAppsResult,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class VortexAppsError extends Schema.TaggedErrorClass<VortexAppsError>()("VortexAppsError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface VortexAppsShape {
  readonly listApps: Effect.Effect<ServerListVortexAppsResult, VortexAppsError>;
  readonly listAppArtifacts: (
    input: ServerListVortexAppArtifactsInput,
  ) => Effect.Effect<ServerListVortexAppArtifactsResult, VortexAppsError>;
}

export class VortexApps extends ServiceMap.Service<VortexApps, VortexAppsShape>()(
  "t3/vortexApps/Services/VortexApps",
) {}
