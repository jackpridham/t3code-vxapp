import type { ProviderRuntimeEvent, ThreadTurnStartCommand } from "@t3tools/contracts";
import { Effect, Layer, ServiceMap } from "effect";
import type { Effect as EffectType } from "effect";

export interface ProjectHooksShape {
  readonly prepareTurnStartCommand: (
    command: ThreadTurnStartCommand,
  ) => EffectType.Effect<ThreadTurnStartCommand, Error>;
  readonly handleTurnCompleted: (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) => EffectType.Effect<void>;
}

export class ProjectHooksService extends ServiceMap.Service<
  ProjectHooksService,
  ProjectHooksShape
>()("t3/projectHooks/Services/ProjectHooksService") {
  static readonly layerTest = Layer.succeed(ProjectHooksService, {
    prepareTurnStartCommand: (command) => Effect.succeed(command),
    handleTurnCompleted: () => Effect.void,
  } satisfies ProjectHooksShape);
}
