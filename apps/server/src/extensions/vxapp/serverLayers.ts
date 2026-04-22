import { Layer } from "effect";

import { OrchestratorWakeReactorLive } from "../../orchestration/Layers/OrchestratorWakeReactor";
import { ProjectHooksLive } from "../../projectHooks/Layers/ProjectHooks.ts";
import { VortexAppsLive } from "../../vortexApps/Layers/VortexApps.ts";

export const makeVxappRuntimeServicesLayer = <A, E, R>(
  runtimeServicesBaseLayer: Layer.Layer<A, E, R>,
) =>
  Layer.mergeAll(
    ProjectHooksLive.pipe(Layer.provideMerge(runtimeServicesBaseLayer)),
    VortexAppsLive,
  );

export const makeVxappOrchestratorWakeReactorLayer = <A, E, R>(
  runtimeServicesLayer: Layer.Layer<A, E, R>,
) => OrchestratorWakeReactorLive.pipe(Layer.provideMerge(runtimeServicesLayer));
