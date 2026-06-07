import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationMessage,
  ProjectId,
  type ProviderKind,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
  type ProviderSendTurnInput,
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
import { AgentsVxappExternalRoleAuthority } from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as providerHarnessBridge from "../../extensions/vxapp/providerHarnessBridge.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asMessageId = (value: string) => MessageId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string) => TurnId.makeUnsafe(value);

function makeTestServerSettingsLayer(overrides: Partial<ServerSettings> = {}) {
  return ServerSettingsService.layerTest(overrides);
}

function unsupportedEffect(label: string) {
  return Effect.die(new Error(`Unsupported call in ProviderCommandReactor test: ${label}`));
}

function settleHotStream() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeRuntimePaths() {
  return {
    runtimeRoot: "/tmp/.agents-vxapp-runtime",
    roleSessionsRoot: "/tmp/.agents-vxapp-runtime/role-sessions",
    roleStateRoot: "/tmp/.agents-vxapp-runtime/role-state",
    workspaceRuntimeMetadataDir: ".agents/runtime",
    env: {
      runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
      stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
    },
    roles: {
      cto: {
        role: "cto" as const,
        generatedWorkspaceRoot: "/tmp/.agents-vxapp-runtime/role-sessions/cto",
        stateRoot: "/tmp/.agents-vxapp-runtime/role-state/cto",
        sessionsRoot: "/tmp/.agents-vxapp-runtime/role-state/cto/sessions",
        reservationsRoot: "/tmp/.agents-vxapp-runtime/role-state/cto/reservations",
      },
      jasper: {
        role: "jasper" as const,
        generatedWorkspaceRoot: "/tmp/.agents-vxapp-runtime/role-sessions/jasper",
        stateRoot: "/tmp/.agents-vxapp-runtime/role-state/jasper",
        sessionsRoot: "/tmp/.agents-vxapp-runtime/role-state/jasper/sessions",
        reservationsRoot: "/tmp/.agents-vxapp-runtime/role-state/jasper/reservations",
      },
    },
  };
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
  const vxappRoleSessionWorktreePath =
    "/tmp/.agents-vxapp-runtime/role-sessions/jasper/thread-1/workspace";
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

  async function createHarness(options?: {
    worktreePath?: string | null;
    ownerAuthorityWorktreePaths?: ReadonlyArray<string>;
    threadModelSelection?: ModelSelection;
    threadMessages?: ReadonlyArray<OrchestrationMessage>;
    initialHasActiveError?: boolean;
    initialActiveError?: string | null;
    initialHistoricalError?: string | null;
    initialErrorPresentationSource?: "none" | "owner" | "session";
    trackActiveSessions?: boolean;
  }) {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3-provider-reactor-"));
    tempDirs.push(stateRoot);
    const threadModelSelection: ModelSelection = options?.threadModelSelection ?? {
      provider: "codex",
      model: "gpt-5-codex",
    };
    const threadProvider: ProviderKind = threadModelSelection.provider;

    let activeSessions: Array<{
      threadId: ThreadId;
      provider: ProviderKind;
      status: "ready";
      runtimeMode: "full-access" | "approval-required";
      createdAt: string;
      updatedAt: string;
      cwd?: string;
      model?: string;
      resumeCursor?: {
        threadId: string;
        resume?: string;
        resumeSessionAt?: string;
      } | null;
    }> = [];
    const respondToRequest = vi.fn(
      (_input: ProviderRespondToRequestInput) => Effect.void,
    ) satisfies ProviderServiceShape["respondToRequest"];
    const respondToUserInput = vi.fn(
      (_input: ProviderRespondToUserInputInput) => Effect.void,
    ) satisfies ProviderServiceShape["respondToUserInput"];
    const startSession = vi.fn((threadId: ThreadId, input) => {
      const provider = input.provider ?? input.modelSelection?.provider ?? threadProvider;
      const session = {
        threadId,
        provider,
        status: "ready" as const,
        runtimeMode: input.runtimeMode,
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
      };
      activeSessions = [session];
      return Effect.succeed(session);
    }) satisfies ProviderServiceShape["startSession"];
    const sendTurn = vi.fn((_input: ProviderSendTurnInput) =>
      Effect.succeed({
        threadId,
        turnId: "turn-owner-request" as never,
      }),
    ) satisfies ProviderServiceShape["sendTurn"];

    const providerService: ProviderServiceShape = {
      startSession,
      sendTurn,
      interruptTurn: () => unsupportedEffect("ProviderService.interruptTurn"),
      respondToRequest,
      respondToUserInput,
      stopSession: () => unsupportedEffect("ProviderService.stopSession"),
      listSessions: () => Effect.succeed(activeSessions),
      getCapabilities: () =>
        Effect.succeed({
          sessionModelSwitch: "in-session",
          sessionRecovery: "resume-cursor",
        }),
      rollbackConversation: () => unsupportedEffect("ProviderService.rollbackConversation"),
      streamEvents: Stream.empty,
    };

    const threadId = asThreadId("thread-1");
    const project = {
      id: asProjectId("project-1"),
      title: "Provider Project",
      workspaceRoot: stateRoot,
      defaultModelSelection: threadModelSelection,
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
      modelSelection: threadModelSelection,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required" as const,
      branch: null,
      worktreePath: options?.worktreePath ?? null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      archivedAt: null,
      latestTurn: null,
      messages: [...(options?.threadMessages ?? [])],
      session: {
        threadId,
        status: "ready" as const,
        providerName: threadProvider,
        runtimeMode: "approval-required" as const,
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-05-16T00:00:00.000Z",
      } as OrchestrationSession,
      hasActiveError: options?.initialHasActiveError ?? false,
      activeError: options?.initialActiveError ?? null,
      historicalError: options?.initialHistoricalError ?? null,
      errorPresentationSource: options?.initialErrorPresentationSource ?? ("none" as const),
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
        if (command.type === "thread.session.set") {
          if (threadState.id !== command.threadId) {
            return Effect.die(new Error(`Thread '${command.threadId}' not found in read model`));
          }
          threadState.session = command.session;
          threadState.hasActiveError = command.hasActiveError ?? false;
          threadState.activeError = command.activeError ?? null;
          threadState.historicalError = command.historicalError ?? null;
          threadState.errorPresentationSource =
            command.errorPresentationSource === "owner" ||
            command.errorPresentationSource === "session"
              ? command.errorPresentationSource
              : "none";
          threadState.updatedAt = command.createdAt;
          readModelUpdatedAt = command.createdAt;
          snapshotSequence += 1;
          return Effect.succeed({ sequence: snapshotSequence });
        }
        if (command.type === "thread.activity.append") {
          if (threadState.id !== command.threadId) {
            return Effect.die(new Error(`Thread '${command.threadId}' not found in read model`));
          }
          threadState.activities = [...threadState.activities, command.activity];
          threadState.updatedAt = command.createdAt;
          readModelUpdatedAt = command.createdAt;
          snapshotSequence += 1;
          return Effect.succeed({ sequence: snapshotSequence });
        }
        return unsupportedEffect(`OrchestrationEngine.dispatch(${command.type})`);
      },
      dryRunDispatch: () => unsupportedEffect("OrchestrationEngine.dryRunDispatch"),
      streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
    };

    const authorityLayer =
      options?.ownerAuthorityWorktreePaths !== undefined || options?.worktreePath !== undefined
        ? Layer.succeed(AgentsVxappExternalRoleAuthority, {
            getSnapshot: () =>
              Effect.succeed({
                projects: [],
                threadSummaries: (options?.ownerAuthorityWorktreePaths ?? []).map(
                  (worktreePath) => ({
                    id: asThreadId(`authority:${worktreePath}`),
                    projectId: asProjectId("project-1"),
                    title: "Authority Thread",
                    labels: [],
                    modelSelection: threadModelSelection,
                    runtimeMode: "approval-required" as const,
                    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                    branch: "t3code/authority-thread",
                    worktreePath,
                    latestTurn: null,
                    createdAt: "2026-05-16T00:00:00.000Z",
                    updatedAt: "2026-05-16T00:00:00.000Z",
                    archivedAt: null,
                    deletedAt: null,
                    session: null,
                    hasActiveError: false,
                    activeError: null,
                    historicalError: null,
                    errorPresentationSource: "none" as const,
                  }),
                ),
              }),
            getRuntimePaths: () => Effect.succeed(makeRuntimePaths()),
          })
        : Layer.empty;

    const runtime = ManagedRuntime.make(
      ProviderCommandReactorLive.pipe(
        Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestrationEngine)),
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
        Layer.provideMerge(Layer.succeed(GitCore, createGitCoreStub())),
        Layer.provideMerge(Layer.succeed(TextGeneration, createTextGenerationStub())),
        Layer.provideMerge(makeTestServerSettingsLayer()),
        Layer.provideMerge(authorityLayer),
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
      setActiveSessionResumeCursor: (
        resumeCursor: {
          threadId: string;
          resume?: string;
          resumeSessionAt?: string;
        } | null,
      ) => {
        for (const session of activeSessions) {
          session.resumeCursor = resumeCursor;
        }
      },
      settleThreadSession: () => {
        if (threadState.session !== null) {
          threadState.session = {
            ...threadState.session,
            status: "ready",
            activeTurnId: null,
            updatedAt: "2026-05-16T00:00:10.500Z",
          };
        }
      },
      respondToRequest,
      respondToUserInput,
      sendTurn,
      startSession,
    };
  }

  it("executes owner-issued thread.turn.start provider requests without local prompt synthesis", async () => {
    const harness = await createHarness();

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-owner-provider-ready"),
      sequence: 7,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:07.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: "owner-message-not-used",
        providerRequestStatus: "ready",
        providerRequest: {
          kind: "thread.turn.start",
          requestId: "owner-request-1",
          threadId: "thread-1",
          message: "owner provided message",
          runtimeMode: "full-access",
          interactionMode: "plan",
        },
        createdAt: "2026-05-16T00:00:07.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-owner-provider-ready"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledWith({
      threadId: asThreadId("thread-1"),
      input: "owner provided message",
      interactionMode: "plan",
    });

    const thread = await harness.readThread();
    expect(thread.activities).toEqual([]);
    expect(thread.session?.runtimeMode).toBe("full-access");
  });

  it("forwards authoritative conversation history for ollama turns without replaying transient rows", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        provider: "ollamaLocal",
        model: "qwen3:8b",
      },
      threadMessages: [
        {
          id: asMessageId("system-1"),
          role: "system",
          text: "  You are a coding assistant.  ",
          turnId: null,
          streaming: false,
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
        {
          id: asMessageId("user-1"),
          role: "user",
          text: "Explain this function.",
          turnId: asTurnId("turn-1"),
          streaming: false,
          createdAt: "2026-05-16T00:00:01.000Z",
          updatedAt: "2026-05-16T00:00:01.000Z",
        },
        {
          id: asMessageId("assistant-stream"),
          role: "assistant",
          text: "partial delta",
          turnId: asTurnId("turn-1"),
          streaming: true,
          createdAt: "2026-05-16T00:00:02.000Z",
          updatedAt: "2026-05-16T00:00:02.000Z",
        },
        {
          id: asMessageId("assistant-1"),
          role: "assistant",
          text: " It parses the input. ",
          turnId: asTurnId("turn-1"),
          streaming: false,
          createdAt: "2026-05-16T00:00:03.000Z",
          updatedAt: "2026-05-16T00:00:03.000Z",
        },
        {
          id: asMessageId("assistant-empty"),
          role: "assistant",
          text: "   ",
          turnId: asTurnId("turn-1"),
          streaming: false,
          createdAt: "2026-05-16T00:00:04.000Z",
          updatedAt: "2026-05-16T00:00:04.000Z",
        },
        {
          id: asMessageId("user-2"),
          role: "user",
          text: "Reply with pong",
          turnId: asTurnId("turn-2"),
          streaming: false,
          createdAt: "2026-05-16T00:00:05.000Z",
          updatedAt: "2026-05-16T00:00:05.000Z",
        },
      ],
    });

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-ollama-history"),
      sequence: 8,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:06.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: asMessageId("user-2"),
        createdAt: "2026-05-16T00:00:06.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-ollama-history"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledWith({
      threadId: asThreadId("thread-1"),
      input: "Reply with pong",
      conversationHistory: [
        { role: "system", content: "You are a coding assistant." },
        { role: "user", content: "Explain this function." },
        { role: "assistant", content: "It parses the input." },
      ],
    });
  });

  it("excludes the triggering user message for owner-mediated ollama turns", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        provider: "ollamaLocal",
        model: "qwen3:8b",
      },
      threadMessages: [
        {
          id: asMessageId("user-1"),
          role: "user",
          text: "Previous prompt",
          turnId: asTurnId("turn-1"),
          streaming: false,
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
        {
          id: asMessageId("assistant-1"),
          role: "assistant",
          text: "Previous answer",
          turnId: asTurnId("turn-1"),
          streaming: false,
          createdAt: "2026-05-16T00:00:01.000Z",
          updatedAt: "2026-05-16T00:00:01.000Z",
        },
        {
          id: asMessageId("user-2"),
          role: "user",
          text: "Owner provided message",
          turnId: asTurnId("turn-2"),
          streaming: false,
          createdAt: "2026-05-16T00:00:02.000Z",
          updatedAt: "2026-05-16T00:00:02.000Z",
        },
      ],
    });

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-owner-ollama-history"),
      sequence: 9,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:09.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: asMessageId("user-2"),
        providerRequestStatus: "ready",
        providerRequest: {
          kind: "thread.turn.start",
          requestId: "owner-request-ollama-history",
          threadId: "thread-1",
          message: "Owner provided message",
          runtimeMode: "full-access",
        },
        createdAt: "2026-05-16T00:00:09.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-owner-ollama-history"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.sendTurn).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn).toHaveBeenCalledWith({
      threadId: asThreadId("thread-1"),
      input: "Owner provided message",
      conversationHistory: [
        { role: "user", content: "Previous prompt" },
        { role: "assistant", content: "Previous answer" },
      ],
    });
  });

  it("restarts the provider session when ancestor instructions change under the same workspace", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3-provider-reactor-runtime-"));
    tempDirs.push(runtimeRoot);
    const worktreePath = path.join(runtimeRoot, "role-sessions", "cto", "session-1", "workspace");
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "AGENTS.md"), "blocked by e2e safety\n");

    const harness = await createHarness({
      worktreePath,
      trackActiveSessions: true,
    });

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-owner-provider-first"),
      sequence: 10,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:10.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: "owner-message-1",
        providerRequestStatus: "ready",
        providerRequest: {
          kind: "thread.turn.start",
          requestId: "owner-request-1",
          threadId: "thread-1",
          message: "first message",
          runtimeMode: "full-access",
        },
        createdAt: "2026-05-16T00:00:10.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-owner-provider-first"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    harness.settleThreadSession();
    harness.setActiveSessionResumeCursor({
      threadId: "poisoned-resume-thread",
      resume: "poisoned-resume-session",
      resumeSessionAt: "assistant-99",
    });

    fs.writeFileSync(path.join(runtimeRoot, "AGENTS.md"), "guard removed\n");

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-owner-provider-second"),
      sequence: 11,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:11.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: "owner-message-2",
        providerRequestStatus: "ready",
        providerRequest: {
          kind: "thread.turn.start",
          requestId: "owner-request-2",
          threadId: "thread-1",
          message: "second message",
          runtimeMode: "full-access",
        },
        createdAt: "2026-05-16T00:00:11.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-owner-provider-second"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.startSession).toHaveBeenCalledTimes(2);
    const restartedStartInput = harness.startSession.mock.calls[1]?.[1];
    expect(restartedStartInput).toEqual(
      expect.objectContaining({
        threadId: asThreadId("thread-1"),
        cwd: worktreePath,
        runtimeMode: "full-access",
      }),
    );
    expect(restartedStartInput).not.toHaveProperty("resumeCursor");
  });

  it("fails closed when owner marks provider request ready without a thread.turn.start request", async () => {
    const harness = await createHarness();

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-owner-provider-malformed"),
      sequence: 8,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:08.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: "owner-message-not-used",
        providerRequestStatus: "ready",
        ownerRequestId: "owner-request-malformed",
        ownerDiagnostics: { reason: "missing_provider_request" },
        legacyFallbackUsed: false,
        createdAt: "2026-05-16T00:00:08.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-owner-provider-malformed"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.sendTurn).not.toHaveBeenCalled();
    const thread = await harness.readThread();
    expect(thread.activities).toContainEqual(
      expect.objectContaining({
        kind: "provider.turn.start.failed",
        summary: "Owner provider request failed closed",
        payload: expect.objectContaining({
          ownerRequestId: "owner-request-malformed",
          transportStatus: "rejected",
          providerThreadId: "thread-1",
          providerTurnId: null,
          error: expect.stringContaining("Owner providerRequestStatus was ready"),
          ownerDiagnostics: { reason: "missing_provider_request" },
          legacyFallbackUsed: false,
        }),
      }),
    );
  });

  it("surfaces blocked owner provider request diagnostics without executing provider turns", async () => {
    const harness = await createHarness();

    await harness.publishEvent({
      type: "thread.turn-start-requested",
      eventId: EventId.makeUnsafe("evt-owner-provider-blocked"),
      sequence: 9,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:09.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        messageId: "owner-message-not-used",
        providerRequestStatus: "blocked",
        ownerRequestId: "owner-request-blocked",
        failureCode: "busy_thread",
        failureMessage: "Thread is busy.",
        ownerDiagnostics: { queue: "busy" },
        legacyFallbackUsed: false,
        createdAt: "2026-05-16T00:00:09.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-owner-provider-blocked"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.sendTurn).not.toHaveBeenCalled();
    const thread = await harness.readThread();
    expect(thread.activities).toContainEqual(
      expect.objectContaining({
        kind: "provider.turn.start.failed",
        summary: "Owner provider request blocked",
        payload: expect.objectContaining({
          detail: "busy_thread: Thread is busy.",
          ownerRequestId: "owner-request-blocked",
          transportStatus: "rejected",
          providerThreadId: "thread-1",
          providerTurnId: null,
          error: "busy_thread: Thread is busy.",
          ownerDiagnostics: { queue: "busy" },
          legacyFallbackUsed: false,
        }),
      }),
    );
  });

  it("blocks provider approval responses when the owner helper fails and appends failure activity", async () => {
    const harness = await createHarness({
      worktreePath: vxappRoleSessionWorktreePath,
    });
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappApprovalResponse").mockRejectedValueOnce(
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
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappApprovalResponse").mockResolvedValueOnce({});

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

  it("preserves owner error presentation for role-session vxapp worktrees", async () => {
    const harness = await createHarness({
      worktreePath: vxappRoleSessionWorktreePath,
      initialHasActiveError: true,
      initialActiveError: "owner preserved",
      initialHistoricalError: "owner history",
      initialErrorPresentationSource: "owner",
    });

    await harness.publishEvent({
      type: "thread.archived",
      eventId: EventId.makeUnsafe("evt-archived-vxapp-role-session"),
      sequence: 5,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:05.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        archivedAt: "2026-05-16T00:00:05.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-archived-vxapp-role-session"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    const thread = await harness.readThread();
    expect(thread.hasActiveError).toBe(true);
    expect(thread.activeError).toBe("owner preserved");
    expect(thread.historicalError).toBe("owner history");
    expect(thread.errorPresentationSource).toBe("owner");
  });

  it("preserves owner error presentation for owner-authoritative vxapp worktrees outside role-session roots", async () => {
    const worktreePath = "/tmp/custom-vxapp/thread-1/worktree";
    const harness = await createHarness({
      worktreePath,
      ownerAuthorityWorktreePaths: [worktreePath],
      initialHasActiveError: true,
      initialActiveError: "owner preserved",
      initialHistoricalError: "owner history",
      initialErrorPresentationSource: "owner",
    });

    await harness.publishEvent({
      type: "thread.archived",
      eventId: EventId.makeUnsafe("evt-archived-vxapp-owner-truth"),
      sequence: 6,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      occurredAt: "2026-05-16T00:00:06.000Z",
      payload: {
        threadId: asThreadId("thread-1"),
        archivedAt: "2026-05-16T00:00:06.000Z",
      },
      commandId: CommandId.makeUnsafe("cmd-archived-vxapp-owner-truth"),
    } as unknown as OrchestrationEvent);
    await settleHotStream();
    await Effect.runPromise(harness.reactor.drain);

    const thread = await harness.readThread();
    expect(thread.hasActiveError).toBe(true);
    expect(thread.activeError).toBe("owner preserved");
    expect(thread.historicalError).toBe("owner history");
    expect(thread.errorPresentationSource).toBe("owner");
  });

  it("blocks provider user-input responses when the owner helper fails and appends failure activity", async () => {
    const harness = await createHarness({
      worktreePath: vxappRoleSessionWorktreePath,
    });
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappUserInputResponse").mockRejectedValueOnce(
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
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappUserInputResponse").mockResolvedValueOnce(
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

  it("keeps Phase 08 lifecycle ownership out of the provider reactor", () => {
    const source = fs.readFileSync(new URL("./ProviderCommandReactor.ts", import.meta.url), "utf8");

    expect(source).not.toContain("t3code-threads-create");
    expect(source).not.toContain("t3code-threads-start");
    expect(source).not.toContain("thread_create");
    expect(source).not.toContain("thread_lineage_update");
    expect(source).not.toContain("buildThreadLifecycleProviderRequest");
  });
});
