import * as NodeServices from "@effect/platform-node/NodeServices";
import type { OrchestrationCommand, OrchestrationEvent, ProviderSession } from "@t3tools/contracts";
import { createEmptyReadModel } from "@t3tools/orchestration-core/projector";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import { OrchestratorWakeReactor } from "../Services/OrchestratorWakeReactor.ts";
import { OrchestratorWakeReactorLive } from "./OrchestratorWakeReactor.ts";

const engine: OrchestrationEngineShape = {
  getReadModel: () => Effect.succeed(createEmptyReadModel("2026-05-16T00:00:00.000Z")),
  readEvents: () => Stream.empty,
  dispatch: (_command: OrchestrationCommand) => Effect.succeed({ sequence: 1 }),
  dryRunDispatch: (() => Effect.succeed({} as never)) as OrchestrationEngineShape["dryRunDispatch"],
  streamDomainEvents: Stream.empty as Stream.Stream<OrchestrationEvent>,
};

const provider: ProviderServiceShape = {
  startSession: () => Effect.die("unused"),
  sendTurn: () => Effect.die("unused"),
  interruptTurn: () => Effect.die("unused"),
  respondToRequest: () => Effect.die("unused"),
  respondToUserInput: () => Effect.die("unused"),
  stopSession: () => Effect.die("unused"),
  listSessions: () => Effect.succeed([] satisfies ProviderSession[]),
  getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
  rollbackConversation: () => Effect.die("unused"),
  streamEvents: Stream.empty,
};

const TestLayer = OrchestratorWakeReactorLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
  Layer.provideMerge(Layer.succeed(ProviderService, provider)),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(NodeServices.layer),
);

describe("OrchestratorWakeReactor authority boundary", () => {
  it("starts with only read-model and turn-state dependencies, not the live wake repository", async () => {
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const reactor = yield* OrchestratorWakeReactor;
          yield* Effect.scoped(reactor.start());
        }).pipe(Effect.provide(TestLayer)),
      ),
    ).resolves.toBeUndefined();
  });
});
