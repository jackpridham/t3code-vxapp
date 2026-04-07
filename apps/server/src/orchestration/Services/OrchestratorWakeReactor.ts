import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface OrchestratorWakeReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class OrchestratorWakeReactor extends ServiceMap.Service<
  OrchestratorWakeReactor,
  OrchestratorWakeReactorShape
>()("t3/orchestration/Services/OrchestratorWakeReactor/OrchestratorWakeReactor") {}
