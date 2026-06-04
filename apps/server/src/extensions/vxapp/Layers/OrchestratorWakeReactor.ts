import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Data, Effect, FileSystem, Layer, Stream } from "effect";

import { ProjectionTurnRepositoryLive } from "../../../persistence/Layers/ProjectionTurns.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../../persistence/Services/ProjectionTurns.ts";
import {
  requestAgentsVxappWakeDeliveryPlan,
  requestAgentsVxappWakeDrainReady,
  requestAgentsVxappWakeEnqueue,
  requestAgentsVxappWakeProviderRequest,
  requestAgentsVxappWakeReconcileStartup,
} from "../agentsVxappOwnerClient.ts";
import { ProviderService } from "../../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import {
  OrchestratorWakeReactor,
  type OrchestratorWakeReactorShape,
} from "../Services/OrchestratorWakeReactor.ts";

type WakeDomainEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.archived"
      | "thread.deleted"
      | "thread.turn-start-requested"
      | "thread.turn-diff-completed"
      | "thread.turn-interrupt-requested"
      | "thread.session-set"
      | "thread.unarchived"
      | "thread.orchestrator-wake-upserted";
  }
>;

type WakeReactorInput =
  | {
      readonly source: "runtime";
      readonly event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
    }
  | {
      readonly source: "domain";
      readonly event: WakeDomainEvent;
    };

const SUPPRESS_STARTUP_WAKE_ENV = "T3CODE_SUPPRESS_STARTUP_ORCHESTRATOR_WAKE";
const SUPPRESS_STARTUP_WAKE_MARKER_ENV = "T3CODE_SUPPRESS_STARTUP_ORCHESTRATOR_WAKE_MARKER";
const DEFAULT_SUPPRESS_STARTUP_WAKE_MARKER = "/tmp/t3code-vxapp-no-wake";

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:orchestrator-wake:${tag}:${crypto.randomUUID()}`);

function ownerErrorDetail(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "detail" in error &&
    typeof (error as { detail?: unknown }).detail === "string"
  ) {
    return (error as { detail: string }).detail;
  }
  return error instanceof Error ? error.message : "agents-vxapp owner command failed.";
}

class OwnerCommandFailure extends Data.TaggedError("OwnerCommandFailure")<{
  readonly detail: string;
}> {}

function wakeOutcomeFromCheckpoint(input: {
  readonly status: string;
  readonly files: ReadonlyArray<unknown>;
}): "failed" | "interrupted" | null {
  if (input.files.length === 0) {
    return null;
  }
  switch (input.status) {
    case "error":
      return "failed";
    case "missing":
      return "interrupted";
    case "ready":
      return null;
    default:
      throw new Error(`Unsupported checkpoint status for wake outcome: ${input.status}`);
  }
}

function wakeOutcomeFromLatestTurnState(
  state: string,
): "completed" | "failed" | "interrupted" | null {
  switch (state) {
    case "completed":
      return "completed";
    case "error":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function ownerThreadTurnStartCommandFromPayload(
  value: unknown,
  createdAt: string,
): OrchestrationCommand | null {
  const providerRequest = asRecord(value);
  if (!providerRequest || providerRequest.kind !== "thread.turn.start") {
    return null;
  }
  const requestId = asNonEmptyString(providerRequest.requestId);
  const threadId = asNonEmptyString(providerRequest.threadId);
  const message = asNonEmptyString(providerRequest.prompt ?? providerRequest.message);
  const messageId = asNonEmptyString(providerRequest.messageId);
  if (!requestId || !threadId || !message || !messageId) {
    return null;
  }
  return {
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(requestId),
    threadId: ThreadId.makeUnsafe(threadId),
    message: {
      messageId: MessageId.makeUnsafe(messageId),
      role: "user",
      text: message,
      attachments: [],
    },
    runtimeMode:
      providerRequest.runtimeMode === "approval-required" ? "approval-required" : "full-access",
    interactionMode: providerRequest.interactionMode === "plan" ? "plan" : "default",
    createdAt,
  };
}

function turnKey(threadId: ThreadId, turnId: TurnId): string {
  return `${threadId}:${turnId}`;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function buildWakeSummaryFromOutcome(input: {
  readonly workerThread: OrchestrationThread;
  readonly outcome: "completed" | "failed" | "interrupted";
}): string {
  switch (input.outcome) {
    case "failed":
      return `${input.workerThread.title} failed its turn`;
    case "interrupted":
      return `${input.workerThread.title} was interrupted`;
    case "completed":
      return `${input.workerThread.title} completed its assigned turn`;
  }
}

function isOrchestratorInactive(thread: OrchestrationThread): boolean {
  return isSessionWakeDrainable(thread.session);
}

function isSessionWakeDrainable(
  session:
    | {
        readonly activeTurnId: TurnId | null;
        readonly status: string;
      }
    | null
    | undefined,
): boolean {
  if (!session) {
    return true;
  }
  if (session.activeTurnId !== null) {
    return false;
  }
  return session.status !== "starting";
}

function findSupersedingTurnRequestedAt(input: {
  readonly turns: readonly ProjectionTurn[];
  readonly completedTurnId: TurnId;
  readonly completedAt: string;
  readonly activeTurnId: TurnId | null;
}): string | null {
  const completedTurnRequestedAt =
    input.turns.find((turn) => turn.turnId === input.completedTurnId)?.requestedAt ??
    input.completedAt;

  if (input.activeTurnId !== null && input.activeTurnId !== input.completedTurnId) {
    return (
      input.turns.find((turn) => turn.turnId === input.activeTurnId)?.requestedAt ??
      completedTurnRequestedAt
    );
  }

  const supersedingRequestedAts = input.turns
    .filter(
      (turn) =>
        turn.turnId !== input.completedTurnId && turn.requestedAt >= completedTurnRequestedAt,
    )
    .map((turn) => turn.requestedAt)
    .toSorted((left, right) => left.localeCompare(right));

  return supersedingRequestedAts[0] ?? null;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const fileSystem = yield* FileSystem.FileSystem;
  const drainingOrchestratorThreadIds = new Set<string>();
  const explicitlyInterruptedTurnKeys = new Set<string>();

  const appendWakeRejectedActivity = Effect.fn("appendWakeRejectedActivity")(function* (input: {
    readonly readModel: OrchestrationReadModel;
    readonly workerThread: OrchestrationThread;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly reason: string;
    readonly detail: string;
    readonly orchestratorThreadId?: ThreadId | undefined;
    readonly orchestratorProjectId?: OrchestrationThread["projectId"] | undefined;
  }) {
    yield* orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("rejected"),
        threadId: input.workerThread.id,
        activity: {
          id: EventId.makeUnsafe(`wake-rejected:${crypto.randomUUID()}`),
          tone: "error",
          kind: "orchestrator.wake.rejected",
          summary: "Worker wake rejected",
          payload: {
            reason: input.reason,
            detail: input.detail,
            ...(input.orchestratorThreadId !== undefined
              ? { orchestratorThreadId: input.orchestratorThreadId }
              : {}),
            ...(input.orchestratorProjectId !== undefined
              ? { orchestratorProjectId: input.orchestratorProjectId }
              : {}),
          },
          turnId: input.turnId,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      })
      .pipe(Effect.asVoid);
  });

  const requestWakeOwnerReconcile = Effect.fn("requestWakeOwnerReconcile")(function* (
    payload: Readonly<Record<string, unknown>>,
  ) {
    yield* Effect.tryPromise({
      try: () => requestAgentsVxappWakeReconcileStartup(payload),
      catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
    }).pipe(Effect.asVoid);
  });

  const enqueueWakeForSettledWorkerThread = Effect.fn("enqueueWakeForSettledWorkerThread")(
    function* (input: {
      readonly readModel: OrchestrationReadModel;
      readonly workerThread: OrchestrationThread;
      readonly turnId: TurnId;
      readonly outcome: "completed" | "failed" | "interrupted";
      readonly createdAt: string;
      readonly summary: string;
    }) {
      const { readModel, workerThread, turnId, outcome, createdAt } = input;
      if (
        workerThread.orchestratorThreadId === undefined ||
        workerThread.orchestratorProjectId === undefined
      ) {
        yield* appendWakeRejectedActivity({
          readModel,
          workerThread,
          turnId,
          createdAt,
          reason: "missing_orchestrator_lineage",
          detail: "Worker turn completed without a valid orchestrator target.",
        });
        return;
      }

      if (workerThread.workflowId === undefined) {
        yield* appendWakeRejectedActivity({
          readModel,
          workerThread,
          turnId,
          createdAt,
          reason: "missing_workflow_id",
          detail: "Worker turn completed without a workflowId.",
          orchestratorThreadId: workerThread.orchestratorThreadId,
          orchestratorProjectId: workerThread.orchestratorProjectId,
        });
        return;
      }

      if (
        workerThread.parentThreadId !== undefined &&
        workerThread.parentThreadId !== workerThread.orchestratorThreadId
      ) {
        yield* appendWakeRejectedActivity({
          readModel,
          workerThread,
          turnId,
          createdAt,
          reason: "parent_orchestrator_mismatch",
          detail: "Worker parentThreadId does not match orchestratorThreadId.",
          orchestratorThreadId: workerThread.orchestratorThreadId,
          orchestratorProjectId: workerThread.orchestratorProjectId,
        });
        return;
      }

      if (workerThread.orchestratorThreadId === workerThread.id) {
        yield* appendWakeRejectedActivity({
          readModel,
          workerThread,
          turnId,
          createdAt,
          reason: "worker_targets_itself",
          detail: "Worker lineage points back to the worker thread itself.",
          orchestratorThreadId: workerThread.orchestratorThreadId,
          orchestratorProjectId: workerThread.orchestratorProjectId,
        });
        return;
      }

      const orchestratorThread = readModel.threads.find(
        (entry) => entry.id === workerThread.orchestratorThreadId,
      );
      if (!orchestratorThread) {
        yield* appendWakeRejectedActivity({
          readModel,
          workerThread,
          turnId,
          createdAt,
          reason: "orchestrator_missing",
          detail: "Worker target orchestrator thread no longer exists.",
          orchestratorThreadId: workerThread.orchestratorThreadId,
          orchestratorProjectId: workerThread.orchestratorProjectId,
        });
        return;
      }

      if (orchestratorThread.projectId !== workerThread.orchestratorProjectId) {
        yield* appendWakeRejectedActivity({
          readModel,
          workerThread,
          turnId,
          createdAt,
          reason: "orchestrator_mismatch",
          detail: "Worker target orchestrator project does not match the recorded lineage.",
          orchestratorThreadId: workerThread.orchestratorThreadId,
          orchestratorProjectId: workerThread.orchestratorProjectId,
        });
        return;
      }

      const turns = yield* projectionTurnRepository.listByThreadId({
        threadId: workerThread.id,
      });
      const supersededAt = findSupersedingTurnRequestedAt({
        turns,
        completedTurnId: turnId,
        completedAt: createdAt,
        activeTurnId: workerThread.session?.activeTurnId ?? null,
      });
      yield* Effect.tryPromise({
        try: () =>
          requestAgentsVxappWakeEnqueue({
            orchestratorThreadId: workerThread.orchestratorThreadId,
            orchestratorProjectId: workerThread.orchestratorProjectId,
            programId: workerThread.programId,
            workerThreadId: workerThread.id,
            workerProjectId: workerThread.projectId,
            workerTurnId: turnId,
            workflowId: workerThread.workflowId,
            workerTitleSnapshot: workerThread.title,
            outcome,
            summary: input.summary,
            queuedAt: createdAt,
            ...(supersededAt !== null
              ? { consumeReason: "worker_superseded_by_new_turn", consumedAt: supersededAt }
              : {}),
          }),
        catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
      });
      if (supersededAt === null) {
        yield* evaluateDrainForOrchestrator(workerThread.orchestratorThreadId);
      }
    },
  );

  const enqueueWakeFromTerminalTurnDiff = Effect.fn("enqueueWakeFromTerminalTurnDiff")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) {
    const turnId = event.payload.turnId;
    const outcome = wakeOutcomeFromCheckpoint({
      status: event.payload.status,
      files: event.payload.files,
    });
    if (outcome === null) {
      return;
    }

    if (explicitlyInterruptedTurnKeys.has(turnKey(event.payload.threadId, turnId))) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const workerThread = readModel.threads.find((entry) => entry.id === event.payload.threadId);
    if (!workerThread || workerThread.spawnRole !== "worker") {
      return;
    }
    if (workerThread.archivedAt !== null || workerThread.deletedAt !== null) {
      return;
    }

    if (
      workerThread.orchestratorThreadId === undefined ||
      workerThread.orchestratorProjectId === undefined
    ) {
      yield* appendWakeRejectedActivity({
        readModel,
        workerThread,
        turnId,
        createdAt: event.payload.completedAt,
        reason: "missing_orchestrator_lineage",
        detail: "Worker turn completed without a valid orchestrator target.",
      });
      return;
    }

    if (workerThread.workflowId === undefined) {
      yield* appendWakeRejectedActivity({
        readModel,
        workerThread,
        turnId,
        createdAt: event.payload.completedAt,
        reason: "missing_workflow_id",
        detail: "Worker turn completed without a workflowId.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    if (
      workerThread.parentThreadId !== undefined &&
      workerThread.parentThreadId !== workerThread.orchestratorThreadId
    ) {
      yield* appendWakeRejectedActivity({
        readModel,
        workerThread,
        turnId,
        createdAt: event.payload.completedAt,
        reason: "parent_orchestrator_mismatch",
        detail: "Worker parentThreadId does not match orchestratorThreadId.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    if (workerThread.orchestratorThreadId === workerThread.id) {
      yield* appendWakeRejectedActivity({
        readModel,
        workerThread,
        turnId,
        createdAt: event.payload.completedAt,
        reason: "worker_targets_itself",
        detail: "Worker lineage points back to the worker thread itself.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    const orchestratorThread = readModel.threads.find(
      (entry) => entry.id === workerThread.orchestratorThreadId,
    );
    if (!orchestratorThread) {
      yield* appendWakeRejectedActivity({
        readModel,
        workerThread,
        turnId,
        createdAt: event.payload.completedAt,
        reason: "orchestrator_missing",
        detail: "Worker target orchestrator thread no longer exists.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    if (orchestratorThread.projectId !== workerThread.orchestratorProjectId) {
      yield* appendWakeRejectedActivity({
        readModel,
        workerThread,
        turnId,
        createdAt: event.payload.completedAt,
        reason: "orchestrator_mismatch",
        detail: "Worker target orchestrator project does not match the recorded lineage.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: workerThread.id,
    });
    const supersededAt = findSupersedingTurnRequestedAt({
      turns,
      completedTurnId: turnId,
      completedAt: event.payload.completedAt,
      activeTurnId: workerThread.session?.activeTurnId ?? null,
    });
    yield* Effect.tryPromise({
      try: () =>
        requestAgentsVxappWakeEnqueue({
          orchestratorThreadId: workerThread.orchestratorThreadId,
          orchestratorProjectId: workerThread.orchestratorProjectId,
          programId: workerThread.programId,
          workerThreadId: workerThread.id,
          workerProjectId: workerThread.projectId,
          workerTurnId: turnId,
          workflowId: workerThread.workflowId,
          workerTitleSnapshot: workerThread.title,
          outcome,
          summary: buildWakeSummaryFromOutcome({ workerThread, outcome }),
          queuedAt: event.payload.completedAt,
          ...(supersededAt !== null
            ? { consumeReason: "worker_superseded_by_new_turn", consumedAt: supersededAt }
            : {}),
        }),
      catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
    });
    if (supersededAt === null) {
      yield* evaluateDrainForOrchestrator(workerThread.orchestratorThreadId);
    }
  });

  const enqueueWakeFromWorkerSessionSet = Effect.fn("enqueueWakeFromWorkerSessionSet")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.session-set" }>,
  ) {
    if (!isSessionWakeDrainable(event.payload.session)) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const workerThread = readModel.threads.find((entry) => entry.id === event.payload.threadId);
    if (!workerThread || workerThread.spawnRole !== "worker") {
      return;
    }
    if (workerThread.archivedAt !== null || workerThread.deletedAt !== null) {
      return;
    }

    const latestTurn = workerThread.latestTurn;
    if (!latestTurn?.completedAt) {
      return;
    }

    const outcome = wakeOutcomeFromLatestTurnState(latestTurn.state);
    if (outcome === null) {
      return;
    }

    yield* enqueueWakeForSettledWorkerThread({
      readModel,
      workerThread,
      turnId: latestTurn.turnId,
      outcome,
      createdAt: latestTurn.completedAt,
      summary: buildWakeSummaryFromOutcome({ workerThread, outcome }),
    });
  });

  const consumeDeliveringWakeItemsForCompletedReviewTurn = Effect.fn(
    "consumeDeliveringWakeItemsForCompletedReviewTurn",
  )(function* (event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>) {
    const turnId = event.turnId;
    if (turnId === undefined) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const orchestratorThread = readModel.threads.find((entry) => entry.id === event.threadId);
    if (!orchestratorThread || orchestratorThread.spawnRole === "worker") {
      return;
    }
    if (orchestratorThread.archivedAt !== null || orchestratorThread.deletedAt !== null) {
      return;
    }

    yield* requestWakeOwnerReconcile({
      orchestratorThreadId: orchestratorThread.id,
      providerTurnId: turnId,
      completedAt: event.createdAt,
      reason: "provider_turn_completed",
    });
    yield* evaluateDrainForOrchestrator(orchestratorThread.id);
  });

  const consumeActiveWakeItemsForWorker = Effect.fn("consumeActiveWakeItemsForWorker")(
    function* (input: {
      readonly workerThreadId: ThreadId;
      readonly consumedAt: string;
      readonly consumeReason:
        | "worker_deleted"
        | "worker_rechecked"
        | "worker_superseded_by_new_turn";
    }) {
      yield* requestWakeOwnerReconcile({
        workerThreadId: input.workerThreadId,
        consumedAt: input.consumedAt,
        consumeReason: input.consumeReason,
      });
    },
  );

  const recheckWakeItemsForArchivedWorker = Effect.fn("recheckWakeItemsForArchivedWorker")(
    function* (input: { readonly workerThreadId: ThreadId; readonly archivedAt: string }) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const workerThread = readModel.threads.find((entry) => entry.id === input.workerThreadId);
      yield* requestWakeOwnerReconcile({
        workerThreadId: input.workerThreadId,
        archivedAt: input.archivedAt,
        consumeReason: "worker_rechecked",
      });
      if (workerThread?.orchestratorThreadId !== undefined) {
        yield* evaluateDrainForOrchestrator(workerThread.orchestratorThreadId);
      }
    },
  );

  const evaluateDrainForOrchestrator = Effect.fn("evaluateDrainForOrchestrator")(function* (
    orchestratorThreadId: ThreadId,
  ) {
    if (drainingOrchestratorThreadIds.has(orchestratorThreadId)) {
      return;
    }

    drainingOrchestratorThreadIds.add(orchestratorThreadId);
    const finalize = Effect.sync(() => {
      drainingOrchestratorThreadIds.delete(orchestratorThreadId);
    });

    const drainEffect = Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const orchestratorThread = readModel.threads.find(
        (entry) => entry.id === orchestratorThreadId,
      );
      if (
        !orchestratorThread ||
        orchestratorThread.deletedAt !== null ||
        orchestratorThread.archivedAt !== null ||
        !isOrchestratorInactive(orchestratorThread)
      ) {
        return;
      }

      const deliveryPlan = yield* Effect.tryPromise({
        try: () => requestAgentsVxappWakeDeliveryPlan({ orchestratorThreadId }),
        catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
      });
      const deliveryPlanStatus = asNonEmptyString(deliveryPlan.status);
      if (deliveryPlanStatus !== "ready") {
        return;
      }

      yield* Effect.tryPromise({
        try: () => requestAgentsVxappWakeDrainReady({ orchestratorThreadId }),
        catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
      });

      const providerPayload = yield* Effect.tryPromise({
        try: () => requestAgentsVxappWakeProviderRequest({ orchestratorThreadId }),
        catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
      });
      if (providerPayload.providerRequestStatus === "blocked") {
        yield* Effect.logWarning("owner blocked orchestrator wake provider request", {
          orchestratorThreadId,
          failureCode: providerPayload.failureCode,
          failureMessage: providerPayload.failureMessage,
        });
        return;
      }
      const createdAt = new Date().toISOString();
      const command = ownerThreadTurnStartCommandFromPayload(
        providerPayload.providerRequest,
        createdAt,
      );
      if (!command) {
        yield* Effect.logWarning("owner wake provider request failed closed", {
          orchestratorThreadId,
        });
        return;
      }

      const dispatchResult = yield* Effect.exit(orchestrationEngine.dispatch(command));

      if (dispatchResult._tag === "Failure") {
        yield* Effect.logWarning("owner wake provider request dispatch failed", {
          orchestratorThreadId,
          cause: Cause.pretty(dispatchResult.cause),
        });
      }
    });

    yield* drainEffect.pipe(Effect.ensuring(finalize));
  });

  const processDomainEvent = (event: WakeDomainEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.archived":
          yield* recheckWakeItemsForArchivedWorker({
            workerThreadId: event.payload.threadId,
            archivedAt: event.payload.archivedAt,
          });
          return;
        case "thread.deleted":
          yield* consumeActiveWakeItemsForWorker({
            workerThreadId: event.payload.threadId,
            consumedAt: event.payload.deletedAt,
            consumeReason: "worker_deleted",
          });
          yield* evaluateDrainForOrchestrator(event.payload.threadId);
          return;
        case "thread.turn-start-requested":
          {
            const readModel = yield* orchestrationEngine.getReadModel();
            const thread = readModel.threads.find((entry) => entry.id === event.payload.threadId);
            if (thread?.spawnRole === "worker") {
              yield* consumeActiveWakeItemsForWorker({
                workerThreadId: event.payload.threadId,
                consumedAt: event.payload.createdAt,
                consumeReason: "worker_superseded_by_new_turn",
              });
            }
          }
          return;
        case "thread.turn-interrupt-requested":
          if (event.payload.turnId !== undefined) {
            explicitlyInterruptedTurnKeys.add(
              turnKey(event.payload.threadId, event.payload.turnId),
            );
          }
          return;
        case "thread.turn-diff-completed":
          yield* enqueueWakeFromTerminalTurnDiff(event);
          return;
        case "thread.session-set":
          yield* enqueueWakeFromWorkerSessionSet(event);
          if (isSessionWakeDrainable(event.payload.session)) {
            yield* requestWakeOwnerReconcile({
              orchestratorThreadId: event.payload.threadId,
              settledAt: event.payload.session.updatedAt,
              reason: "session_settled",
            });
          }
          yield* evaluateDrainForOrchestrator(event.payload.threadId);
          return;
        case "thread.unarchived":
          yield* evaluateDrainForOrchestrator(event.payload.threadId);
          return;
        case "thread.orchestrator-wake-upserted":
          if (event.payload.wakeItem.state === "pending") {
            yield* evaluateDrainForOrchestrator(event.payload.wakeItem.orchestratorThreadId);
          }
          return;
      }
    });

  const processInput = (input: WakeReactorInput) =>
    input.source === "runtime"
      ? consumeDeliveringWakeItemsForCompletedReviewTurn(input.event)
      : processDomainEvent(input.event);

  const processInputSafely = (input: WakeReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("orchestrator wake reactor failed to process input", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const shouldSuppressStartupWakeReconciliation = Effect.gen(function* () {
    if (isTruthyEnv(process.env[SUPPRESS_STARTUP_WAKE_ENV])) {
      return true;
    }

    const markerPath =
      process.env[SUPPRESS_STARTUP_WAKE_MARKER_ENV] ?? DEFAULT_SUPPRESS_STARTUP_WAKE_MARKER;
    const markerExists = yield* fileSystem
      .exists(markerPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!markerExists) {
      return false;
    }

    yield* fileSystem.remove(markerPath).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to remove startup orchestrator wake suppression marker", {
          markerPath,
          cause: Cause.pretty(cause),
        }),
      ),
    );
    return true;
  });

  const _reconcileWakesOnStart = Effect.gen(function* () {
    const suppressStartupReconciliation = yield* shouldSuppressStartupWakeReconciliation;
    if (suppressStartupReconciliation) {
      yield* Effect.logInfo("orchestrator wake startup reconciliation suppressed");
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const activeOrchestratorThreadIds = [
      ...new Set(
        readModel.threads
          .filter(
            (thread) =>
              thread.spawnRole !== "worker" &&
              thread.archivedAt === null &&
              thread.deletedAt === null,
          )
          .map((thread) => thread.id),
      ),
    ];
    yield* Effect.forEach(
      activeOrchestratorThreadIds,
      (orchestratorThreadId) =>
        requestWakeOwnerReconcile({
          orchestratorThreadId,
          reason: "startup",
        }).pipe(Effect.flatMap(() => evaluateDrainForOrchestrator(orchestratorThreadId))),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  }).pipe(
    Effect.catchCause((cause) => {
      return Effect.logWarning("orchestrator wake reactor failed to reconcile startup wakes", {
        cause: Cause.pretty(cause),
      });
    }),
  );

  const start: OrchestratorWakeReactorShape["start"] = Effect.fn("start")(function* () {
    // Startup wake reconciliation is best-effort owner synchronization. It
    // must not block the HTTP/WebSocket listener from binding.
    yield* Effect.forkScoped(_reconcileWakesOnStart);

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.archived" &&
          event.type !== "thread.deleted" &&
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.turn-diff-completed" &&
          event.type !== "thread.turn-interrupt-requested" &&
          event.type !== "thread.session-set" &&
          event.type !== "thread.unarchived" &&
          event.type !== "thread.orchestrator-wake-upserted"
        ) {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.completed") {
          return Effect.void;
        }
        return worker.enqueue({ source: "runtime", event });
      }),
    );
  });

  return {
    start,
  } satisfies OrchestratorWakeReactorShape;
});

export const OrchestratorWakeReactorLive = Layer.effect(OrchestratorWakeReactor, make).pipe(
  Layer.provideMerge(ProjectionTurnRepositoryLive),
);
