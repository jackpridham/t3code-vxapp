import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestratorWakeReactorLive } from "./OrchestratorWakeReactor.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { OrchestratorWakeReactor } from "../Services/OrchestratorWakeReactor.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createProviderServiceHarness() {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const runtimeSessions: ProviderSession[] = [];

  const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions: () => Effect.succeed([...runtimeSessions]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    rollbackConversation: () => unsupported(),
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  };

  const emit = (event: ProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event));
  };

  return {
    service,
    emit,
  };
}

async function waitForReadModel(
  engine: OrchestrationEngineShape,
  predicate: (readModel: OrchestrationReadModel) => boolean,
  timeoutMs = 5000,
): Promise<OrchestrationReadModel> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readModel = await Effect.runPromise(engine.getReadModel());
    if (predicate(readModel)) {
      return readModel;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for orchestration read model state.");
}

async function createHarness() {
  const workspaceRoot = makeTempDir("t3-orchestrator-wake-reactor-");
  fs.mkdirSync(path.join(workspaceRoot, ".git"));
  const provider = createProviderServiceHarness();
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
  );
  const layer = OrchestratorWakeReactorLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(NodeServices.layer),
  );

  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const reactor = await runtime.runPromise(Effect.service(OrchestratorWakeReactor));
  const scope = await Effect.runPromise(Scope.make("sequential"));
  await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

  const createdAt = new Date().toISOString();
  await Effect.runPromise(
    engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-project-worker"),
      projectId: asProjectId("project-worker"),
      title: "Worker Project",
      workspaceRoot,
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt,
    }),
  );
  await Effect.runPromise(
    engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-project-orch"),
      projectId: asProjectId("project-orch"),
      title: "Orchestrator Project",
      workspaceRoot,
      kind: "orchestrator",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt,
    }),
  );
  await Effect.runPromise(
    engine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe("cmd-thread-orch"),
      threadId: asThreadId("thread-orch"),
      projectId: asProjectId("project-orch"),
      title: "Orchestrator Thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    }),
  );

  return {
    runtime,
    engine,
    scope,
    emit: provider.emit,
    workspaceRoot,
  };
}

async function createWorkerThread(
  engine: OrchestrationEngineShape,
  input?: {
    readonly threadId?: ThreadId;
    readonly projectId?: ProjectId;
    readonly orchestratorProjectId?: ProjectId | undefined;
    readonly orchestratorThreadId?: ThreadId | undefined;
  },
) {
  const createdAt = new Date().toISOString();
  const threadId = input?.threadId ?? asThreadId("thread-worker");
  await Effect.runPromise(
    engine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-${threadId}`),
      threadId,
      projectId: input?.projectId ?? asProjectId("project-worker"),
      title: `Worker ${threadId}`,
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      spawnRole: "worker",
      ...(input?.orchestratorProjectId !== undefined
        ? { orchestratorProjectId: input.orchestratorProjectId }
        : { orchestratorProjectId: asProjectId("project-orch") }),
      ...(input?.orchestratorThreadId !== undefined
        ? { orchestratorThreadId: input.orchestratorThreadId }
        : { orchestratorThreadId: asThreadId("thread-orch") }),
      parentThreadId: asThreadId("thread-orch"),
      createdAt,
    }),
  );
  return threadId;
}

async function setThreadSession(
  engine: OrchestrationEngineShape,
  input: {
    readonly threadId: ThreadId;
    readonly status:
      | "idle"
      | "starting"
      | "running"
      | "ready"
      | "interrupted"
      | "stopped"
      | "error";
    readonly updatedAt: string;
    readonly activeTurnId?: TurnId | null;
  },
) {
  await Effect.runPromise(
    engine.dispatch({
      type: "thread.session.set",
      commandId: CommandId.makeUnsafe(`cmd-session-${input.threadId}-${input.updatedAt}`),
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: input.status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: input.activeTurnId ?? null,
        lastError: null,
        updatedAt: input.updatedAt,
      },
      createdAt: input.updatedAt,
    }),
  );
}

describe("OrchestratorWakeReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<any, any> | null = null;
  let scope: any;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = undefined;
    }
    if (runtime) {
      await runtime.dispose();
    }
  });

  it("creates a pending wake when a worker completes a turn", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "running",
      activeTurnId: asTurnId("turn-orch-active"),
      updatedAt: "2026-04-05T11:59:00.000Z",
    });
    await createWorkerThread(harness.engine);

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-complete-1"),
      provider: "codex",
      createdAt: "2026-04-05T12:00:00.000Z",
      threadId: asThreadId("thread-worker"),
      turnId: asTurnId("turn-1"),
      payload: {
        state: "completed",
      },
    });

    const readModel = await waitForReadModel(
      harness.engine,
      (model) => model.orchestratorWakeItems.length === 1,
    );
    expect(readModel.orchestratorWakeItems[0]).toMatchObject({
      wakeId: "wake:thread-worker:turn-1:completed",
      orchestratorThreadId: asThreadId("thread-orch"),
      workerThreadId: asThreadId("thread-worker"),
      state: "pending",
      outcome: "completed",
    });
  });

  it("uses provider failure detail when a worker turn fails", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "running",
      activeTurnId: asTurnId("turn-orch-active"),
      updatedAt: "2026-04-05T12:00:30.000Z",
    });
    await createWorkerThread(harness.engine);

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-failed-1"),
      provider: "codex",
      createdAt: "2026-04-05T12:01:00.000Z",
      threadId: asThreadId("thread-worker"),
      turnId: asTurnId("turn-2"),
      payload: {
        state: "failed",
        errorMessage: "Lint failed in Sidebar.logic.ts",
      },
    });

    const readModel = await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some((item) => item.workerTurnId === asTurnId("turn-2")),
    );
    expect(readModel.orchestratorWakeItems[0]?.summary).toBe("Lint failed in Sidebar.logic.ts");
  });

  it("appends a rejection activity when worker lineage is incomplete", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-worker-bad"),
        threadId: asThreadId("thread-worker-bad"),
        projectId: asProjectId("project-worker"),
        title: "Worker thread-worker-bad",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        spawnRole: "worker",
        createdAt: "2026-04-05T12:01:30.000Z",
      }),
    );

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-bad-lineage"),
      provider: "codex",
      createdAt: "2026-04-05T12:02:00.000Z",
      threadId: asThreadId("thread-worker-bad"),
      turnId: asTurnId("turn-3"),
      payload: {
        state: "completed",
      },
    });

    const readModel = await waitForReadModel(
      harness.engine,
      (model) =>
        model.threads
          .find((thread) => thread.id === asThreadId("thread-worker-bad"))
          ?.activities.some((activity) => activity.kind === "orchestrator.wake.rejected") ?? false,
    );
    const worker = readModel.threads.find(
      (thread) => thread.id === asThreadId("thread-worker-bad"),
    );
    expect(worker?.activities.at(-1)?.payload).toMatchObject({
      reason: "missing_orchestrator_lineage",
    });
    expect(readModel.orchestratorWakeItems).toHaveLength(0);
  });

  it("appends a rejection activity when the orchestrator project mismatches", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await createWorkerThread(harness.engine, {
      threadId: asThreadId("thread-worker-mismatch"),
      orchestratorProjectId: asProjectId("project-worker"),
      orchestratorThreadId: asThreadId("thread-orch"),
    });

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-mismatch"),
      provider: "codex",
      createdAt: "2026-04-05T12:03:00.000Z",
      threadId: asThreadId("thread-worker-mismatch"),
      turnId: asTurnId("turn-4"),
      payload: {
        state: "completed",
      },
    });

    const readModel = await waitForReadModel(
      harness.engine,
      (model) =>
        model.threads
          .find((thread) => thread.id === asThreadId("thread-worker-mismatch"))
          ?.activities.some((activity) => activity.kind === "orchestrator.wake.rejected") ?? false,
    );
    const worker = readModel.threads.find(
      (thread) => thread.id === asThreadId("thread-worker-mismatch"),
    );
    expect(worker?.activities.at(-1)?.payload).toMatchObject({
      reason: "orchestrator_mismatch",
    });
    expect(readModel.orchestratorWakeItems).toHaveLength(0);
  });

  it("consumes undelivered wake items when the worker starts another turn", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "running",
      activeTurnId: asTurnId("turn-orch-active"),
      updatedAt: "2026-04-05T12:03:30.000Z",
    });
    await createWorkerThread(harness.engine);

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-consume-complete"),
      provider: "codex",
      createdAt: "2026-04-05T12:04:00.000Z",
      threadId: asThreadId("thread-worker"),
      turnId: asTurnId("turn-5"),
      payload: {
        state: "completed",
      },
    });

    await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some((item) => item.workerTurnId === asTurnId("turn-5")),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-worker-restart"),
        threadId: asThreadId("thread-worker"),
        message: {
          messageId: MessageId.makeUnsafe("msg-worker-restart"),
          role: "user",
          text: "Continue with the next step",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: "2026-04-05T12:05:00.000Z",
      }),
    );

    const readModel = await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some(
        (item) =>
          item.workerTurnId === asTurnId("turn-5") &&
          item.state === "consumed" &&
          item.consumeReason === "worker_superseded_by_new_turn",
      ),
    );
    expect(readModel.orchestratorWakeItems[0]).toMatchObject({
      state: "consumed",
      consumeReason: "worker_superseded_by_new_turn",
    });
  });

  it("delivers queued wakes after the orchestrator becomes inactive", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "running",
      activeTurnId: asTurnId("turn-orch-active"),
      updatedAt: "2026-04-05T12:05:00.000Z",
    });
    await createWorkerThread(harness.engine);

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-drain-complete"),
      provider: "codex",
      createdAt: "2026-04-05T12:06:00.000Z",
      threadId: asThreadId("thread-worker"),
      turnId: asTurnId("turn-6"),
      payload: {
        state: "completed",
      },
    });

    await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some(
        (item) => item.workerTurnId === asTurnId("turn-6") && item.state === "pending",
      ),
    );

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "ready",
      activeTurnId: null,
      updatedAt: "2026-04-05T12:07:00.000Z",
    });

    const deliveringReadModel = await waitForReadModel(harness.engine, (model) => {
      const orchestratorThread = model.threads.find(
        (thread) => thread.id === asThreadId("thread-orch"),
      );
      return (
        model.orchestratorWakeItems.some(
          (item) => item.workerTurnId === asTurnId("turn-6") && item.state === "delivering",
        ) &&
        (orchestratorThread?.messages.some(
          (message) =>
            message.role === "user" &&
            message.text.includes("Worker updates are ready for review.") &&
            message.text.includes("Worker thread-worker completed its assigned turn"),
        ) ??
          false)
      );
    });
    const orchestratorThreadWhileDelivering = deliveringReadModel.threads.find(
      (thread) => thread.id === asThreadId("thread-orch"),
    );
    expect(
      orchestratorThreadWhileDelivering?.messages.some(
        (message) =>
          message.role === "user" &&
          message.text.includes("Worker updates are ready for review.") &&
          message.text.includes("Worker thread-worker completed its assigned turn"),
      ),
    ).toBe(true);

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "ready",
      activeTurnId: null,
      updatedAt: "2026-04-05T12:08:00.000Z",
    });

    const deliveredReadModel = await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some(
        (item) => item.workerTurnId === asTurnId("turn-6") && item.state === "delivered",
      ),
    );
    expect(deliveredReadModel.orchestratorWakeItems[0]).toMatchObject({
      workerTurnId: asTurnId("turn-6"),
      state: "delivered",
      deliveryMessageId: expect.any(String),
      deliveredAt: "2026-04-05T12:08:00.000Z",
    });
  });

  it("drains at most five wakes at a time and leaves overflow pending", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "running",
      activeTurnId: asTurnId("turn-orch-active"),
      updatedAt: "2026-04-05T12:09:00.000Z",
    });

    for (let index = 0; index < 6; index += 1) {
      await createWorkerThread(harness.engine, {
        threadId: asThreadId(`thread-worker-${index + 1}`),
      });
    }

    for (let index = 0; index < 6; index += 1) {
      harness.emit({
        type: "turn.completed",
        eventId: EventId.makeUnsafe(`evt-batch-${index + 1}`),
        provider: "codex",
        createdAt: `2026-04-05T12:10:0${index}.000Z`,
        threadId: asThreadId(`thread-worker-${index + 1}`),
        turnId: asTurnId(`turn-batch-${index + 1}`),
        payload: {
          state: "completed",
        },
      });
    }

    await waitForReadModel(harness.engine, (model) => model.orchestratorWakeItems.length === 6);

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "ready",
      activeTurnId: null,
      updatedAt: "2026-04-05T12:11:00.000Z",
    });

    const readModel = await waitForReadModel(harness.engine, (model) => {
      const orchestratorThread = model.threads.find(
        (thread) => thread.id === asThreadId("thread-orch"),
      );
      return (
        model.orchestratorWakeItems.filter((item) => item.state === "delivering").length === 5 &&
        (orchestratorThread?.messages.filter((message) => message.role === "user").length ?? 0) ===
          1
      );
    });

    expect(
      readModel.orchestratorWakeItems.filter((item) => item.state === "delivering"),
    ).toHaveLength(5);
    expect(readModel.orchestratorWakeItems.filter((item) => item.state === "pending")).toHaveLength(
      1,
    );

    const orchestratorThread = readModel.threads.find(
      (thread) => thread.id === asThreadId("thread-orch"),
    );
    expect(orchestratorThread?.messages.filter((message) => message.role === "user")).toHaveLength(
      1,
    );
  });

  it("drops pending wakes when the orchestrator thread is deleted", async () => {
    const harness = await createHarness();
    runtime = harness.runtime;
    scope = harness.scope;

    await setThreadSession(harness.engine, {
      threadId: asThreadId("thread-orch"),
      status: "running",
      activeTurnId: asTurnId("turn-orch-active"),
      updatedAt: "2026-04-05T12:12:00.000Z",
    });
    await createWorkerThread(harness.engine);

    harness.emit({
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-delete-drop"),
      provider: "codex",
      createdAt: "2026-04-05T12:13:00.000Z",
      threadId: asThreadId("thread-worker"),
      turnId: asTurnId("turn-7"),
      payload: {
        state: "completed",
      },
    });

    await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some(
        (item) => item.workerTurnId === asTurnId("turn-7") && item.state === "pending",
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-delete-orchestrator"),
        threadId: asThreadId("thread-orch"),
      }),
    );

    const readModel = await waitForReadModel(harness.engine, (model) =>
      model.orchestratorWakeItems.some(
        (item) =>
          item.workerTurnId === asTurnId("turn-7") &&
          item.state === "dropped" &&
          item.consumeReason === "orchestrator_deleted",
      ),
    );
    expect(readModel.orchestratorWakeItems[0]).toMatchObject({
      state: "dropped",
      consumeReason: "orchestrator_deleted",
    });
  });
});
