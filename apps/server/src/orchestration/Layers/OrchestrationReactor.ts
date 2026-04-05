import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { OrchestratorWakeReactor } from "../Services/OrchestratorWakeReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const orchestratorWakeReactor = yield* OrchestratorWakeReactor;

  const start: OrchestrationReactorShape["start"] = () =>
    Effect.gen(function* () {
      yield* providerRuntimeIngestion.start();
      yield* providerCommandReactor.start();
      yield* checkpointReactor.start();
      yield* orchestratorWakeReactor.start();
    });

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
