import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  ProviderRuntimeEvent,
  ProviderSession,
} from "@t3tools/contracts";
import {
  ApprovalRequestId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderItemId,
  type ServerSettings,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionLive } from "./ProviderRuntimeIngestion.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProjectHooksService } from "../../extensions/vxapp/Services/ProjectHooksService.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryShape,
} from "../../provider/Services/ProviderSessionDirectory.ts";
import { AgentsVxappExternalRoleAuthority } from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import * as providerHarnessBridge from "../../extensions/vxapp/providerHarnessBridge.ts";

function makeTestServerSettingsLayer(overrides: Partial<ServerSettings> = {}) {
  return ServerSettingsService.layerTest(overrides);
}

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asItemId = (value: string): ProviderItemId => ProviderItemId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

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

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderRuntimeEvent["provider"];
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

type LegacyTurnCompletedEvent = LegacyProviderRuntimeEvent & {
  readonly type: "turn.completed";
  readonly payload?: undefined;
  readonly status: "completed" | "failed" | "interrupted" | "cancelled";
  readonly errorMessage?: string | undefined;
};

function isLegacyTurnCompletedEvent(
  event: LegacyProviderRuntimeEvent,
): event is LegacyTurnCompletedEvent {
  return (
    event.type === "turn.completed" &&
    event.payload === undefined &&
    typeof event.status === "string"
  );
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
    getCapabilities: () =>
      Effect.succeed({
        sessionModelSwitch: "in-session",
        sessionRecovery: "resume-cursor",
      }),
    rollbackConversation: () => unsupported(),
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  };

  const setSession = (session: ProviderSession): void => {
    const existingIndex = runtimeSessions.findIndex((entry) => entry.threadId === session.threadId);
    if (existingIndex >= 0) {
      runtimeSessions[existingIndex] = session;
      return;
    }
    runtimeSessions.push(session);
  };

  const normalizeLegacyEvent = (event: LegacyProviderRuntimeEvent): ProviderRuntimeEvent => {
    if (isLegacyTurnCompletedEvent(event)) {
      const normalized: Extract<ProviderRuntimeEvent, { type: "turn.completed" }> = {
        ...(event as Omit<Extract<ProviderRuntimeEvent, { type: "turn.completed" }>, "payload">),
        payload: {
          state: event.status,
          ...(typeof event.errorMessage === "string" ? { errorMessage: event.errorMessage } : {}),
        },
      };
      return normalized;
    }

    return event as ProviderRuntimeEvent;
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, normalizeLegacyEvent(event)));
  };

  return {
    service,
    emit,
    setSession,
  };
}

function isMockFunction(value: unknown): boolean {
  return typeof value === "function" && value !== null && "mock" in value;
}

function ensureDefaultOwnerHelperSpies(): void {
  if (!isMockFunction(providerHarnessBridge.requestAgentsVxappApprovalRequest)) {
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappApprovalRequest").mockResolvedValue({});
  }
  if (!isMockFunction(providerHarnessBridge.requestAgentsVxappThreadEventIngest)) {
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappThreadEventIngest").mockResolvedValue({});
  }
  if (!isMockFunction(providerHarnessBridge.requestAgentsVxappThreadStatus)) {
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappThreadStatus").mockResolvedValue({});
  }
}

async function waitForThread(
  engine: OrchestrationEngineShape,
  predicate: (thread: ProviderRuntimeTestThread) => boolean,
  timeoutMs = 2000,
  threadId: ThreadId = asThreadId("thread-1"),
) {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<ProviderRuntimeTestThread> => {
    const readModel = await Effect.runPromise(engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (thread && predicate(thread)) {
      return thread;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for thread state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };
  return poll();
}

async function waitForNoBinding(
  directory: ProviderSessionDirectoryShape,
  threadId: ThreadId,
  timeoutMs = 2000,
) {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    const binding = await Effect.runPromise(directory.getBinding(threadId));
    if (binding._tag === "None") {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for provider binding ${threadId} to be pruned`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };
  return poll();
}

type ProviderRuntimeTestReadModel = OrchestrationReadModel;
type ProviderRuntimeTestThread = ProviderRuntimeTestReadModel["threads"][number];
type ProviderRuntimeTestMessage = ProviderRuntimeTestThread["messages"][number];
type ProviderRuntimeTestProposedPlan = ProviderRuntimeTestThread["proposedPlans"][number];
type ProviderRuntimeTestActivity = ProviderRuntimeTestThread["activities"][number];
type ProviderRuntimeTestCheckpoint = ProviderRuntimeTestThread["checkpoints"][number];

describe("ProviderRuntimeIngestion", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ProviderRuntimeIngestionService | ProviderSessionDirectory,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createHarness(options?: {
    serverSettings?: Partial<ServerSettings>;
    projectHooksLayer?: Layer.Layer<ProjectHooksService, never>;
    autoStart?: boolean;
    vxappBacked?: boolean;
    vxappWorktreePath?: string;
    ownerAuthorityWorktreePaths?: ReadonlyArray<string>;
    initialHasActiveError?: boolean;
    initialActiveError?: string | null;
    initialHistoricalError?: string | null;
    initialErrorPresentationSource?: "none" | "owner" | "session";
  }) {
    ensureDefaultOwnerHelperSpies();
    const workspaceRoot = makeTempDir("t3-provider-project-");
    fs.mkdirSync(path.join(workspaceRoot, ".git"));
    const provider = createProviderServiceHarness();
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const layer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(makeTestServerSettingsLayer(options?.serverSettings)),
      Layer.provideMerge(
        Layer.succeed(AgentsVxappExternalRoleAuthority, {
          getSnapshot: () =>
            Effect.succeed({
              projects: [],
              threadSummaries: (options?.ownerAuthorityWorktreePaths ?? []).map((worktreePath) => ({
                id: asThreadId(`authority:${worktreePath}`),
                projectId: asProjectId("project-1"),
                title: "Authority Thread",
                labels: [],
                modelSelection: {
                  provider: "codex" as const,
                  model: "gpt-5-codex",
                },
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
              })),
            }),
          getRuntimePaths: () => Effect.succeed(makeRuntimePaths()),
        }),
      ),
      Layer.provideMerge(options?.projectHooksLayer ?? ProjectHooksService.layerTest),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const ingestion = await runtime.runPromise(Effect.service(ProviderRuntimeIngestionService));
    const directory = await runtime.runPromise(Effect.service(ProviderSessionDirectory));
    scope = await Effect.runPromise(Scope.make("sequential"));
    const start = () => Effect.runPromise(ingestion.start().pipe(Scope.provide(scope!)));
    if (options?.autoStart !== false) {
      await start();
    }
    const drain = () => Effect.runPromise(ingestion.drain);

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-provider-project-create"),
        projectId: asProjectId("project-1"),
        title: "Provider Project",
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
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: options?.vxappBacked || options?.vxappWorktreePath ? "t3code/test-thread-1" : null,
        worktreePath:
          options?.vxappWorktreePath ??
          (options?.vxappBacked
            ? "/tmp/.agents-vxapp-runtime/role-sessions/jasper/thread-1/workspace"
            : null),
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-seed"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        ...(options?.initialHasActiveError !== undefined
          ? { hasActiveError: options.initialHasActiveError }
          : {}),
        ...(options?.initialActiveError !== undefined
          ? { activeError: options.initialActiveError }
          : {}),
        ...(options?.initialHistoricalError !== undefined
          ? { historicalError: options.initialHistoricalError }
          : {}),
        ...(options?.initialErrorPresentationSource !== undefined
          ? {
              errorPresentationSource: options.initialErrorPresentationSource,
            }
          : {}),
        createdAt,
      }),
    );
    provider.setSession({
      provider: "codex",
      status: "ready",
      runtimeMode: "approval-required",
      threadId: ThreadId.makeUnsafe("thread-1"),
      createdAt,
      updatedAt: createdAt,
    });

    return {
      engine,
      emit: provider.emit,
      setProviderSession: provider.setSession,
      directory,
      start,
      drain,
    };
  }

  it("maps turn started/completed events into thread session updates", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: now,
      turnId: asTurnId("turn-1"),
    });

    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "running" && thread.session?.activeTurnId === "turn-1",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-1"),
      payload: {
        state: "failed",
        errorMessage: "turn failed",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === null &&
        entry.session?.lastError === "turn failed",
    );
    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("turn failed");
  });

  it("persists turn lifecycle updates back into provider session runtime state", async () => {
    const harness = await createHarness();
    const runningAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-before-runtime-persist"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-persisted"),
          updatedAt: runningAt,
          lastError: null,
        },
        createdAt: runningAt,
      }),
    );

    await Effect.runPromise(
      harness.directory.upsert({
        threadId: ThreadId.makeUnsafe("thread-1"),
        provider: "codex",
        runtimeMode: "approval-required",
        status: "running",
        runtimePayload: {
          activeTurnId: "turn-persisted",
          lastError: null,
          lastRuntimeEvent: "provider.sendTurn",
          lastRuntimeEventAt: runningAt,
        },
      }),
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-persist"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      turnId: asTurnId("turn-persisted"),
      payload: {
        state: "completed",
      },
    });

    await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "ready" && entry.session?.activeTurnId === null,
    );

    const bindingOption = await Effect.runPromise(
      harness.directory.getBinding(asThreadId("thread-1")),
    );
    expect(bindingOption._tag).toBe("Some");
    if (bindingOption._tag !== "Some") {
      return;
    }

    expect(bindingOption.value.status).toBe("ready");
    const payload =
      bindingOption.value.runtimePayload !== null &&
      typeof bindingOption.value.runtimePayload === "object" &&
      !Array.isArray(bindingOption.value.runtimePayload)
        ? (bindingOption.value.runtimePayload as Record<string, unknown>)
        : null;
    expect(payload).not.toBeNull();
    expect(payload?.activeTurnId == null).toBe(true);
    expect(payload?.lastError == null).toBe(true);
    expect(payload?.lastRuntimeEvent).toBe("turn.completed");
    expect(typeof payload?.lastRuntimeEventAt).toBe("string");
  });

  it("ignores stale lifecycle events that arrive after a turn has already settled", async () => {
    const harness = await createHarness();
    const baseMs = Date.now() + 1_000;
    const startedAt = new Date(baseMs).toISOString();
    const staleRunningAt = new Date(baseMs + 1_000).toISOString();
    const completedAt = new Date(baseMs + 2_000).toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-stale-regression"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: startedAt,
      turnId: asTurnId("turn-stale-regression"),
    });

    await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "running" &&
        entry.session?.activeTurnId === "turn-stale-regression",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-stale-regression"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: completedAt,
      turnId: asTurnId("turn-stale-regression"),
      payload: {
        state: "completed",
      },
    });

    await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "ready" && entry.session?.activeTurnId === null,
    );

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-waiting-stale-regression"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: staleRunningAt,
      payload: {
        state: "waiting",
        reason: "stale approval prompt",
      },
    });

    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
    expect(thread?.session?.status).toBe("ready");
    expect(thread?.session?.activeTurnId).toBeNull();

    const bindingOption = await Effect.runPromise(
      harness.directory.getBinding(asThreadId("thread-1")),
    );
    expect(bindingOption._tag).toBe("Some");
    if (bindingOption._tag !== "Some") {
      return;
    }

    expect(bindingOption.value.status).toBe("ready");
    const payload =
      bindingOption.value.runtimePayload !== null &&
      typeof bindingOption.value.runtimePayload === "object" &&
      !Array.isArray(bindingOption.value.runtimePayload)
        ? (bindingOption.value.runtimePayload as Record<string, unknown>)
        : null;
    expect(payload?.activeTurnId).toBeNull();
    expect(payload?.lastRuntimeEvent).toBe("turn.completed");
    expect(payload?.lastRuntimeEventAt).toBe(completedAt);
  });

  it("reconciles a persisted stopped provider binding on startup", async () => {
    const harness = await createHarness({ autoStart: false });
    const runningAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running-before-reconcile"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-stale"),
          updatedAt: runningAt,
          lastError: null,
        },
        createdAt: runningAt,
      }),
    );

    await Effect.runPromise(
      harness.directory.upsert({
        threadId: ThreadId.makeUnsafe("thread-1"),
        provider: "codex",
        runtimeMode: "approval-required",
        status: "stopped",
        runtimePayload: {
          activeTurnId: null,
          lastError: null,
          lastRuntimeEvent: "provider.stopAll",
        },
      }),
    );

    await harness.start();

    const thread = await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "stopped" && entry.session?.activeTurnId === null,
    );
    expect(thread.session?.status).toBe("stopped");
    expect(thread.session?.activeTurnId).toBeNull();
  });

  it("prunes persisted bindings for archived, deleted, and missing threads during startup reconcile", async () => {
    const harness = await createHarness({ autoStart: false });
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-delete-target"),
        threadId: asThreadId("thread-delete-target"),
        projectId: asProjectId("project-1"),
        title: "Delete Target",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.makeUnsafe("cmd-thread-archive-startup-prune"),
        threadId: asThreadId("thread-1"),
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.makeUnsafe("cmd-thread-archive-delete-target"),
        threadId: asThreadId("thread-delete-target"),
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-thread-delete-startup-prune"),
        threadId: asThreadId("thread-delete-target"),
      }),
    );

    await Effect.runPromise(
      harness.directory.upsert({
        threadId: asThreadId("thread-1"),
        provider: "codex",
        runtimeMode: "approval-required",
        status: "stopped",
        runtimePayload: {
          lastRuntimeEvent: "test.seed.archived",
          lastRuntimeEventAt: createdAt,
        },
      }),
    );

    await Effect.runPromise(
      harness.directory.upsert({
        threadId: asThreadId("thread-delete-target"),
        provider: "codex",
        runtimeMode: "approval-required",
        status: "stopped",
        runtimePayload: {
          lastRuntimeEvent: "test.seed.deleted",
          lastRuntimeEventAt: createdAt,
        },
      }),
    );

    await Effect.runPromise(
      harness.directory.upsert({
        threadId: asThreadId("thread-missing"),
        provider: "codex",
        runtimeMode: "approval-required",
        status: "stopped",
        runtimePayload: {
          lastRuntimeEvent: "test.seed.missing",
          lastRuntimeEventAt: createdAt,
        },
      }),
    );

    await harness.start();

    await waitForNoBinding(harness.directory, asThreadId("thread-1"));
    await waitForNoBinding(harness.directory, asThreadId("thread-delete-target"));
    await waitForNoBinding(harness.directory, asThreadId("thread-missing"));
  });

  it("applies provider session.state.changed transitions directly", async () => {
    const harness = await createHarness();
    const waitingAt = new Date().toISOString();

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-waiting"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: waitingAt,
      payload: {
        state: "waiting",
        reason: "awaiting approval",
      },
    });

    let thread = await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "running" && entry.session?.activeTurnId === null,
    );
    expect(thread.session?.status).toBe("running");
    expect(thread.session?.lastError).toBeNull();

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-error"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      payload: {
        state: "error",
        reason: "provider crashed",
      },
    });

    thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === null &&
        entry.session?.lastError === "provider crashed",
    );
    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("provider crashed");

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-stopped"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      payload: {
        state: "stopped",
      },
    });

    thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "stopped" &&
        entry.session?.activeTurnId === null &&
        entry.session?.lastError === "provider crashed",
    );
    expect(thread.session?.status).toBe("stopped");
    expect(thread.session?.lastError).toBe("provider crashed");

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-ready"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: new Date().toISOString(),
      payload: {
        state: "ready",
      },
    });

    thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "ready" &&
        entry.session?.activeTurnId === null &&
        entry.session?.lastError === null,
    );
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.lastError).toBeNull();
  });

  it("checks owner thread status before vxapp-backed lifecycle updates become authoritative", async () => {
    const threadStatusSpy = vi
      .spyOn(providerHarnessBridge, "requestAgentsVxappThreadStatus")
      .mockResolvedValue({});
    const harness = await createHarness({
      vxappBacked: true,
      initialHasActiveError: true,
      initialActiveError: "owner preserved",
      initialHistoricalError: "owner history",
      initialErrorPresentationSource: "owner",
    });
    const waitingAt = new Date().toISOString();

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-owner-sync"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: waitingAt,
      payload: {
        state: "waiting",
        reason: "awaiting approval",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "running" && entry.session?.activeTurnId === null,
    );

    expect(threadStatusSpy).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(thread.session?.status).toBe("running");
  });

  it("checks owner thread status for owner-authoritative vxapp worktrees outside role-session roots", async () => {
    const threadStatusSpy = vi
      .spyOn(providerHarnessBridge, "requestAgentsVxappThreadStatus")
      .mockResolvedValue({});
    const worktreePath = "/tmp/custom-vxapp/thread-1/worktree";
    const harness = await createHarness({
      vxappWorktreePath: worktreePath,
      ownerAuthorityWorktreePaths: [worktreePath],
      initialHasActiveError: true,
      initialActiveError: "owner preserved",
      initialHistoricalError: "owner history",
      initialErrorPresentationSource: "owner",
    });
    const waitingAt = new Date().toISOString();

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-owner-sync-custom-worktree"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: waitingAt,
      payload: {
        state: "waiting",
        reason: "awaiting approval",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "running" && entry.session?.activeTurnId === null,
    );

    expect(threadStatusSpy).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(thread.session?.status).toBe("running");
  });

  it("surfaces owner thread-status failures instead of applying vxapp-backed lifecycle state", async () => {
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappThreadStatus").mockRejectedValue(
      new Error("owner thread status failed"),
    );
    const harness = await createHarness({ vxappBacked: true });
    const waitingAt = new Date().toISOString();

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-owner-sync-fail"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      createdAt: waitingAt,
      payload: {
        state: "waiting",
        reason: "awaiting approval",
      },
    });

    await harness.drain();
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));

    expect(thread?.session?.status).toBe("ready");
    expect(
      thread?.activities.some((activity) => activity.kind === "provider.thread.status.sync.failed"),
    ).toBe(true);
  });

  it("does not clear active turn when session/thread started arrives mid-turn", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-midturn-lifecycle"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-midturn-lifecycle"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-midturn-lifecycle",
    );

    harness.emit({
      type: "thread.started",
      eventId: asEventId("evt-thread-started-midturn-lifecycle"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
    });
    harness.emit({
      type: "session.started",
      eventId: asEventId("evt-session-started-midturn-lifecycle"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
    });

    await harness.drain();
    const midReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const midThread = midReadModel.threads.find(
      (entry) => entry.id === ThreadId.makeUnsafe("thread-1"),
    );
    expect(midThread?.session?.status).toBe("running");
    expect(midThread?.session?.activeTurnId).toBe("turn-midturn-lifecycle");

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-midturn-lifecycle"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-midturn-lifecycle"),
      status: "completed",
    });

    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "ready" && thread.session?.activeTurnId === null,
    );
  });

  it("preserves the active turn when turn.started and later lifecycle events arrive in the same burst", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-burst-lifecycle"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-burst-lifecycle"),
    });
    harness.emit({
      type: "thread.started",
      eventId: asEventId("evt-thread-started-burst-lifecycle"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
    });
    harness.emit({
      type: "session.started",
      eventId: asEventId("evt-session-started-burst-lifecycle"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "running" &&
        entry.session?.activeTurnId === "turn-burst-lifecycle",
    );

    expect(thread.session?.status).toBe("running");
    expect(thread.session?.activeTurnId).toBe("turn-burst-lifecycle");
  });

  it("keeps checkpoint and tool progress events provisional during an active turn", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-provisional"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-provisional"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" && thread.session?.activeTurnId === "turn-provisional",
    );

    harness.emit({
      type: "item.updated",
      eventId: asEventId("evt-tool-progress-provisional"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-provisional"),
      itemId: asItemId("item-tool-provisional"),
      payload: {
        itemType: "command_execution",
        status: "completed",
        title: "Run tests",
        detail: "passed",
        data: {},
      },
    });
    harness.emit({
      type: "turn.diff.updated",
      eventId: asEventId("evt-turn-diff-provisional"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-provisional"),
      itemId: asItemId("item-assistant-provisional"),
      payload: {
        unifiedDiff: "diff --git a/file.txt b/file.txt\n+hello\n",
      },
    });

    await harness.drain();
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));

    expect(thread?.session?.status).toBe("running");
    expect(thread?.session?.activeTurnId).toBe("turn-provisional");
    expect(thread?.latestTurn?.state).toBe("running");
    expect(
      thread?.activities.some(
        (activity: ProviderRuntimeTestActivity) =>
          activity.kind === "tool.updated" &&
          activity.payload !== null &&
          typeof activity.payload === "object" &&
          (activity.payload as { status?: unknown }).status === "completed",
      ),
    ).toBe(true);
  });

  it("accepts claude turn lifecycle when seeded thread id is a synthetic placeholder", async () => {
    const harness = await createHarness();
    const seededAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-seed-claude-placeholder"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: seededAt,
          lastError: null,
        },
        createdAt: seededAt,
      }),
    );

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-claude-placeholder"),
      provider: "claudeAgent",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-claude-placeholder"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-claude-placeholder",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-claude-placeholder"),
      provider: "claudeAgent",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-claude-placeholder"),
      status: "completed",
    });

    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "ready" && thread.session?.activeTurnId === null,
    );
  });

  it("ignores auxiliary turn completions from a different provider thread", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-primary"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-primary"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" && thread.session?.activeTurnId === "turn-primary",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-aux"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-aux"),
      status: "completed",
    });

    await harness.drain();
    const midReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const midThread = midReadModel.threads.find(
      (entry) => entry.id === ThreadId.makeUnsafe("thread-1"),
    );
    expect(midThread?.session?.status).toBe("running");
    expect(midThread?.session?.activeTurnId).toBe("turn-primary");

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-primary"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-primary"),
      status: "completed",
    });

    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "ready" && thread.session?.activeTurnId === null,
    );
  });

  it("settles the active turn when turn.completed omits turnId", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-missing-turn-id"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-missing-turn-id"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-missing-turn-id",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-missing-turn-id"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      status: "completed",
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "ready" &&
        entry.session?.activeTurnId === null &&
        entry.latestTurn?.turnId === "turn-missing-turn-id" &&
        entry.latestTurn?.state === "completed",
    );

    expect(thread.latestTurn?.completedAt).not.toBeNull();
  });

  it("does not reopen a terminal active turn from later lifecycle state events", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const turnId = asTurnId("turn-terminal-lifecycle");

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-terminal-lifecycle"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId,
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-terminal-lifecycle",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-terminal-lifecycle"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId,
      status: "completed",
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "ready" &&
        thread.session?.activeTurnId === null &&
        thread.latestTurn?.turnId === "turn-terminal-lifecycle" &&
        thread.latestTurn?.state === "completed",
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-stale-terminal-lifecycle"),
        threadId: asThreadId("thread-1"),
        session: {
          threadId: asThreadId("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          updatedAt: new Date().toISOString(),
          lastError: null,
        },
        createdAt: new Date().toISOString(),
      }),
    );

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-stale-terminal-running"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      payload: {
        state: "running",
      },
    });

    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === asThreadId("thread-1"));
    expect(thread?.session?.status).toBe("ready");
    expect(thread?.session?.activeTurnId).toBe(turnId);

    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-state-stale-terminal-ready"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      payload: {
        state: "ready",
      },
    });

    await waitForThread(
      harness.engine,
      (entry) => entry.session?.status === "ready" && entry.session?.activeTurnId === null,
    );
  });

  it("ignores non-active turn completion when runtime omits thread id", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-guarded"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-guarded-main"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-guarded-main",
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-guarded-other"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-guarded-other"),
      status: "completed",
    });

    await harness.drain();
    const midReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const midThread = midReadModel.threads.find(
      (entry) => entry.id === ThreadId.makeUnsafe("thread-1"),
    );
    expect(midThread?.session?.status).toBe("running");
    expect(midThread?.session?.activeTurnId).toBe("turn-guarded-main");

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-guarded-main"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-guarded-main"),
      status: "completed",
    });

    await waitForThread(
      harness.engine,
      (thread) => thread.session?.status === "ready" && thread.session?.activeTurnId === null,
    );
  });

  it("maps canonical content delta/item completed into finalized assistant messages", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-1"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-2"),
      itemId: asItemId("item-1"),
      payload: {
        streamKind: "assistant_text",
        delta: "hello",
      },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-2"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-2"),
      itemId: asItemId("item-1"),
      payload: {
        streamKind: "assistant_text",
        delta: " world",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-2"),
      itemId: asItemId("item-1"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-1" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-1",
    );
    expect(message?.text).toBe("hello world");
    expect(message?.streaming).toBe(false);
  });

  it("uses assistant item completion detail when no assistant deltas were streamed", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-assistant-item-completed-no-delta"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-no-delta"),
      itemId: asItemId("item-no-delta"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
        detail: "assistant-only final text",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-no-delta" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-no-delta",
    );
    expect(message?.text).toBe("assistant-only final text");
    expect(message?.streaming).toBe(false);
  });

  it("projects completed plan items into first-class proposed plans", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.proposed.completed",
      eventId: asEventId("evt-plan-item-completed"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-final"),
      payload: {
        planMarkdown: "## Ship plan\n\n- wire projection\n- render follow-up",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.proposedPlans.some(
        (proposedPlan: ProviderRuntimeTestProposedPlan) =>
          proposedPlan.id === "plan:thread-1:turn:turn-plan-final",
      ),
    );
    const proposedPlan = thread.proposedPlans.find(
      (entry: ProviderRuntimeTestProposedPlan) => entry.id === "plan:thread-1:turn:turn-plan-final",
    );
    expect(proposedPlan?.planMarkdown).toBe(
      "## Ship plan\n\n- wire projection\n- render follow-up",
    );
  });

  it("marks the source proposed plan implemented only after the target turn starts", async () => {
    const harness = await createHarness();
    const sourceThreadId = asThreadId("thread-plan");
    const targetThreadId = asThreadId("thread-implement");
    const sourceTurnId = asTurnId("turn-plan-source");
    const targetTurnId = asTurnId("turn-plan-implement");
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-plan-source"),
        threadId: sourceThreadId,
        projectId: asProjectId("project-1"),
        title: "Plan Source",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: "plan",
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-plan-source"),
        threadId: sourceThreadId,
        session: {
          threadId: sourceThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-plan-target"),
        threadId: targetThreadId,
        projectId: asProjectId("project-1"),
        title: "Plan Target",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-plan-target"),
        threadId: targetThreadId,
        session: {
          threadId: targetThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );
    harness.setProviderSession({
      provider: "codex",
      status: "ready",
      runtimeMode: "approval-required",
      threadId: targetThreadId,
      createdAt,
      updatedAt: createdAt,
      activeTurnId: targetTurnId,
    });

    harness.emit({
      type: "turn.proposed.completed",
      eventId: asEventId("evt-plan-source-completed"),
      provider: "codex",
      createdAt,
      threadId: sourceThreadId,
      turnId: sourceTurnId,
      payload: {
        planMarkdown: "# Source plan",
      },
    });

    const sourceThreadWithPlan = await waitForThread(
      harness.engine,
      (thread) =>
        thread.proposedPlans.some(
          (proposedPlan: ProviderRuntimeTestProposedPlan) =>
            proposedPlan.id === "plan:thread-plan:turn:turn-plan-source" &&
            proposedPlan.implementedAt === null,
        ),
      2_000,
      sourceThreadId,
    );
    const sourcePlan = sourceThreadWithPlan.proposedPlans.find(
      (entry: ProviderRuntimeTestProposedPlan) =>
        entry.id === "plan:thread-plan:turn:turn-plan-source",
    );
    expect(sourcePlan).toBeDefined();
    if (!sourcePlan) {
      throw new Error("Expected source plan to exist.");
    }

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-plan-target"),
        threadId: targetThreadId,
        message: {
          messageId: asMessageId("msg-plan-target"),
          role: "user",
          text: "PLEASE IMPLEMENT THIS PLAN:\n# Source plan",
          attachments: [],
        },
        sourceProposedPlan: {
          threadId: sourceThreadId,
          planId: sourcePlan.id,
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      }),
    );

    const sourceThreadBeforeStart = await waitForThread(
      harness.engine,
      (thread) =>
        thread.proposedPlans.some(
          (proposedPlan: ProviderRuntimeTestProposedPlan) =>
            proposedPlan.id === sourcePlan.id && proposedPlan.implementedAt === null,
        ),
      2_000,
      sourceThreadId,
    );
    expect(
      sourceThreadBeforeStart.proposedPlans.find((entry) => entry.id === sourcePlan.id),
    ).toMatchObject({
      implementedAt: null,
      implementationThreadId: null,
    });

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-plan-target-started"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: targetThreadId,
      turnId: targetTurnId,
    });

    const sourceThreadAfterStart = await waitForThread(
      harness.engine,
      (thread) =>
        thread.proposedPlans.some(
          (proposedPlan: ProviderRuntimeTestProposedPlan) =>
            proposedPlan.id === sourcePlan.id &&
            proposedPlan.implementedAt !== null &&
            proposedPlan.implementationThreadId === targetThreadId,
        ),
      2_000,
      sourceThreadId,
    );
    expect(
      sourceThreadAfterStart.proposedPlans.find((entry) => entry.id === sourcePlan.id),
    ).toMatchObject({
      implementationThreadId: "thread-implement",
    });
  });

  it("does not mark the source proposed plan implemented for a rejected turn.started event", async () => {
    const harness = await createHarness();
    const sourceThreadId = asThreadId("thread-plan");
    const targetThreadId = asThreadId("thread-1");
    const sourceTurnId = asTurnId("turn-plan-source");
    const activeTurnId = asTurnId("turn-already-running");
    const staleTurnId = asTurnId("turn-stale-start");
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-plan-source-guarded"),
        threadId: sourceThreadId,
        projectId: asProjectId("project-1"),
        title: "Plan Source",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: "plan",
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-plan-source-guarded"),
        threadId: sourceThreadId,
        session: {
          threadId: sourceThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );
    harness.setProviderSession({
      provider: "codex",
      status: "running",
      runtimeMode: "approval-required",
      threadId: targetThreadId,
      createdAt,
      updatedAt: createdAt,
      activeTurnId,
    });

    harness.emit({
      type: "turn.proposed.completed",
      eventId: asEventId("evt-plan-source-completed-guarded"),
      provider: "codex",
      createdAt,
      threadId: sourceThreadId,
      turnId: sourceTurnId,
      payload: {
        planMarkdown: "# Source plan",
      },
    });

    const sourceThreadWithPlan = await waitForThread(
      harness.engine,
      (thread) =>
        thread.proposedPlans.some(
          (proposedPlan: ProviderRuntimeTestProposedPlan) =>
            proposedPlan.id === "plan:thread-plan:turn:turn-plan-source" &&
            proposedPlan.implementedAt === null,
        ),
      2_000,
      sourceThreadId,
    );
    const sourcePlan = sourceThreadWithPlan.proposedPlans.find(
      (entry: ProviderRuntimeTestProposedPlan) =>
        entry.id === "plan:thread-plan:turn:turn-plan-source",
    );
    expect(sourcePlan).toBeDefined();
    if (!sourcePlan) {
      throw new Error("Expected source plan to exist.");
    }

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-plan-target-guarded"),
        threadId: targetThreadId,
        message: {
          messageId: asMessageId("msg-plan-target-guarded"),
          role: "user",
          text: "PLEASE IMPLEMENT THIS PLAN:\n# Source plan",
          attachments: [],
        },
        sourceProposedPlan: {
          threadId: sourceThreadId,
          planId: sourcePlan.id,
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-plan-target-guarded"),
        threadId: targetThreadId,
        session: {
          threadId: targetThreadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );
    harness.setProviderSession({
      provider: "codex",
      status: "running",
      runtimeMode: "approval-required",
      threadId: targetThreadId,
      createdAt,
      updatedAt: createdAt,
      activeTurnId,
    });

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-stale-plan-implementation"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: targetThreadId,
      turnId: staleTurnId,
    });

    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const sourceThreadAfterRejectedStart = readModel.threads.find(
      (entry) => entry.id === sourceThreadId,
    );
    expect(
      sourceThreadAfterRejectedStart?.proposedPlans.find((entry) => entry.id === sourcePlan.id),
    ).toMatchObject({
      implementedAt: null,
      implementationThreadId: null,
    });

    const targetThreadAfterRejectedStart = readModel.threads.find(
      (entry) => entry.id === targetThreadId,
    );
    expect(targetThreadAfterRejectedStart?.session?.status).toBe("running");
    expect(targetThreadAfterRejectedStart?.session?.activeTurnId).toBe(activeTurnId);
  });

  it("does not mark the source proposed plan implemented for an unrelated turn.started when no thread active turn is tracked", async () => {
    const harness = await createHarness();
    const sourceThreadId = asThreadId("thread-plan");
    const targetThreadId = asThreadId("thread-implement");
    const sourceTurnId = asTurnId("turn-plan-source");
    const expectedTurnId = asTurnId("turn-plan-implement");
    const replayedTurnId = asTurnId("turn-replayed");
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-plan-source-unrelated"),
        threadId: sourceThreadId,
        projectId: asProjectId("project-1"),
        title: "Plan Source",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: "plan",
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-plan-source-unrelated"),
        threadId: sourceThreadId,
        session: {
          threadId: sourceThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-plan-target-unrelated"),
        threadId: targetThreadId,
        projectId: asProjectId("project-1"),
        title: "Plan Target",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-set-plan-target-unrelated"),
        threadId: targetThreadId,
        session: {
          threadId: targetThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          updatedAt: createdAt,
          lastError: null,
        },
        createdAt,
      }),
    );

    harness.emit({
      type: "turn.proposed.completed",
      eventId: asEventId("evt-plan-source-completed-unrelated"),
      provider: "codex",
      createdAt,
      threadId: sourceThreadId,
      turnId: sourceTurnId,
      payload: {
        planMarkdown: "# Source plan",
      },
    });

    const sourceThreadWithPlan = await waitForThread(
      harness.engine,
      (thread) =>
        thread.proposedPlans.some(
          (proposedPlan: ProviderRuntimeTestProposedPlan) =>
            proposedPlan.id === "plan:thread-plan:turn:turn-plan-source" &&
            proposedPlan.implementedAt === null,
        ),
      2_000,
      sourceThreadId,
    );
    const sourcePlan = sourceThreadWithPlan.proposedPlans.find(
      (entry: ProviderRuntimeTestProposedPlan) =>
        entry.id === "plan:thread-plan:turn:turn-plan-source",
    );
    expect(sourcePlan).toBeDefined();
    if (!sourcePlan) {
      throw new Error("Expected source plan to exist.");
    }

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-plan-target-unrelated"),
        threadId: targetThreadId,
        message: {
          messageId: asMessageId("msg-plan-target-unrelated"),
          role: "user",
          text: "PLEASE IMPLEMENT THIS PLAN:\n# Source plan",
          attachments: [],
        },
        sourceProposedPlan: {
          threadId: sourceThreadId,
          planId: sourcePlan.id,
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      }),
    );

    harness.setProviderSession({
      provider: "codex",
      status: "running",
      runtimeMode: "approval-required",
      threadId: targetThreadId,
      createdAt,
      updatedAt: createdAt,
      activeTurnId: expectedTurnId,
    });

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-unrelated-plan-implementation"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: targetThreadId,
      turnId: replayedTurnId,
    });

    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const sourceThreadAfterUnrelatedStart = readModel.threads.find(
      (entry) => entry.id === sourceThreadId,
    );
    expect(
      sourceThreadAfterUnrelatedStart?.proposedPlans.find((entry) => entry.id === sourcePlan.id),
    ).toMatchObject({
      implementedAt: null,
      implementationThreadId: null,
    });
  });

  it("finalizes buffered proposed-plan deltas into a first-class proposed plan on turn completion", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-plan-buffer"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" && thread.session?.activeTurnId === "turn-plan-buffer",
    );

    harness.emit({
      type: "turn.proposed.delta",
      eventId: asEventId("evt-plan-delta-1"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
      payload: {
        delta: "## Buffered plan\n\n- first",
      },
    });
    harness.emit({
      type: "turn.proposed.delta",
      eventId: asEventId("evt-plan-delta-2"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
      payload: {
        delta: "\n- second",
      },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-plan-buffer"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-plan-buffer"),
      payload: {
        state: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.proposedPlans.some(
        (proposedPlan: ProviderRuntimeTestProposedPlan) =>
          proposedPlan.id === "plan:thread-1:turn:turn-plan-buffer",
      ),
    );
    const proposedPlan = thread.proposedPlans.find(
      (entry: ProviderRuntimeTestProposedPlan) =>
        entry.id === "plan:thread-1:turn:turn-plan-buffer",
    );
    expect(proposedPlan?.planMarkdown).toBe("## Buffered plan\n\n- first\n- second");
  });

  it("buffers assistant deltas by default until completion", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" && thread.session?.activeTurnId === "turn-buffered",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered"),
      itemId: asItemId("item-buffered"),
      payload: {
        streamKind: "assistant_text",
        delta: "buffer me",
      },
    });

    await harness.drain();
    const midReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const midThread = midReadModel.threads.find(
      (entry) => entry.id === ThreadId.makeUnsafe("thread-1"),
    );
    expect(
      midThread?.messages.some(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-buffered",
      ),
    ).toBe(false);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-buffered"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered"),
      itemId: asItemId("item-buffered"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffered" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffered",
    );
    expect(message?.text).toBe("buffer me");
    expect(message?.streaming).toBe(false);
  });

  it("streams assistant deltas when thread.turn.start requests streaming mode", async () => {
    const harness = await createHarness({
      serverSettings: { enableAssistantStreaming: true },
    });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-streaming-mode"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("message-streaming-mode"),
          role: "user",
          text: "stream please",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.drain();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-streaming-mode"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-mode"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-streaming-mode",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-streaming-mode"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-mode"),
      itemId: asItemId("item-streaming-mode"),
      payload: {
        streamKind: "assistant_text",
        delta: "hello live",
      },
    });

    const liveThread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-streaming-mode" &&
          message.streaming &&
          message.text === "hello live",
      ),
    );
    const liveMessage = liveThread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-streaming-mode",
    );
    expect(liveMessage?.streaming).toBe(true);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-streaming-mode"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-mode"),
      itemId: asItemId("item-streaming-mode"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
        detail: "hello live",
      },
    });

    const finalThread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-streaming-mode" && !message.streaming,
      ),
    );
    const finalMessage = finalThread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-streaming-mode",
    );
    expect(finalMessage?.text).toBe("hello live");
    expect(finalMessage?.streaming).toBe(false);
  });

  it("flushes each assistant streaming delta immediately after the first live update", async () => {
    const harness = await createHarness({
      serverSettings: { enableAssistantStreaming: true },
    });
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-streaming-batched"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-batched"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-streaming-batched",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-streaming-batched-1"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-batched"),
      itemId: asItemId("item-streaming-batched"),
      payload: {
        streamKind: "assistant_text",
        delta: "a",
      },
    });
    await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-streaming-batched" &&
          message.streaming &&
          message.text === "a",
      ),
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-streaming-batched-2"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-batched"),
      itemId: asItemId("item-streaming-batched"),
      payload: {
        streamKind: "assistant_text",
        delta: "b",
      },
    });
    await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-streaming-batched" &&
          message.streaming &&
          message.text === "ab",
      ),
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-streaming-batched-3"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-batched"),
      itemId: asItemId("item-streaming-batched"),
      payload: {
        streamKind: "assistant_text",
        delta: "c",
      },
    });
    await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-streaming-batched" &&
          message.streaming &&
          message.text === "abc",
      ),
    );

    const beforeCompletion = await Effect.runPromise(harness.engine.getReadModel());
    const beforeCompletionMessage = beforeCompletion.threads[0]?.messages.find(
      (message) => message.id === "assistant:item-streaming-batched",
    );
    expect(beforeCompletionMessage?.text).toBe("abc");

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-streaming-batched"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-streaming-batched"),
      itemId: asItemId("item-streaming-batched"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const finalThread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-streaming-batched" &&
          !message.streaming &&
          message.text === "abc",
      ),
    );
    const finalMessage = finalThread.messages.find(
      (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-streaming-batched",
    );
    expect(finalMessage?.text).toBe("abc");

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    const persistedMessageEvents = events.filter(
      (event): event is Extract<OrchestrationEvent, { type: "thread.message-sent" }> =>
        event.type === "thread.message-sent" &&
        event.payload.messageId === "assistant:item-streaming-batched",
    );
    expect(persistedMessageEvents.map((event) => event.payload.text)).toEqual(["a", "b", "c", ""]);
  });

  it("spills oversized buffered deltas and still finalizes full assistant text", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const oversizedText = "x".repeat(40_000);

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
    });
    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-buffer-spill",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
      itemId: asItemId("item-buffer-spill"),
      payload: {
        streamKind: "assistant_text",
        delta: oversizedText,
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-buffer-spill"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffer-spill"),
      itemId: asItemId("item-buffer-spill"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffer-spill" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffer-spill",
    );
    expect(message?.text.length).toBe(oversizedText.length);
    expect(message?.text).toBe(oversizedText);
    expect(message?.streaming).toBe(false);
  });

  it("does not duplicate assistant completion when item.completed is followed by turn.completed", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "running" &&
        thread.session?.activeTurnId === "turn-complete-dedup",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      itemId: asItemId("item-complete-dedup"),
      payload: {
        streamKind: "assistant_text",
        delta: "done",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      itemId: asItemId("item-complete-dedup"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-turn-completed-for-complete-dedup"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-complete-dedup"),
      payload: {
        state: "completed",
      },
    });

    await waitForThread(
      harness.engine,
      (thread) =>
        thread.session?.status === "ready" &&
        thread.session?.activeTurnId === null &&
        thread.messages.some(
          (message: ProviderRuntimeTestMessage) =>
            message.id === "assistant:item-complete-dedup" && !message.streaming,
        ),
    );

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    const completionEvents = events.filter((event) => {
      if (event.type !== "thread.message-sent") {
        return false;
      }
      return (
        event.payload.messageId === "assistant:item-complete-dedup" &&
        event.payload.streaming === false
      );
    });
    expect(completionEvents).toHaveLength(1);
  });

  it("maps canonical request events into approval activities with requestKind", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "request.opened",
      eventId: asEventId("evt-request-opened"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      requestId: ApprovalRequestId.makeUnsafe("req-open"),
      payload: {
        requestType: "command_execution_approval",
        detail: "pwd",
      },
    });

    harness.emit({
      type: "request.resolved",
      eventId: asEventId("evt-request-resolved"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      requestId: ApprovalRequestId.makeUnsafe("req-open"),
      payload: {
        requestType: "command_execution_approval",
        decision: "accept",
      },
    });

    await waitForThread(
      harness.engine,
      (entry) =>
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "approval.requested",
        ) &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "approval.resolved",
        ),
    );

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));
    expect(thread).toBeDefined();

    const requested = thread?.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-request-opened",
    );
    const requestedPayload =
      requested?.payload && typeof requested.payload === "object"
        ? (requested.payload as Record<string, unknown>)
        : undefined;
    expect(requestedPayload?.requestKind).toBe("command");
    expect(requestedPayload?.requestType).toBe("command_execution_approval");

    const resolved = thread?.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-request-resolved",
    );
    const resolvedPayload =
      resolved?.payload && typeof resolved.payload === "object"
        ? (resolved.payload as Record<string, unknown>)
        : undefined;
    expect(resolvedPayload?.requestKind).toBe("command");
    expect(resolvedPayload?.requestType).toBe("command_execution_approval");
  });

  it("routes pending approval callbacks through the owner helper before local pending state appears", async () => {
    const approvalRequestSpy = vi
      .spyOn(providerHarnessBridge, "requestAgentsVxappApprovalRequest")
      .mockResolvedValue({});
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "request.opened",
      eventId: asEventId("evt-request-opened-owner"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      requestId: ApprovalRequestId.makeUnsafe("req-owner-approval"),
      payload: {
        requestType: "command_execution_approval",
        detail: "pwd",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "approval.requested",
      ),
    );

    expect(approvalRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        requestId: "req-owner-approval",
        requestType: "command_execution_approval",
        state: "pending",
      }),
    );
    expect(thread.activities.some((activity) => activity.kind === "approval.requested")).toBe(true);
  });

  it("surfaces owner approval failures instead of creating local pending approval truth", async () => {
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappApprovalRequest").mockRejectedValue(
      new Error("owner approval request failed"),
    );
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "request.opened",
      eventId: asEventId("evt-request-opened-owner-fail"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      requestId: ApprovalRequestId.makeUnsafe("req-owner-approval-fail"),
      payload: {
        requestType: "command_execution_approval",
        detail: "pwd",
      },
    });

    await harness.drain();
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));

    expect(thread?.activities.some((activity) => activity.kind === "approval.requested")).toBe(
      false,
    );
    expect(
      thread?.activities.some((activity) => activity.kind === "provider.approval.request.failed"),
    ).toBe(true);
  });

  it("maps runtime.error into errored session state", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-3"),
      payload: {
        message: "runtime exploded",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === "turn-3" &&
        entry.session?.lastError === "runtime exploded",
    );
    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("runtime exploded");
  });

  it("records runtime.error activities from the typed payload message", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-activity"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-runtime-error-activity"),
      payload: {
        message: "runtime activity exploded",
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-runtime-error-activity"),
    );
    const activity = thread.activities.find(
      (entry: ProviderRuntimeTestActivity) => entry.id === "evt-runtime-error-activity",
    );
    const activityPayload =
      activity?.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : undefined;

    expect(activity?.kind).toBe("runtime.error");
    expect(activityPayload?.message).toBe("runtime activity exploded");
  });

  it("keeps the session running when a runtime.warning arrives during an active turn", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-warning-turn-started"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-warning"),
      payload: {},
    });

    harness.emit({
      type: "runtime.warning",
      eventId: asEventId("evt-warning-runtime"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-warning"),
      payload: {
        message: "Reconnecting... 2/5",
        detail: {
          willRetry: true,
        },
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "running" &&
        entry.session?.activeTurnId === "turn-warning" &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) =>
            activity.id === "evt-warning-runtime" && activity.kind === "runtime.warning",
        ),
    );
    expect(thread.session?.status).toBe("running");
    expect(thread.session?.activeTurnId).toBe("turn-warning");
    expect(thread.session?.lastError).toBeNull();
  });

  it("maps session/thread lifecycle and item.started into session/activity projections", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "session.started",
      eventId: asEventId("evt-session-started"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      message: "session started",
    });
    harness.emit({
      type: "thread.started",
      eventId: asEventId("evt-thread-started"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
    });
    harness.emit({
      type: "item.started",
      eventId: asEventId("evt-tool-started"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-9"),
      payload: {
        itemType: "command_execution",
        status: "in_progress",
        title: "Read file",
        detail: "/tmp/file.ts",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "ready" &&
        entry.session?.activeTurnId === null &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "tool.started",
        ),
    );

    expect(thread.session?.status).toBe("ready");
    expect(
      thread.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "tool.started",
      ),
    ).toBe(true);
  });

  it("sanitizes oversized tool activity data before it reaches orchestration persistence", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    const aggregatedOutput = "x".repeat(20_000);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-tool-completed-large-output"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-large-output"),
      itemId: asItemId("item-large-output"),
      payload: {
        itemType: "command_execution",
        status: "completed",
        title: "Ran command",
        detail: "printf lots",
        data: {
          item: {
            type: "commandExecution",
            id: "item-large-output",
            command: "printf lots",
            aggregatedOutput,
          },
        },
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-tool-completed-large-output"),
    );
    const activity = thread.activities.find(
      (entry) => entry.id === "evt-tool-completed-large-output",
    );
    const payload =
      activity?.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : {};
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const item =
      data.item && typeof data.item === "object" ? (data.item as Record<string, unknown>) : {};
    expect(item.aggregatedOutput).toContain("[truncated 15904 chars]");
    expect(String(item.aggregatedOutput).length).toBeLessThan(4_200);

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    const persistedActivityEvent = events.find(
      (event): event is Extract<OrchestrationEvent, { type: "thread.activity-appended" }> =>
        event.type === "thread.activity-appended" &&
        event.payload.activity.id === "evt-tool-completed-large-output",
    );
    const eventPayload =
      persistedActivityEvent?.payload.activity.payload &&
      typeof persistedActivityEvent.payload.activity.payload === "object"
        ? (persistedActivityEvent.payload.activity.payload as Record<string, unknown>)
        : {};
    const eventData =
      eventPayload.data && typeof eventPayload.data === "object"
        ? (eventPayload.data as Record<string, unknown>)
        : {};
    const eventItem =
      eventData.item && typeof eventData.item === "object"
        ? (eventData.item as Record<string, unknown>)
        : {};
    expect(eventItem.aggregatedOutput).toBe(item.aggregatedOutput);
  });

  it("consumes P1 runtime events into thread metadata, diff checkpoints, and activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "thread.metadata.updated",
      eventId: asEventId("evt-thread-metadata-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      payload: {
        name: "Renamed by provider",
        metadata: { source: "provider" },
      },
    });

    harness.emit({
      type: "turn.plan.updated",
      eventId: asEventId("evt-turn-plan-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-p1"),
      payload: {
        explanation: "Working through the plan",
        plan: [
          { step: "Inspect files", status: "completed" },
          { step: "Apply patch", status: "in_progress" },
        ],
      },
    });

    harness.emit({
      type: "item.updated",
      eventId: asEventId("evt-item-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-p1"),
      itemId: asItemId("item-p1-tool"),
      payload: {
        itemType: "command_execution",
        status: "in_progress",
        title: "Run tests",
        detail: "bun test",
        data: { pid: 123 },
      },
    });

    harness.emit({
      type: "runtime.warning",
      eventId: asEventId("evt-runtime-warning"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-p1"),
      payload: {
        message: "Provider got slow",
        detail: { latencyMs: 1500 },
      },
    });

    harness.emit({
      type: "turn.diff.updated",
      eventId: asEventId("evt-turn-diff-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-p1"),
      itemId: asItemId("item-p1-assistant"),
      payload: {
        unifiedDiff: "diff --git a/file.txt b/file.txt\n+hello\n",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.title === "Renamed by provider" &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "turn.plan.updated",
        ) &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "tool.updated",
        ) &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "runtime.warning",
        ) &&
        entry.checkpoints.some(
          (checkpoint: ProviderRuntimeTestCheckpoint) => checkpoint.turnId === "turn-p1",
        ),
    );

    expect(thread.title).toBe("Renamed by provider");

    const planActivity = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-turn-plan-updated",
    );
    const planPayload =
      planActivity?.payload && typeof planActivity.payload === "object"
        ? (planActivity.payload as Record<string, unknown>)
        : undefined;
    expect(planActivity?.kind).toBe("turn.plan.updated");
    expect(Array.isArray(planPayload?.plan)).toBe(true);

    const toolUpdate = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-item-updated",
    );
    const toolUpdatePayload =
      toolUpdate?.payload && typeof toolUpdate.payload === "object"
        ? (toolUpdate.payload as Record<string, unknown>)
        : undefined;
    expect(toolUpdate?.kind).toBe("tool.updated");
    expect(toolUpdatePayload?.itemType).toBe("command_execution");
    expect(toolUpdatePayload?.status).toBe("in_progress");

    const warning = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-runtime-warning",
    );
    const warningPayload =
      warning?.payload && typeof warning.payload === "object"
        ? (warning.payload as Record<string, unknown>)
        : undefined;
    expect(warning?.kind).toBe("runtime.warning");
    expect(warningPayload?.message).toBe("Provider got slow");

    const checkpoint = thread.checkpoints.find(
      (entry: ProviderRuntimeTestCheckpoint) => entry.turnId === "turn-p1",
    );
    expect(checkpoint?.status).toBe("missing");
    expect(checkpoint?.assistantMessageId).toBe("assistant:item-p1-assistant");
    expect(checkpoint?.checkpointRef).toBe("provider-diff:evt-turn-diff-updated");
  });

  it("projects context window updates into normalized thread activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "thread.token-usage.updated",
      eventId: asEventId("evt-thread-token-usage-updated"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      payload: {
        usage: {
          usedTokens: 1075,
          totalProcessedTokens: 10_200,
          maxTokens: 128_000,
          inputTokens: 1000,
          cachedInputTokens: 500,
          outputTokens: 50,
          reasoningOutputTokens: 25,
          lastUsedTokens: 1075,
          lastInputTokens: 1000,
          lastCachedInputTokens: 500,
          lastOutputTokens: 50,
          lastReasoningOutputTokens: 25,
          compactsAutomatically: true,
        },
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "context-window.updated",
      ),
    );

    const usageActivity = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.kind === "context-window.updated",
    );
    expect(usageActivity).toBeDefined();
    expect(usageActivity?.payload).toMatchObject({
      usedTokens: 1075,
      totalProcessedTokens: 10_200,
      maxTokens: 128_000,
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 50,
      reasoningOutputTokens: 25,
      lastUsedTokens: 1075,
      compactsAutomatically: true,
    });
  });

  it("projects Codex camelCase token usage payloads into normalized thread activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "thread.token-usage.updated",
      eventId: asEventId("evt-thread-token-usage-updated-camel"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      payload: {
        usage: {
          usedTokens: 126,
          totalProcessedTokens: 11_839,
          maxTokens: 258_400,
          inputTokens: 120,
          cachedInputTokens: 0,
          outputTokens: 6,
          reasoningOutputTokens: 0,
          lastUsedTokens: 126,
          lastInputTokens: 120,
          lastCachedInputTokens: 0,
          lastOutputTokens: 6,
          lastReasoningOutputTokens: 0,
          compactsAutomatically: true,
        },
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "context-window.updated",
      ),
    );

    const usageActivity = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.kind === "context-window.updated",
    );
    expect(usageActivity?.payload).toMatchObject({
      usedTokens: 126,
      totalProcessedTokens: 11_839,
      maxTokens: 258_400,
      inputTokens: 120,
      cachedInputTokens: 0,
      outputTokens: 6,
      reasoningOutputTokens: 0,
      lastUsedTokens: 126,
      lastInputTokens: 120,
      lastOutputTokens: 6,
      compactsAutomatically: true,
    });
  });

  it("projects Claude usage snapshots with context window into normalized thread activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "thread.token-usage.updated",
      eventId: asEventId("evt-thread-token-usage-updated-claude-window"),
      provider: "claudeAgent",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      payload: {
        usage: {
          usedTokens: 31_251,
          lastUsedTokens: 31_251,
          maxTokens: 200_000,
          toolUses: 25,
          durationMs: 43_567,
        },
      },
      raw: {
        source: "claude.sdk.message",
        method: "claude/result/success",
        payload: {},
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "context-window.updated",
      ),
    );

    const usageActivity = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.kind === "context-window.updated",
    );
    expect(usageActivity?.payload).toMatchObject({
      usedTokens: 31_251,
      lastUsedTokens: 31_251,
      maxTokens: 200_000,
      toolUses: 25,
      durationMs: 43_567,
    });
  });

  it("projects compacted thread state into context compaction activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "thread.state.changed",
      eventId: asEventId("evt-thread-compacted"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-1"),
      payload: {
        state: "compacted",
        detail: { source: "provider" },
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "context-compaction",
      ),
    );

    const activity = thread.activities.find(
      (candidate: ProviderRuntimeTestActivity) => candidate.kind === "context-compaction",
    );
    expect(activity?.summary).toBe("Context compacted");
    expect(activity?.tone).toBe("info");
  });

  it("projects Codex task lifecycle chunks into thread activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "task.started",
      eventId: asEventId("evt-task-started"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-task-1"),
      payload: {
        taskId: "turn-task-1",
        taskType: "plan",
      },
    });

    harness.emit({
      type: "task.progress",
      eventId: asEventId("evt-task-progress"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-task-1"),
      payload: {
        taskId: "turn-task-1",
        description: "Comparing the desktop rollout chunks to the app-server stream.",
        summary: "Code reviewer is validating the desktop rollout chunks.",
      },
    });

    harness.emit({
      type: "task.completed",
      eventId: asEventId("evt-task-completed"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-task-1"),
      payload: {
        taskId: "turn-task-1",
        status: "completed",
        summary: "<proposed_plan>\n# Plan title\n</proposed_plan>",
      },
    });
    harness.emit({
      type: "turn.proposed.completed",
      eventId: asEventId("evt-task-proposed-plan-completed"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-task-1"),
      payload: {
        planMarkdown: "# Plan title",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "task.completed",
        ) &&
        entry.proposedPlans.some(
          (proposedPlan: ProviderRuntimeTestProposedPlan) =>
            proposedPlan.id === "plan:thread-1:turn:turn-task-1",
        ),
    );

    const started = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-task-started",
    );
    const progress = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-task-progress",
    );
    const completed = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-task-completed",
    );

    const progressPayload =
      progress?.payload && typeof progress.payload === "object"
        ? (progress.payload as Record<string, unknown>)
        : undefined;
    const completedPayload =
      completed?.payload && typeof completed.payload === "object"
        ? (completed.payload as Record<string, unknown>)
        : undefined;

    expect(started?.kind).toBe("task.started");
    expect(started?.summary).toBe("Plan task started");
    expect(progress?.kind).toBe("task.progress");
    expect(progress?.tone).toBe("thinking");
    expect(progress?.summary).toBe("Thinking");
    expect(progressPayload?.detail).toBe("Code reviewer is validating the desktop rollout chunks.");
    expect(progressPayload?.summary).toBe(
      "Code reviewer is validating the desktop rollout chunks.",
    );
    expect(completed?.kind).toBe("task.completed");
    expect(completedPayload?.detail).toBe("<proposed_plan>\n# Plan title\n</proposed_plan>");
    expect(
      thread.proposedPlans.find(
        (entry: ProviderRuntimeTestProposedPlan) => entry.id === "plan:thread-1:turn:turn-task-1",
      )?.planMarkdown,
    ).toBe("# Plan title");
  });

  it("projects reasoning deltas into thinking activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-thinking-delta-1"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-thinking-1"),
      itemId: "reasoning-item-1",
      payload: {
        streamKind: "reasoning_text",
        delta: "Need to inspect",
      },
    });

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-thinking-delta-2"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-thinking-1"),
      itemId: "reasoning-item-1",
      payload: {
        streamKind: "reasoning_summary_text",
        delta: " the ingestion path.",
        summaryIndex: 0,
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.id === "evt-thinking-delta-1",
        ) &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.id === "evt-thinking-delta-2",
        ),
    );

    const firstDelta = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-thinking-delta-1",
    );
    const secondDelta = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-thinking-delta-2",
    );

    const firstPayload =
      firstDelta?.payload && typeof firstDelta.payload === "object"
        ? (firstDelta.payload as Record<string, unknown>)
        : undefined;
    const secondPayload =
      secondDelta?.payload && typeof secondDelta.payload === "object"
        ? (secondDelta.payload as Record<string, unknown>)
        : undefined;

    expect(firstDelta?.tone).toBe("thinking");
    expect(firstDelta?.summary).toBe("Thinking");
    expect(firstDelta?.turnId).toBe("turn-thinking-1");
    expect(firstPayload).toMatchObject({
      text: "Need to inspect",
      streamKind: "reasoning_text",
      itemId: "reasoning-item-1",
    });

    expect(secondDelta?.tone).toBe("thinking");
    expect(secondPayload).toMatchObject({
      text: " the ingestion path.",
      streamKind: "reasoning_summary_text",
      itemId: "reasoning-item-1",
      summaryIndex: 0,
    });
  });

  it("projects structured user input request and resolution as thread activities", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "user-input.requested",
      eventId: asEventId("evt-user-input-requested"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-user-input"),
      requestId: ApprovalRequestId.makeUnsafe("req-user-input-1"),
      payload: {
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow workspace writes only",
              },
            ],
          },
        ],
      },
    });

    harness.emit({
      type: "user-input.resolved",
      eventId: asEventId("evt-user-input-resolved"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-user-input"),
      requestId: ApprovalRequestId.makeUnsafe("req-user-input-1"),
      payload: {
        answers: {
          sandbox_mode: "workspace-write",
        },
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "user-input.requested",
        ) &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "user-input.resolved",
        ),
    );

    const requested = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-user-input-requested",
    );
    expect(requested?.kind).toBe("user-input.requested");

    const resolved = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-user-input-resolved",
    );
    const resolvedPayload =
      resolved?.payload && typeof resolved.payload === "object"
        ? (resolved.payload as Record<string, unknown>)
        : undefined;
    expect(resolved?.kind).toBe("user-input.resolved");
    expect(resolvedPayload?.answers).toEqual({
      sandbox_mode: "workspace-write",
    });
  });

  it("routes pending user-input callbacks through the owner helper before local pending state appears", async () => {
    const threadEventIngestSpy = vi
      .spyOn(providerHarnessBridge, "requestAgentsVxappThreadEventIngest")
      .mockResolvedValue({});
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "user-input.requested",
      eventId: asEventId("evt-user-input-requested-owner"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-user-input-owner"),
      requestId: ApprovalRequestId.makeUnsafe("req-user-input-owner"),
      payload: {
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow workspace writes only",
              },
            ],
          },
        ],
      },
    });

    const thread = await waitForThread(harness.engine, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.kind === "user-input.requested",
      ),
    );

    expect(threadEventIngestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        requestId: "req-user-input-owner",
        requestType: "tool_user_input",
        state: "pending",
      }),
    );
    expect(thread.activities.some((activity) => activity.kind === "user-input.requested")).toBe(
      true,
    );
  });

  it("surfaces owner user-input failures instead of creating local pending prompts", async () => {
    vi.spyOn(providerHarnessBridge, "requestAgentsVxappThreadEventIngest").mockRejectedValue(
      new Error("owner user input request failed"),
    );
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "user-input.requested",
      eventId: asEventId("evt-user-input-requested-owner-fail"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-user-input-owner-fail"),
      requestId: ApprovalRequestId.makeUnsafe("req-user-input-owner-fail"),
      payload: {
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow workspace writes only",
              },
            ],
          },
        ],
      },
    });

    await harness.drain();
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.makeUnsafe("thread-1"));

    expect(thread?.activities.some((activity) => activity.kind === "user-input.requested")).toBe(
      false,
    );
    expect(
      thread?.activities.some((activity) => activity.kind === "provider.user-input.request.failed"),
    ).toBe(true);
  });

  it("continues processing runtime events after a single event handler failure", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-invalid-delta"),
      provider: "codex",
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-invalid"),
      itemId: asItemId("item-invalid"),
      payload: {
        streamKind: "assistant_text",
        delta: undefined,
      },
    } as unknown as ProviderRuntimeEvent);

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-after-failure"),
      provider: "codex",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-after-failure"),
      payload: {
        message: "runtime still processed",
      },
    });

    const thread = await waitForThread(
      harness.engine,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === "turn-after-failure" &&
        entry.session?.lastError === "runtime still processed",
    );
    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("runtime still processed");
  });

  it("invokes project hooks only for turn.completed runtime events", async () => {
    const handleTurnCompleted = vi.fn(() => Effect.void);
    const { emit, drain } = await createHarness({
      projectHooksLayer: Layer.succeed(ProjectHooksService, {
        prepareTurnStartCommand: (command) => Effect.succeed(command),
        handleTurnCompleted,
      }),
    });

    emit({
      type: "turn.started",
      eventId: asEventId("evt-project-hooks-turn-started"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-hooks-1"),
      createdAt: new Date().toISOString(),
      itemId: asItemId("item-hooks-1"),
      payload: {},
    } as unknown as ProviderRuntimeEvent);
    await drain();
    expect(handleTurnCompleted).not.toHaveBeenCalled();

    emit({
      type: "turn.completed",
      eventId: asEventId("evt-project-hooks-turn-completed"),
      provider: "codex",
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-hooks-1"),
      createdAt: new Date().toISOString(),
      payload: {
        state: "completed",
      },
    });
    await drain();

    expect(handleTurnCompleted).toHaveBeenCalledTimes(1);
    expect(handleTurnCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn.completed",
        turnId: asTurnId("turn-hooks-1"),
      }),
    );
  });
});
