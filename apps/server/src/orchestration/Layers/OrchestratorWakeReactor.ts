import {
  CommandId,
  EventId,
  MessageId,
  type OrchestratorWakeItem,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import { ProjectionOrchestratorWakeRepositoryLive } from "../../persistence/Layers/ProjectionOrchestratorWakes.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import {
  ProjectionOrchestratorWake,
  ProjectionOrchestratorWakeRepository,
} from "../../persistence/Services/ProjectionOrchestratorWakes.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
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

const MAX_WAKE_BATCH_SIZE = 5;

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:orchestrator-wake:${tag}:${crypto.randomUUID()}`);

function normalizeWakeOutcome(
  state: "completed" | "failed" | "interrupted" | "cancelled",
): "completed" | "failed" | "interrupted" | null {
  switch (state) {
    case "completed":
    case "failed":
    case "interrupted":
      return state;
    default:
      return null;
  }
}

function toWakeItem(input: {
  readonly wakeId: string;
  readonly orchestratorThreadId: ThreadId;
  readonly orchestratorProjectId: OrchestrationThread["projectId"];
  readonly workerThread: OrchestrationThread;
  readonly workerTurnId: TurnId;
  readonly outcome: "completed" | "failed" | "interrupted";
  readonly summary: string;
  readonly queuedAt: string;
}): OrchestratorWakeItem {
  return {
    wakeId: input.wakeId,
    orchestratorThreadId: input.orchestratorThreadId,
    orchestratorProjectId: input.orchestratorProjectId,
    workerThreadId: input.workerThread.id,
    workerProjectId: input.workerThread.projectId,
    workerTurnId: input.workerTurnId,
    ...(input.workerThread.workflowId !== undefined
      ? { workflowId: input.workerThread.workflowId }
      : {}),
    workerTitleSnapshot: input.workerThread.title,
    outcome: input.outcome,
    summary: input.summary,
    queuedAt: input.queuedAt,
    state: "pending",
    deliveredAt: null,
    consumedAt: null,
  };
}

function buildWakeSummary(input: {
  readonly workerThread: OrchestrationThread;
  readonly outcome: "completed" | "failed" | "interrupted";
  readonly runtimeEvent: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
}): string {
  const title = input.workerThread.title;
  switch (input.outcome) {
    case "failed":
      return input.runtimeEvent.payload.errorMessage?.trim() || `${title} failed its turn`;
    case "interrupted":
      return input.runtimeEvent.payload.errorMessage?.trim() || `${title} was interrupted`;
    case "completed":
      return `${title} completed its assigned turn`;
  }
}

function isOrchestratorInactive(thread: OrchestrationThread): boolean {
  const session = thread.session;
  if (!session) {
    return true;
  }
  if (session.activeTurnId !== null) {
    return false;
  }
  return session.status !== "starting" && session.status !== "running";
}

function buildOrchestratorWakePrompt(items: readonly OrchestratorWakeItem[]): string {
  const lines = items.map(
    (item) => `- ${item.workerTitleSnapshot} - ${item.outcome} - ${item.summary}`,
  );
  return [
    "Worker updates are ready for review.",
    "",
    "Pending worker outcomes:",
    ...lines,
    "",
    "Review the worker threads, decide next actions, and continue orchestration.",
  ].join("\n");
}

function projectionWakeRowToWakeItem(wake: ProjectionOrchestratorWake): OrchestratorWakeItem {
  return {
    wakeId: wake.wakeId,
    orchestratorThreadId: wake.orchestratorThreadId,
    orchestratorProjectId: wake.orchestratorProjectId,
    workerThreadId: wake.workerThreadId,
    workerProjectId: wake.workerProjectId,
    workerTurnId: wake.workerTurnId,
    ...(wake.workflowId !== null ? { workflowId: wake.workflowId } : {}),
    workerTitleSnapshot: wake.workerTitleSnapshot,
    outcome: wake.outcome,
    summary: wake.summary,
    queuedAt: wake.queuedAt,
    state: wake.state,
    ...(wake.deliveryMessageId !== null ? { deliveryMessageId: wake.deliveryMessageId } : {}),
    deliveredAt: wake.deliveredAt,
    consumedAt: wake.consumedAt,
    ...(wake.consumeReason !== null ? { consumeReason: wake.consumeReason } : {}),
  };
}

function compareProjectionWakeRows(
  left: ProjectionOrchestratorWake,
  right: ProjectionOrchestratorWake,
): number {
  return left.queuedAt.localeCompare(right.queuedAt) || left.wakeId.localeCompare(right.wakeId);
}

function compareWakeItems(left: OrchestratorWakeItem, right: OrchestratorWakeItem): number {
  return left.queuedAt.localeCompare(right.queuedAt) || left.wakeId.localeCompare(right.wakeId);
}

function isWorkerWakeActiveState(state: OrchestratorWakeItem["state"]): boolean {
  return state === "pending" || state === "delivering" || state === "delivered";
}

function findTerminalDeliveryTurn(input: {
  readonly turns: readonly ProjectionTurn[];
  readonly deliveryMessageId: MessageId | null | undefined;
}): ProjectionTurn | undefined {
  if (input.deliveryMessageId === null || input.deliveryMessageId === undefined) {
    return undefined;
  }

  return input.turns.find(
    (turn) =>
      turn.pendingMessageId === input.deliveryMessageId &&
      (turn.state === "completed" || turn.state === "error" || turn.state === "interrupted"),
  );
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
        turn.turnId !== input.completedTurnId &&
        turn.requestedAt >= completedTurnRequestedAt,
    )
    .map((turn) => turn.requestedAt)
    .toSorted((left, right) => left.localeCompare(right));

  return supersedingRequestedAts[0] ?? null;
}

function partitionPendingWakeRowsForDelivery(rows: readonly ProjectionOrchestratorWake[]): {
  readonly deliverableRows: ReadonlyArray<ProjectionOrchestratorWake>;
  readonly duplicateRows: ReadonlyArray<ProjectionOrchestratorWake>;
} {
  const latestByWorkerThreadId = new Map<string, ProjectionOrchestratorWake>();

  for (const row of rows) {
    const current = latestByWorkerThreadId.get(row.workerThreadId);
    if (!current || compareProjectionWakeRows(current, row) <= 0) {
      latestByWorkerThreadId.set(row.workerThreadId, row);
    }
  }

  const deliverableWakeIds = new Set([...latestByWorkerThreadId.values()].map((row) => row.wakeId));

  return {
    deliverableRows: rows
      .filter((row) => deliverableWakeIds.has(row.wakeId))
      .toSorted(compareProjectionWakeRows),
    duplicateRows: rows.filter((row) => !deliverableWakeIds.has(row.wakeId)),
  };
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const wakeRepository = yield* ProjectionOrchestratorWakeRepository;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const drainingOrchestratorThreadIds = new Set<string>();

  const appendWakeRejectedActivity = Effect.fn("appendWakeRejectedActivity")(function* (input: {
    readonly threadId: ThreadId;
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
        threadId: input.threadId,
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

  const dispatchWakeUpsert = Effect.fn("dispatchWakeUpsert")(function* (input: {
    readonly preferredThreadId: ThreadId;
    readonly wakeItem: OrchestratorWakeItem;
    readonly createdAt: string;
    readonly commandTag: string;
  }) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const aggregateThreadId =
      readModel.threads.find((entry) => entry.id === input.preferredThreadId)?.id ??
      readModel.threads.find((entry) => entry.id === input.wakeItem.orchestratorThreadId)?.id ??
      readModel.threads.find((entry) => entry.id === input.wakeItem.workerThreadId)?.id;
    if (!aggregateThreadId) {
      yield* Effect.logWarning("orchestrator wake upsert skipped because no anchor thread exists", {
        wakeId: input.wakeItem.wakeId,
        preferredThreadId: input.preferredThreadId,
        orchestratorThreadId: input.wakeItem.orchestratorThreadId,
        workerThreadId: input.wakeItem.workerThreadId,
        targetState: input.wakeItem.state,
      });
      return;
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.orchestrator-wake.upsert",
        commandId: serverCommandId(input.commandTag),
        threadId: aggregateThreadId,
        wakeItem: input.wakeItem,
        createdAt: input.createdAt,
      })
      .pipe(Effect.asVoid);
  });

  const enqueueWakeFromCompletedTurn = Effect.fn("enqueueWakeFromCompletedTurn")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) {
    const turnId = event.turnId;
    if (turnId === undefined) {
      return;
    }

    const outcome = normalizeWakeOutcome(event.payload.state);
    if (outcome === null) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const workerThread = readModel.threads.find((entry) => entry.id === event.threadId);
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
        threadId: workerThread.id,
        turnId,
        createdAt: event.createdAt,
        reason: "missing_orchestrator_lineage",
        detail: "Worker turn completed without a valid orchestrator target.",
      });
      return;
    }

    if (workerThread.orchestratorThreadId === workerThread.id) {
      yield* appendWakeRejectedActivity({
        threadId: workerThread.id,
        turnId,
        createdAt: event.createdAt,
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
        threadId: workerThread.id,
        turnId,
        createdAt: event.createdAt,
        reason: "orchestrator_missing",
        detail: "Worker target orchestrator thread no longer exists.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    if (orchestratorThread.projectId !== workerThread.orchestratorProjectId) {
      yield* appendWakeRejectedActivity({
        threadId: workerThread.id,
        turnId,
        createdAt: event.createdAt,
        reason: "orchestrator_mismatch",
        detail: "Worker target orchestrator project does not match the recorded lineage.",
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
      });
      return;
    }

    const wakeId = `wake:${workerThread.id}:${turnId}:${outcome}`;
    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: workerThread.id,
    });
    const supersededAt = findSupersedingTurnRequestedAt({
      turns,
      completedTurnId: turnId,
      completedAt: event.createdAt,
      activeTurnId: workerThread.session?.activeTurnId ?? null,
    });
    const wakeItem = toWakeItem({
      wakeId,
      orchestratorThreadId: workerThread.orchestratorThreadId,
      orchestratorProjectId: workerThread.orchestratorProjectId,
      workerThread,
      workerTurnId: turnId,
      outcome,
      summary: buildWakeSummary({ workerThread, outcome, runtimeEvent: event }),
      queuedAt: event.createdAt,
    });
    yield* dispatchWakeUpsert({
      preferredThreadId: workerThread.orchestratorThreadId,
      wakeItem:
        supersededAt === null
          ? wakeItem
          : {
              ...wakeItem,
              state: "consumed",
              consumedAt: supersededAt,
              consumeReason: "worker_superseded_by_new_turn",
            },
      createdAt: supersededAt ?? event.createdAt,
      commandTag: supersededAt === null ? "upsert" : "upsert-superseded",
    });
  });

  const consumeActiveWakeItemsForWorker = Effect.fn("consumeActiveWakeItemsForWorker")(
    function* (input: {
      readonly workerThreadId: ThreadId;
      readonly consumedAt: string;
      readonly consumeReason:
        | "worker_deleted"
        | "worker_rechecked"
        | "worker_superseded_by_new_turn";
      readonly commandTag: string;
    }) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const wakeItems = readModel.orchestratorWakeItems
        .filter(
          (wakeItem) =>
            wakeItem.workerThreadId === input.workerThreadId &&
            isWorkerWakeActiveState(wakeItem.state),
        )
        .toSorted(compareWakeItems);
      if (wakeItems.length === 0) {
        return;
      }

      yield* Effect.forEach(
        wakeItems,
        (wakeItem) =>
          dispatchWakeUpsert({
            preferredThreadId: wakeItem.orchestratorThreadId,
            wakeItem: {
              ...wakeItem,
              state: "consumed",
              consumedAt: input.consumedAt,
              consumeReason: input.consumeReason,
            },
            createdAt: input.consumedAt,
            commandTag: input.commandTag,
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    },
  );

  const finalizeDeliveringWakeItemsForOrchestrator = Effect.fn(
    "finalizeDeliveringWakeItemsForOrchestrator",
  )(function* (input: { readonly orchestratorThreadId: ThreadId; readonly settledAt: string }) {
    const rows = yield* wakeRepository.listByOrchestratorThreadId({
      orchestratorThreadId: input.orchestratorThreadId,
    });
    const deliveringRows = rows.filter((row) => row.state === "delivering");
    if (deliveringRows.length === 0) {
      return;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: input.orchestratorThreadId,
    });

    yield* Effect.forEach(
      deliveringRows,
      (row) => {
        const deliveryTurn = findTerminalDeliveryTurn({
          turns,
          deliveryMessageId: row.deliveryMessageId,
        });
        const deliveredAt =
          row.deliveredAt ??
          deliveryTurn?.completedAt ??
          deliveryTurn?.startedAt ??
          input.settledAt;

        return dispatchWakeUpsert({
          preferredThreadId: input.orchestratorThreadId,
          wakeItem: {
            ...projectionWakeRowToWakeItem(row),
            state: deliveryTurn ? "consumed" : "delivered",
            deliveredAt,
            consumedAt: deliveryTurn ? input.settledAt : null,
            ...(deliveryTurn ? { consumeReason: "worker_rechecked" as const } : {}),
          },
          createdAt: input.settledAt,
          commandTag: deliveryTurn ? "consumed-reviewed" : "delivered",
        });
      },
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  });

  const consumeReviewedDeliveredWakeItemsForOrchestrator = Effect.fn(
    "consumeReviewedDeliveredWakeItemsForOrchestrator",
  )(function* (input: { readonly orchestratorThreadId: ThreadId; readonly consumedAt: string }) {
    const rows = yield* wakeRepository.listByOrchestratorThreadId({
      orchestratorThreadId: input.orchestratorThreadId,
    });
    const deliveredRows = rows.filter(
      (row) => row.state === "delivered" && row.consumedAt === null,
    );
    if (deliveredRows.length === 0) {
      return;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: input.orchestratorThreadId,
    });

    yield* Effect.forEach(
      deliveredRows,
      (row) => {
        const deliveryTurn = findTerminalDeliveryTurn({
          turns,
          deliveryMessageId: row.deliveryMessageId,
        });
        if (!deliveryTurn) {
          return Effect.void;
        }

        return dispatchWakeUpsert({
          preferredThreadId: input.orchestratorThreadId,
          wakeItem: {
            ...projectionWakeRowToWakeItem(row),
            state: "consumed",
            deliveredAt: row.deliveredAt ?? deliveryTurn.completedAt ?? deliveryTurn.startedAt,
            consumedAt: input.consumedAt,
            consumeReason: "worker_rechecked",
          },
          createdAt: input.consumedAt,
          commandTag: "consume-reviewed",
        });
      },
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  });

  const reconcileDeliveringWakeItemsForOrchestrator = Effect.fn(
    "reconcileDeliveringWakeItemsForOrchestrator",
  )(function* (orchestratorThreadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const orchestratorThread = readModel.threads.find((entry) => entry.id === orchestratorThreadId);
    const rows = yield* wakeRepository.listByOrchestratorThreadId({
      orchestratorThreadId,
    });
    const deliveringRows = rows.filter((row) => row.state === "delivering");
    if (deliveringRows.length === 0) {
      return;
    }

    if (!orchestratorThread || orchestratorThread.deletedAt !== null) {
      const consumedAt = new Date().toISOString();
      yield* Effect.forEach(
        deliveringRows,
        (row) =>
          dispatchWakeUpsert({
            preferredThreadId: row.orchestratorThreadId,
            wakeItem: {
              ...projectionWakeRowToWakeItem(row),
              state: "dropped",
              consumedAt,
              consumeReason: orchestratorThread ? "orchestrator_deleted" : "orchestrator_missing",
            },
            createdAt: consumedAt,
            commandTag: "startup-drop",
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      return;
    }

    if (!isOrchestratorInactive(orchestratorThread)) {
      return;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: orchestratorThreadId,
    });

    yield* Effect.forEach(
      deliveringRows,
      (row) =>
        Effect.gen(function* () {
          const deliveryTurn =
            row.deliveryMessageId === null
              ? undefined
              : turns.find(
                  (turn) =>
                    turn.turnId !== null &&
                    turn.pendingMessageId === row.deliveryMessageId &&
                    (turn.state === "completed" ||
                      turn.state === "error" ||
                      turn.state === "interrupted"),
                );

          if (deliveryTurn) {
            yield* dispatchWakeUpsert({
              preferredThreadId: orchestratorThreadId,
              wakeItem: {
                ...projectionWakeRowToWakeItem(row),
                state: "consumed",
                deliveredAt:
                  deliveryTurn.completedAt ??
                  deliveryTurn.startedAt ??
                  orchestratorThread.updatedAt,
                consumedAt: orchestratorThread.updatedAt,
                consumeReason: "worker_rechecked",
              },
              createdAt: orchestratorThread.updatedAt,
              commandTag: "startup-consumed-reviewed",
            });
            return;
          }

          const wakeItem = projectionWakeRowToWakeItem(row);
          const { deliveryMessageId: _deliveryMessageId, ...wakeWithoutDeliveryMessageId } =
            wakeItem;
          yield* dispatchWakeUpsert({
            preferredThreadId: orchestratorThreadId,
            wakeItem: {
              ...wakeWithoutDeliveryMessageId,
              state: "pending",
              deliveredAt: null,
              consumedAt: null,
            },
            createdAt: new Date().toISOString(),
            commandTag: "startup-redeliver",
          });
        }),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  });

  const evaluateDrainForOrchestrator = Effect.fn("evaluateDrainForOrchestrator")(function* (
    orchestratorThreadId: ThreadId,
  ) {
    if (drainingOrchestratorThreadIds.has(orchestratorThreadId)) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const orchestratorThread = readModel.threads.find((entry) => entry.id === orchestratorThreadId);
    const allRows = yield* wakeRepository.listByOrchestratorThreadId({
      orchestratorThreadId,
    });
    const pendingRows = allRows.filter((row) => row.state === "pending");
    if (pendingRows.length === 0) {
      return;
    }

    if (allRows.some((row) => row.state === "delivering")) {
      return;
    }

    if (!orchestratorThread || orchestratorThread.deletedAt !== null) {
      yield* Effect.forEach(
        pendingRows,
        (row) =>
          dispatchWakeUpsert({
            preferredThreadId: row.orchestratorThreadId,
            wakeItem: {
              ...projectionWakeRowToWakeItem(row),
              state: "dropped",
              consumedAt: new Date().toISOString(),
              consumeReason: orchestratorThread ? "orchestrator_deleted" : "orchestrator_missing",
            },
            createdAt: new Date().toISOString(),
            commandTag: "drop-missing",
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      return;
    }

    if (orchestratorThread.archivedAt !== null) {
      return;
    }

    if (!isOrchestratorInactive(orchestratorThread)) {
      return;
    }

    drainingOrchestratorThreadIds.add(orchestratorThreadId);
    const now = new Date().toISOString();
    const deliveryMessageId = MessageId.makeUnsafe(
      `msg-orchestrator-wake-${orchestratorThreadId}-${crypto.randomUUID()}`,
    );

    const finalize = Effect.sync(() => {
      drainingOrchestratorThreadIds.delete(orchestratorThreadId);
    });

    const drainEffect = Effect.gen(function* () {
      const refreshedReadModel = yield* orchestrationEngine.getReadModel();
      const refreshedOrchestratorThread = refreshedReadModel.threads.find(
        (entry) => entry.id === orchestratorThreadId,
      );
      const refreshedRows = yield* wakeRepository.listByOrchestratorThreadId({
        orchestratorThreadId,
      });
      const refreshedPendingRows = refreshedRows.filter((row) => row.state === "pending");
      if (
        !refreshedOrchestratorThread ||
        refreshedOrchestratorThread.deletedAt !== null ||
        refreshedOrchestratorThread.archivedAt !== null ||
        !isOrchestratorInactive(refreshedOrchestratorThread) ||
        refreshedRows.some((row) => row.state === "delivering")
      ) {
        return;
      }

      const { deliverableRows, duplicateRows } =
        partitionPendingWakeRowsForDelivery(refreshedPendingRows);

      if (duplicateRows.length > 0) {
        yield* Effect.forEach(
          duplicateRows,
          (row) =>
            dispatchWakeUpsert({
              preferredThreadId: orchestratorThreadId,
              wakeItem: {
                ...projectionWakeRowToWakeItem(row),
                state: "consumed",
                consumedAt: now,
                consumeReason: "duplicate",
              },
              createdAt: now,
              commandTag: "dedupe",
            }),
          { concurrency: 1 },
        ).pipe(Effect.asVoid);
      }

      const batchRows = deliverableRows.slice(0, MAX_WAKE_BATCH_SIZE);
      if (batchRows.length === 0) {
        return;
      }

      const batch = batchRows.map(projectionWakeRowToWakeItem);
      yield* Effect.forEach(
        batch,
        (wakeItem) =>
          dispatchWakeUpsert({
            preferredThreadId: orchestratorThreadId,
            wakeItem: {
              ...wakeItem,
              state: "delivering",
              deliveryMessageId,
            },
            createdAt: now,
            commandTag: "delivering",
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);

      const prompt = buildOrchestratorWakePrompt(batch);

      const dispatchResult = yield* Effect.exit(
        orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: serverCommandId("dispatch"),
          threadId: orchestratorThreadId,
          message: {
            messageId: deliveryMessageId,
            role: "user",
            text: prompt,
            attachments: [],
          },
          runtimeMode: orchestratorThread.runtimeMode,
          interactionMode: orchestratorThread.interactionMode,
          createdAt: now,
        }),
      );

      if (dispatchResult._tag === "Failure") {
        yield* Effect.forEach(
          batch,
          (wakeItem) =>
            dispatchWakeUpsert({
              preferredThreadId: orchestratorThreadId,
              wakeItem: {
                ...wakeItem,
                state: "pending",
              },
              createdAt: now,
              commandTag: "rollback",
            }),
          { concurrency: 1 },
        ).pipe(Effect.asVoid);
      }
    });

    yield* drainEffect.pipe(Effect.ensuring(finalize));
  });

  const processDomainEvent = (event: WakeDomainEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.archived":
          yield* consumeActiveWakeItemsForWorker({
            workerThreadId: event.payload.threadId,
            consumedAt: event.payload.archivedAt,
            consumeReason: "worker_rechecked",
            commandTag: "archive-consume",
          });
          yield* evaluateDrainForOrchestrator(event.payload.threadId);
          return;
        case "thread.deleted":
          yield* consumeActiveWakeItemsForWorker({
            workerThreadId: event.payload.threadId,
            consumedAt: event.payload.deletedAt,
            consumeReason: "worker_deleted",
            commandTag: "worker-delete-consume",
          });
          yield* evaluateDrainForOrchestrator(event.payload.threadId);
          return;
        case "thread.turn-start-requested":
          yield* consumeActiveWakeItemsForWorker({
            workerThreadId: event.payload.threadId,
            consumedAt: event.payload.createdAt,
            consumeReason: "worker_superseded_by_new_turn",
            commandTag: "consume",
          });
          return;
        case "thread.session-set":
          if (
            event.payload.session.activeTurnId === null &&
            event.payload.session.status !== "starting" &&
            event.payload.session.status !== "running"
          ) {
            yield* finalizeDeliveringWakeItemsForOrchestrator({
              orchestratorThreadId: event.payload.threadId,
              settledAt: event.payload.session.updatedAt,
            });
            yield* consumeReviewedDeliveredWakeItemsForOrchestrator({
              orchestratorThreadId: event.payload.threadId,
              consumedAt: event.payload.session.updatedAt,
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
      ? enqueueWakeFromCompletedTurn(input.event)
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

  const reconcileWakesOnStart = orchestrationEngine.getReadModel().pipe(
    Effect.flatMap((readModel) => {
      const activeOrchestratorThreadIds = [
        ...new Set(
          readModel.orchestratorWakeItems
            .filter((wakeItem) => wakeItem.state === "pending" || wakeItem.state === "delivering")
            .map((wakeItem) => wakeItem.orchestratorThreadId),
        ),
      ];
      return Effect.forEach(
        activeOrchestratorThreadIds,
        (orchestratorThreadId) =>
          reconcileDeliveringWakeItemsForOrchestrator(orchestratorThreadId).pipe(
            Effect.flatMap(() => evaluateDrainForOrchestrator(orchestratorThreadId)),
          ),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    }),
    Effect.catchCause((cause) => {
      return Effect.logWarning("orchestrator wake reactor failed to reconcile startup wakes", {
        cause: Cause.pretty(cause),
      });
    }),
  );

  const start: OrchestratorWakeReactorShape["start"] = () =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type !== "turn.completed") {
            return Effect.void;
          }
          return worker.enqueue({ source: "runtime", event });
        }),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (
            event.type !== "thread.archived" &&
            event.type !== "thread.deleted" &&
            event.type !== "thread.turn-start-requested" &&
            event.type !== "thread.session-set" &&
            event.type !== "thread.unarchived" &&
            event.type !== "thread.orchestrator-wake-upserted"
          ) {
            return Effect.void;
          }
          return worker.enqueue({ source: "domain", event });
        }),
      );
      yield* reconcileWakesOnStart;
    });

  return {
    start,
  } satisfies OrchestratorWakeReactorShape;
});

export const OrchestratorWakeReactorLive = Layer.effect(OrchestratorWakeReactor, make).pipe(
  Layer.provideMerge(ProjectionOrchestratorWakeRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
);
