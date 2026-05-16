import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThreadActivity,
  type ProviderRespondToRequestInput,
  type ProviderRespondToUserInputInput,
  type ServerSettings,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { TextGeneration, type TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderCommandReactorLive } from "./ProviderCommandReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as agentsVxappOwnerClient from "../../extensions/vxapp/agentsVxappOwnerClient.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

function makeTestServerSettingsLayer(overrides: Partial<ServerSettings> = {}) {
  return ServerSettingsService.layerTest(overrides);
}

function unsupportedEffect(label: string) {
  return Effect.die(new Error(`Unsupported call in ProviderCommandReactor test: ${label}`));
}

function settleHotStream() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createGitCoreStub(): GitCoreShape {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => unsupportedEffect(`GitCore.${String(property)}`),
    },
  ) as GitCoreShape;
}

function createTextGenerationStub(): TextGenerationShape {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => unsupportedEffect(`TextGeneration.${String(property)}`),
    },
  ) as TextGenerationShape;
}

function findFailureActivities(input: {
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  kind: "provider.approval.respond.failed" | "provider.user-input.respond.failed";
  requestId: string;
}) {
  return input.activities.filter(
    (activity) =>
      activity.kind === input.kind &&
      activity.payload !== null &&
      typeof activity.payload === "object" &&
      (activity.payload as { requestId?: string }).requestId === input.requestId,
  );
}

describe("ProviderCommandReactor authority boundary", () => {
  const tempDirs: string[] = [];
  const runtimes: Array<ManagedRuntime.ManagedRuntime<ProviderCommandReactor, unknown>> = [];
  const scopes: Scope.Closeable[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (scopes.length > 0) {
      const scope = scopes.pop();
      if (scope) {
        await Effect.runPromise(Scope.close(scope, Exit.void));
      }
    }
    while (runtimes.length > 0) {
      const runtime = runtimes.pop();
      if (runtime) {
        await runtime.dispose();
      }
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createHarness() {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3-provider-reactor-"));
    tempDirs.push(stateRoot);

    const respondToRequest = vi.fn(
      (_input: ProviderRespondToRequestInput) => Effect.void,
    ) satisfies ProviderServiceShape["respondToRequest"];
    const respondToUserInput = vi.fn(
      (_input: ProviderRespondToUserInputInput) => Effect.void,
    ) satisfies ProviderServiceShape["respondToUserInput"];

    const providerService: ProviderServiceShape = {
      startSession: () => unsupportedEffect("ProviderService.startSession"),
      sendTurn: () => unsupportedEffect("ProviderService.sendTurn"),
      interruptTurn: () => unsupportedEffect("ProviderService.interruptTurn"),
      respondToRequest,
      respondToUserInput,
      stopSession: () => unsupportedEffect("ProviderService.stopSession"),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
      rollbackConversation: () => unsupportedEffect("ProviderService.rollbackConversation"),
      streamEvents: Stream.empty,
    };

    const threadId = asThreadId("thread-1");
    const project = {
      id: asProjectId("project-1"),
      title: "Provider Project",
      workspaceRoot: stateRoot,
      defaultModelSelection: {
        provider: "codex" as const,
        model: "gpt-5-codex",
      },
      scripts: [],
      hooks: [],
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      deletedAt: null,
    };
    const threadState = {
      id: threadId,
      projectId: asProjectId("project-1"),
      title: "Thread",
      labels: [],
      modelSelection: {
        provider: "codex" as const,
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required" as const,
      branch: null,
      worktreePath: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: {
        threadId,
        status: "ready" as const,
        providerName: "codex" as const,
        runtimeMode: "approval-required" as const,
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
      hasActiveError: false,
      activeError: null,
      historicalError: null,
      errorPresentationSource: "none" as const,
      activities: [] as OrchestrationThreadActivity[],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    };
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    let snapshotSequence = 0;
    let readModelUpdatedAt = "2026-05-16T00:00:00.000Z";

    const buildReadModel = (): OrchestrationReadModel => ({
      snapshotSequence,
      updatedAt: readModelUpdatedAt,
      projects: [{ ...project }],
      orchestratorWakeItems: [],
      threads: [{ ...threadState, activities: [...threadState.activities] }],
    });

    const orchestrationEngine: OrchestrationEngineShape = {
      getReadModel: () => Effect.succeed(buildReadModel()),
      readEvents: () => Stream.empty,
      dispatch: (command: OrchestrationCommand) => {
        if (command.type !== "thread.activity.append") {
          return unsupportedEffect(`OrchestrationEngine.dispatch(${command.type})`);
        }
        if (threadState.id !== command.threadId) {
          return Effect.die(new Error(`Thread '${command.threadId}' not found in read model`));
        }
        threadState.activities = [...threadState.activities, command.activity];
        threadState.updatedAt = command.createdAt;
        readModelUpdatedAt = command.createdAt;
        snapshotSequence += 1;
        return Effect.succeed({ sequence: snapshotSequence });
      },
      dryRunDispatch: () => unsupportedEffect("OrchestrationEngine.dryRunDispatch"),
      streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
    };

    const runtime = ManagedRuntime.make(
      ProviderCommandReactorLive.pipe(
        Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestrationEngine)),
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
        Layer.provideMerge(Layer.succeed(GitCore, createGitCoreStub())),
        Layer.provideMerge(Layer.succeed(TextGeneration, createTextGenerationStub())),
        Layer.provideMerge(makeTestServerSettingsLayer()),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), stateRoot)),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    runtimes.push(runtime);

    const reactor = await runtime.runPromise(Effect.service(ProviderCommandReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    scopes.push(scope);
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
    await settleHotStream();

    const readThread = async () => {
      const readModel = await runtime.runPromise(orchestrationEngine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
      if (!thread) {
        throw new Error("Thread thread-1 not found");
      }
      return thread;
    };

    return {
      publishEvent: (event: OrchestrationEvent) =>
        Effect.runPromise(PubSub.publish(domainEventPubSub, event)),
      reactor,
      readThread,
      respondToRequest,
      respondToUserInput,
    };
  }

  it("blocks provider approval responses when the owner helper fails and appends failure activity", async () => {
    const harness = await createHarness();
    vi.spyOn(agentsVxappOwnerClient, "requestAgentsVxappApprovalResponse").mockRejectedValueOnce(
      new Error("owner approval response failed"),
    );

    await harness.publishEvent({
      type: "thread.approval-response-requested",
      eventId: EventId.makeUnsafe("evt-approval-respond-failed"),
      sequence: 1,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:01.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        requestId: "req-approval-failed",
        decision: "accept",
        createdAt: "2026-05-16T00:00:01.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-approval-respond-failed"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.respondToRequest).not.toHaveBeenCalled();

    const thread = await harness.readThread();
    expect(
      findFailureActivities({
        activities: thread.activities,
        kind: "provider.approval.respond.failed",
        requestId: "req-approval-failed",
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        payload: expect.objectContaining({
          requestId: "req-approval-failed",
          detail: "owner approval response failed",
        }),
      }),
    );
  });

  it("allows provider approval responses after owner acceptance without projected approval authority", async () => {
    const harness = await createHarness();
    vi.spyOn(agentsVxappOwnerClient, "requestAgentsVxappApprovalResponse").mockResolvedValueOnce(
      {},
    );

    await harness.publishEvent({
      type: "thread.approval-response-requested",
      eventId: EventId.makeUnsafe("evt-approval-respond-success"),
      sequence: 2,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:02.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        requestId: "req-approval-success",
        decision: "accept",
        createdAt: "2026-05-16T00:00:02.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-approval-respond-success"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.respondToRequest).toHaveBeenCalledTimes(1);
    expect(harness.respondToRequest).toHaveBeenCalledWith({
      threadId: asThreadId("thread-1"),
      requestId: "req-approval-success",
      decision: "accept",
    });

    const thread = await harness.readThread();
    expect(
      findFailureActivities({
        activities: thread.activities,
        kind: "provider.approval.respond.failed",
        requestId: "req-approval-success",
      }),
    ).toEqual([]);
  });

  it("blocks provider user-input responses when the owner helper fails and appends failure activity", async () => {
    const harness = await createHarness();
    vi.spyOn(agentsVxappOwnerClient, "requestAgentsVxappUserInputResponse").mockRejectedValueOnce(
      new Error("owner user input response failed"),
    );

    await harness.publishEvent({
      type: "thread.user-input-response-requested",
      eventId: EventId.makeUnsafe("evt-user-input-respond-failed"),
      sequence: 3,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:03.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        requestId: "req-user-input-failed",
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: "2026-05-16T00:00:03.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-user-input-respond-failed"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.respondToUserInput).not.toHaveBeenCalled();

    const thread = await harness.readThread();
    expect(
      findFailureActivities({
        activities: thread.activities,
        kind: "provider.user-input.respond.failed",
        requestId: "req-user-input-failed",
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        payload: expect.objectContaining({
          requestId: "req-user-input-failed",
          detail: "owner user input response failed",
        }),
      }),
    );
  });

  it("allows provider user-input responses after owner acceptance without projected input authority", async () => {
    const harness = await createHarness();
    vi.spyOn(agentsVxappOwnerClient, "requestAgentsVxappUserInputResponse").mockResolvedValueOnce(
      {},
    );

    await harness.publishEvent({
      type: "thread.user-input-response-requested",
      eventId: EventId.makeUnsafe("evt-user-input-respond-success"),
      sequence: 4,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:04.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        requestId: "req-user-input-success",
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: "2026-05-16T00:00:04.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-user-input-respond-success"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.respondToUserInput).toHaveBeenCalledTimes(1);
    expect(harness.respondToUserInput).toHaveBeenCalledWith({
      threadId: asThreadId("thread-1"),
      requestId: "req-user-input-success",
      answers: {
        sandbox_mode: "workspace-write",
      },
    });

    const thread = await harness.readThread();
    expect(
      findFailureActivities({
        activities: thread.activities,
        kind: "provider.user-input.respond.failed",
        requestId: "req-user-input-success",
      }),
    ).toEqual([]);
  });
});
