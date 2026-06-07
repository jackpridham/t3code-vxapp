import * as NodeServices from "@effect/platform-node/NodeServices";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "OrchestratorWakeReactor.ts");

function readSource(): string {
  return readFileSync(sourcePath, "utf8");
}

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
  getCapabilities: () =>
    Effect.succeed({
      sessionModelSwitch: "in-session",
      sessionRecovery: "resume-cursor",
    }),
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

  it("does not block startup on best-effort wake reconciliation", async () => {
    const blockingEngine: OrchestrationEngineShape = {
      ...engine,
      getReadModel: () => Effect.never,
    };

    const blockingLayer = OrchestratorWakeReactorLive.pipe(
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, blockingEngine)),
      Layer.provideMerge(Layer.succeed(ProviderService, provider)),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    );

    await expect(
      Promise.race([
        Effect.runPromise(
          Effect.gen(function* () {
            const reactor = yield* OrchestratorWakeReactor;
            yield* Effect.scoped(reactor.start());
          }).pipe(Effect.provide(blockingLayer)),
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("startup blocked")), 200)),
      ]),
    ).resolves.toBeUndefined();
  });

  it("preserves worker wake transport while avoiding local CTO escalation synthesis", () => {
    const source = readSource();

    expect(source).toContain("requestAgentsVxappWakeEnqueue");
    expect(source).toContain("requestAgentsVxappWakeDeliveryPlan");
    expect(source).toContain("requestAgentsVxappWakeDrainReady");
    expect(source).toContain("requestAgentsVxappWakeProviderRequest");
    expect(source).toContain("requestAgentsVxappWakeReconcileStartup");
    expect(source).not.toContain("readModel.orchestratorWakeItems");
    expect(source).not.toContain("buildOrchestratorWakePrompt");
    expect(source).not.toContain("requestAgentsVxappWakeMutation");
    expect(source).not.toContain("MAX_WAKE_BATCH_SIZE");
    expect(source).not.toContain("partitionPendingWakeItemsForDelivery");
    expect(source).not.toContain("notifyActiveOrchestratorOnRejectedWorkerWake");
    expect(source).not.toContain("diagnostic_worker_wake_rejected");
    expect(source).not.toContain("program-link-sync");
  });

  it("does not reconcile wake consumption for ordinary local turns", () => {
    const source = readSource();

    expect(source).toContain('thread?.spawnRole === "worker"');
    expect(source).toContain('consumeReason: "worker_superseded_by_new_turn"');
  });

  it("does not synthesize stale review wake identifiers owned by agents-vxapp", () => {
    const source = readSource();

    expect(source).not.toContain("review_refresh");
    expect(source).not.toContain("stale-review");
    expect(source).not.toContain("staleReview");
  });
});
