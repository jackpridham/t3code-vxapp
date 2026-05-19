import {
  CommandId,
  EventId,
  MessageId,
  type OrchestratorWakeItem,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Data, Effect, FileSystem, Layer, Stream } from "effect";

import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { requestAgentsVxappWakeMutation } from "../../extensions/vxapp/agentsVxappOwnerClient.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
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

const MAX_WAKE_BATCH_SIZE = 5;
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

function resolveActiveRejectedWakeNotificationTarget(input: {
  readonly readModel: OrchestrationReadModel;
  readonly workerThread: OrchestrationThread;
}): OrchestrationThread | null {
  const workerProject = input.readModel.projects.find(
    (project) => project.id === input.workerThread.projectId,
  );
  if (!workerProject) {
    return null;
  }

  const currentSessionCandidates = input.readModel.projects
    .filter(
      (project) =>
        project.kind === "orchestrator" &&
        project.deletedAt === null &&
        project.workspaceRoot === workerProject.workspaceRoot &&
        project.currentSessionRootThreadId != null,
    )
    .map((project) =>
      input.readModel.threads.find(
        (thread) =>
          thread.id === project.currentSessionRootThreadId &&
          thread.projectId === project.id &&
          thread.archivedAt === null &&
          thread.deletedAt === null,
      ),
    )
    .filter((thread): thread is OrchestrationThread => thread !== undefined);

  if (currentSessionCandidates.length === 1) {
    return currentSessionCandidates[0] ?? null;
  }

  const orchestratorProjectIds = new Set(
    input.readModel.projects
      .filter(
        (project) =>
          project.kind === "orchestrator" &&
          project.deletedAt === null &&
          project.workspaceRoot === workerProject.workspaceRoot,
      )
      .map((project) => project.id),
  );
  const singleThreadCandidates = input.readModel.threads.filter(
    (thread) =>
      orchestratorProjectIds.has(thread.projectId) &&
      thread.archivedAt === null &&
      thread.deletedAt === null,
  );

  if (singleThreadCandidates.length !== 1) {
    return null;
  }

  return singleThreadCandidates[0] ?? null;
}

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

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
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

function normalizeWakeOutcome(
  outcome: string | null | undefined,
): "completed" | "failed" | "interrupted" {
  switch (outcome) {
    case "completed":
    case "failed":
    case "interrupted":
      return outcome;
    default:
      return "completed";
  }
}

function normalizeWakeState(
  state: string | null | undefined,
): "pending" | "delivering" | "delivered" | "consumed" | "dropped" {
  switch (state) {
    case "delivering":
    case "delivered":
    case "consumed":
    case "dropped":
      return state;
    default:
      return "pending";
  }
}

function normalizeWakeConsumeReason(
  reason: string | null | undefined,
):
  | "worker_rechecked"
  | "worker_superseded_by_new_turn"
  | "worker_deleted"
  | "worker_reparented"
  | "orchestrator_missing"
  | "orchestrator_deleted"
  | "orchestrator_mismatch"
  | "duplicate"
  | "manual_dismiss" {
  switch (reason) {
    case "worker_superseded_by_new_turn":
    case "worker_deleted":
    case "worker_reparented":
    case "orchestrator_missing":
    case "orchestrator_deleted":
    case "orchestrator_mismatch":
    case "duplicate":
    case "manual_dismiss":
    case "worker_rechecked":
      return reason;
    default:
      return "worker_rechecked";
  }
}

function resolveProgramForWorkerWake(input: {
  readonly readModel: OrchestrationReadModel;
  readonly workerThread: OrchestrationThread;
}): NonNullable<OrchestrationReadModel["programs"]>[number] | null {
  const { readModel, workerThread } = input;
  const programs = readModel.programs ?? [];
  if (workerThread.programId !== undefined) {
    const byId = programs.find(
      (program) => program.id === workerThread.programId && program.deletedAt === null,
    );
    if (byId) {
      return byId;
    }
  }

  const candidates = programs
    .filter((program) => program.deletedAt === null)
    .map((program) => {
      let score = 0;
      if (
        workerThread.orchestratorThreadId !== undefined &&
        program.currentOrchestratorThreadId === workerThread.orchestratorThreadId
      ) {
        score += 4;
      }
      if (
        workerThread.executiveThreadId !== undefined &&
        program.executiveThreadId === workerThread.executiveThreadId
      ) {
        score += 2;
      }
      if (
        workerThread.executiveProjectId !== undefined &&
        program.executiveProjectId === workerThread.executiveProjectId
      ) {
        score += 1;
      }
      return { program, score };
    })
    .filter((candidate) => candidate.score > 0)
    .toSorted((left, right) => right.score - left.score);

  const strongest = candidates[0];
  if (!strongest) {
    return null;
  }
  const competingTopScoreCount = candidates.filter(
    (candidate) => candidate.score === strongest.score,
  ).length;
  if (competingTopScoreCount !== 1) {
    return null;
  }
  return strongest.program;
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

function resolveWorkerWorkspaceForWake(input: {
  readonly item: OrchestratorWakeItem;
  readonly readModel: OrchestrationReadModel;
}): string | null {
  const workerThread = input.readModel.threads.find(
    (thread) => thread.id === input.item.workerThreadId,
  );
  if (workerThread?.worktreePath) {
    return workerThread.worktreePath;
  }

  const workerProject = input.readModel.projects.find(
    (project) => project.id === input.item.workerProjectId,
  );
  return workerProject?.workspaceRoot ?? null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildSettlementCommand(input: {
  readonly item: OrchestratorWakeItem;
  readonly workspace: string;
}): string {
  return [
    "vx t3 lanes review-worker",
    `--orchestrator-thread ${shellQuote(input.item.orchestratorThreadId)}`,
    `--worker-thread ${shellQuote(input.item.workerThreadId)}`,
    `--workspace ${shellQuote(input.workspace)}`,
    "--json",
  ].join(" ");
}

function buildFinalizeCommand(input: {
  readonly item: OrchestratorWakeItem;
  readonly workspace: string;
}): string {
  return [
    "vx t3 lanes finalize-worker-wake",
    `--orchestrator-thread ${shellQuote(input.item.orchestratorThreadId)}`,
    `--worker-thread ${shellQuote(input.item.workerThreadId)}`,
    `--workspace ${shellQuote(input.workspace)}`,
    "--json",
  ].join(" ");
}

function formatNullableContext(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "none";
}

function buildWakeContextLine(input: {
  readonly item: OrchestratorWakeItem;
  readonly readModel: OrchestrationReadModel;
}): string {
  const workerThread = input.readModel.threads.find(
    (thread) => thread.id === input.item.workerThreadId,
  );
  const workspace =
    resolveWorkerWorkspaceForWake({
      item: input.item,
      readModel: input.readModel,
    }) ?? "unresolved";
  const branch = formatNullableContext(workerThread?.branch);
  const parentThreadId = formatNullableContext(workerThread?.parentThreadId);
  const orchestratorThreadId = formatNullableContext(workerThread?.orchestratorThreadId);
  const workflowId = formatNullableContext(input.item.workflowId ?? workerThread?.workflowId);

  return [
    `- worker=${input.item.workerThreadId}`,
    `project=${input.item.workerProjectId}`,
    `turn=${input.item.workerTurnId}`,
    `outcome=${input.item.outcome}`,
    `workspace=${workspace}`,
    `branch=${branch}`,
    `orchestrator=${orchestratorThreadId}`,
    `parent=${parentThreadId}`,
    `workflow=${workflowId}`,
  ].join(" ");
}

function buildOrchestratorWakePrompt(input: {
  readonly items: readonly OrchestratorWakeItem[];
  readonly readModel: OrchestrationReadModel;
}): string {
  const { items, readModel } = input;
  const lines = items.map(
    (item) => `- ${item.workerTitleSnapshot} - ${item.outcome} - ${item.summary}`,
  );
  const settlementLines = items.map((item) => {
    const workspace = resolveWorkerWorkspaceForWake({ item, readModel });
    if (!workspace) {
      return `# Could not resolve workspace for worker ${item.workerThreadId}; inspect the worker thread before settlement.`;
    }
    return buildSettlementCommand({ item, workspace });
  });
  const finalizeLines = items.map((item) => {
    const workspace = resolveWorkerWorkspaceForWake({ item, readModel });
    if (!workspace) {
      return `# Could not resolve workspace for worker ${item.workerThreadId}; inspect the worker thread before finalizing the delivered wake.`;
    }
    return buildFinalizeCommand({ item, workspace });
  });
  const contextLines = items.map((item) => buildWakeContextLine({ item, readModel }));

  return [
    "wake-up-buttercup",
    "",
    "Worker updates are ready for review.",
    "",
    "Run this first, one command per worker outcome:",
    "```bash",
    ...settlementLines,
    "```",
    "",
    "After reviewing a delivered wake, consume it with:",
    "```bash",
    ...finalizeLines,
    "```",
    "",
    "Wake context:",
    ...contextLines,
    "",
    "The command above is the first post-wake check. It replaces the usual initial `workers doctor`, `threads status`, git status/log/stash, wake-state, and workspace-cleanliness probes.",
    "",
    "Pending worker outcomes:",
    ...lines,
    "",
    "Review the worker threads, decide next actions, and continue orchestration.",
  ].join("\n");
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
        turn.turnId !== input.completedTurnId && turn.requestedAt >= completedTurnRequestedAt,
    )
    .map((turn) => turn.requestedAt)
    .toSorted((left, right) => left.localeCompare(right));

  return supersedingRequestedAts[0] ?? null;
}

function partitionPendingWakeItemsForDelivery(items: readonly OrchestratorWakeItem[]): {
  readonly deliverableItems: ReadonlyArray<OrchestratorWakeItem>;
  readonly duplicateItems: ReadonlyArray<OrchestratorWakeItem>;
} {
  const latestByWorkerThreadId = new Map<string, OrchestratorWakeItem>();

  for (const item of items) {
    const current = latestByWorkerThreadId.get(item.workerThreadId);
    if (!current || compareWakeItems(current, item) <= 0) {
      latestByWorkerThreadId.set(item.workerThreadId, item);
    }
  }

  const deliverableWakeIds = new Set(
    [...latestByWorkerThreadId.values()].map((item) => item.wakeId),
  );

  return {
    deliverableItems: items
      .filter((item) => deliverableWakeIds.has(item.wakeId))
      .toSorted(compareWakeItems),
    duplicateItems: items.filter((item) => !deliverableWakeIds.has(item.wakeId)),
  };
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const serverSettingsService = yield* ServerSettingsService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const fileSystem = yield* FileSystem.FileSystem;
  const drainingOrchestratorThreadIds = new Set<string>();
  const explicitlyInterruptedTurnKeys = new Set<string>();

  const listWakeItemsForOrchestrator = Effect.fn("listWakeItemsForOrchestrator")(function* (
    orchestratorThreadId: ThreadId,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    return readModel.orchestratorWakeItems
      .filter((item) => item.orchestratorThreadId === orchestratorThreadId)
      .toSorted(compareWakeItems);
  });

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

    const settings = yield* serverSettingsService.getSettings;
    if (!settings.notifyActiveOrchestratorOnRejectedWorkerWake) {
      return;
    }

    const activeOrchestratorThread = resolveActiveRejectedWakeNotificationTarget({
      readModel: input.readModel,
      workerThread: input.workerThread,
    });
    if (!activeOrchestratorThread) {
      yield* Effect.logWarning("rejected worker wake notification skipped", {
        workerThreadId: input.workerThread.id,
        workerProjectId: input.workerThread.projectId,
        reason: input.reason,
        detail: "No single active orchestrator thread matched the worker workspace.",
      });
      return;
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("rejected-active-orchestrator"),
        threadId: activeOrchestratorThread.id,
        activity: {
          id: EventId.makeUnsafe(`wake-rejected-notify:${crypto.randomUUID()}`),
          tone: "error",
          kind: "diagnostic_worker_wake_rejected",
          summary: "Rejected worker completion wake",
          payload: {
            workerThreadId: input.workerThread.id,
            workerProjectId: input.workerThread.projectId,
            workerTurnId: input.turnId,
            reason: input.reason,
            detail: input.detail,
            expectedOrchestratorThreadId: input.workerThread.orchestratorThreadId ?? null,
            expectedOrchestratorProjectId: input.workerThread.orchestratorProjectId ?? null,
            actualNotificationThreadId: activeOrchestratorThread.id,
            actualNotificationProjectId: activeOrchestratorThread.projectId,
            workerParentThreadId: input.workerThread.parentThreadId ?? null,
            workerWorkflowId: input.workerThread.workflowId ?? null,
          },
          turnId: null,
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
    const findActiveThread = (threadId: ThreadId) =>
      readModel.threads.find(
        (entry) => entry.id === threadId && entry.archivedAt === null && entry.deletedAt === null,
      )?.id;
    const aggregateThreadId =
      findActiveThread(input.preferredThreadId) ??
      findActiveThread(input.wakeItem.orchestratorThreadId) ??
      findActiveThread(input.wakeItem.workerThreadId);
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
    const mutation: Parameters<typeof requestAgentsVxappWakeMutation>[0] =
      input.wakeItem.state === "consumed"
        ? {
            action: "consume" as const,
            wakeId: input.wakeItem.wakeId,
            orchestratorThreadId: input.wakeItem.orchestratorThreadId,
            reason: normalizeWakeConsumeReason(input.wakeItem.consumeReason),
          }
        : input.wakeItem.state === "dropped"
          ? {
              action: "drop" as const,
              wakeId: input.wakeItem.wakeId,
              orchestratorThreadId: input.wakeItem.orchestratorThreadId,
              stateSource: "owner_payload" as const,
            }
          : input.wakeItem.state === "delivered"
            ? {
                action: "deliver" as const,
                wakeId: input.wakeItem.wakeId,
                orchestratorThreadId: input.wakeItem.orchestratorThreadId,
                stateSource: "owner_payload" as const,
              }
            : {
                action: "upsert" as const,
                wakeId: input.wakeItem.wakeId,
                orchestratorThreadId: input.wakeItem.orchestratorThreadId,
                ...(input.wakeItem.orchestratorProjectId !== undefined
                  ? { orchestratorProjectId: input.wakeItem.orchestratorProjectId }
                  : {}),
                ...(input.wakeItem.workerThreadId !== undefined
                  ? { workerThreadId: input.wakeItem.workerThreadId }
                  : {}),
                ...(input.wakeItem.workerProjectId !== undefined
                  ? { workerProjectId: input.wakeItem.workerProjectId }
                  : {}),
                ...(input.wakeItem.workerTurnId !== undefined
                  ? { workerTurnId: input.wakeItem.workerTurnId }
                  : {}),
                ...(input.wakeItem.workflowId !== undefined
                  ? { workflowId: input.wakeItem.workflowId }
                  : {}),
                ...(input.wakeItem.workerTitleSnapshot !== undefined
                  ? { workerTitleSnapshot: input.wakeItem.workerTitleSnapshot }
                  : {}),
                ...(normalizeWakeOutcome(input.wakeItem.outcome) !== undefined
                  ? { outcome: normalizeWakeOutcome(input.wakeItem.outcome) }
                  : {}),
                ...(input.wakeItem.summary !== undefined
                  ? { summary: input.wakeItem.summary }
                  : {}),
                state: normalizeWakeState(input.wakeItem.state),
                stateSource: "owner_payload" as const,
                ...(input.wakeItem.state === "pending" || input.wakeItem.state === "delivering"
                  ? {}
                  : { reason: normalizeWakeConsumeReason(input.wakeItem.consumeReason) }),
                routingKind: "worker_to_orchestrator" as const,
              };
    yield* Effect.tryPromise({
      try: () => requestAgentsVxappWakeMutation(mutation),
      catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
    }).pipe(
      Effect.tap(() =>
        Effect.logDebug("orchestrator wake upsert delegated to agents-vxapp authority", {
          wakeId: input.wakeItem.wakeId,
          commandTag: input.commandTag,
          aggregateThreadId,
          targetState: input.wakeItem.state,
        }),
      ),
    );
  });

  const deliverWakeDirectlyIfPossible = Effect.fn("deliverWakeDirectlyIfPossible")(
    function* (input: {
      readonly readModel: OrchestrationReadModel;
      readonly wakeItem: OrchestratorWakeItem;
      readonly createdAt: string;
    }) {
      const orchestratorThread = input.readModel.threads.find(
        (entry) =>
          entry.id === input.wakeItem.orchestratorThreadId &&
          entry.archivedAt === null &&
          entry.deletedAt === null,
      );
      if (!orchestratorThread) {
        return;
      }
      if (!isSessionWakeDrainable(orchestratorThread.session)) {
        return;
      }

      const deliveryMessageId = MessageId.makeUnsafe(
        `msg-orchestrator-wake-${input.wakeItem.orchestratorThreadId}-${crypto.randomUUID()}`,
      );
      const prompt = buildOrchestratorWakePrompt({
        items: [input.wakeItem],
        readModel: input.readModel,
      });

      const dispatchResult = yield* Effect.exit(
        orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: serverCommandId("wake-direct-dispatch"),
          threadId: input.wakeItem.orchestratorThreadId,
          message: {
            messageId: deliveryMessageId,
            role: "user",
            text: prompt,
            attachments: [],
          },
          runtimeMode: orchestratorThread.runtimeMode,
          interactionMode: orchestratorThread.interactionMode,
          createdAt: input.createdAt,
        }),
      );
      if (dispatchResult._tag === "Failure") {
        yield* Effect.logWarning("orchestrator wake direct delivery dispatch failed", {
          wakeId: input.wakeItem.wakeId,
          orchestratorThreadId: input.wakeItem.orchestratorThreadId,
          cause: Cause.pretty(dispatchResult.cause),
        });
        return;
      }

      yield* dispatchWakeUpsert({
        preferredThreadId: input.wakeItem.orchestratorThreadId,
        wakeItem: {
          ...input.wakeItem,
          state: "delivered",
          deliveryMessageId,
          deliveredAt: input.createdAt,
        },
        createdAt: input.createdAt,
        commandTag: "owner-direct-deliver",
      });
    },
  );

  const syncProgramRelationshipAndNotifyForWake = Effect.fn(
    "syncProgramRelationshipAndNotifyForWake",
  )(function* (input: {
    readonly readModel: OrchestrationReadModel;
    readonly workerThread: OrchestrationThread;
    readonly wakeItem: OrchestratorWakeItem;
    readonly createdAt: string;
  }) {
    const program = resolveProgramForWorkerWake({
      readModel: input.readModel,
      workerThread: input.workerThread,
    });
    if (!program) {
      return;
    }

    const threadProgramId = input.workerThread.programId ?? null;
    const threadExecutiveProjectId = input.workerThread.executiveProjectId ?? null;
    const threadExecutiveThreadId = input.workerThread.executiveThreadId ?? null;
    if (
      threadProgramId !== program.id ||
      threadExecutiveProjectId !== program.executiveProjectId ||
      threadExecutiveThreadId !== program.executiveThreadId
    ) {
      yield* orchestrationEngine
        .dispatch({
          type: "thread.meta.update",
          commandId: serverCommandId("program-link-sync"),
          threadId: input.workerThread.id,
          programId: program.id,
          executiveProjectId: program.executiveProjectId,
          executiveThreadId: program.executiveThreadId,
        })
        .pipe(Effect.asVoid);
    }

    yield* Effect.logDebug("program wake notification delegated to agents-vxapp authority", {
      programId: program.id,
      workerThreadId: input.workerThread.id,
      wakeId: input.wakeItem.wakeId,
    });
  });

  const enqueueWakeForSettledWorkerThread = Effect.fn("enqueueWakeForSettledWorkerThread")(
    function* (input: {
      readonly readModel: OrchestrationReadModel;
      readonly workerThread: OrchestrationThread;
      readonly turnId: TurnId;
      readonly outcome: "completed" | "failed" | "interrupted";
      readonly createdAt: string;
      readonly summary: string;
      readonly commandTag: string;
    }) {
      const { readModel, workerThread, turnId, outcome, createdAt } = input;
      const duplicateWake = readModel.orchestratorWakeItems.find(
        (wakeItem) =>
          wakeItem.workerThreadId === workerThread.id &&
          wakeItem.workerTurnId === turnId &&
          wakeItem.outcome === outcome,
      );
      if (duplicateWake) {
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

      const wakeId = `wake:${workerThread.id}:${turnId}:${outcome}`;
      const turns = yield* projectionTurnRepository.listByThreadId({
        threadId: workerThread.id,
      });
      const supersededAt = findSupersedingTurnRequestedAt({
        turns,
        completedTurnId: turnId,
        completedAt: createdAt,
        activeTurnId: workerThread.session?.activeTurnId ?? null,
      });
      const wakeItem = toWakeItem({
        wakeId,
        orchestratorThreadId: workerThread.orchestratorThreadId,
        orchestratorProjectId: workerThread.orchestratorProjectId,
        workerThread,
        workerTurnId: turnId,
        outcome,
        summary: input.summary,
        queuedAt: createdAt,
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
        createdAt: supersededAt ?? createdAt,
        commandTag: supersededAt === null ? input.commandTag : `${input.commandTag}-superseded`,
      });
      if (supersededAt === null) {
        yield* deliverWakeDirectlyIfPossible({
          readModel,
          wakeItem,
          createdAt,
        });
        yield* syncProgramRelationshipAndNotifyForWake({
          readModel,
          workerThread,
          wakeItem,
          createdAt,
        });
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

    const duplicateWake = readModel.orchestratorWakeItems.find(
      (wakeItem) =>
        wakeItem.workerThreadId === workerThread.id &&
        wakeItem.workerTurnId === turnId &&
        wakeItem.outcome === outcome,
    );
    if (duplicateWake) {
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

    const wakeId = `wake:${workerThread.id}:${turnId}:${outcome}`;
    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: workerThread.id,
    });
    const supersededAt = findSupersedingTurnRequestedAt({
      turns,
      completedTurnId: turnId,
      completedAt: event.payload.completedAt,
      activeTurnId: workerThread.session?.activeTurnId ?? null,
    });
    const wakeItem = toWakeItem({
      wakeId,
      orchestratorThreadId: workerThread.orchestratorThreadId,
      orchestratorProjectId: workerThread.orchestratorProjectId,
      workerThread,
      workerTurnId: turnId,
      outcome,
      summary: buildWakeSummaryFromOutcome({ workerThread, outcome }),
      queuedAt: event.payload.completedAt,
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
      createdAt: supersededAt ?? event.payload.completedAt,
      commandTag: supersededAt === null ? "diff-upsert" : "diff-upsert-superseded",
    });
    if (supersededAt === null) {
      yield* deliverWakeDirectlyIfPossible({
        readModel,
        wakeItem,
        createdAt: event.payload.completedAt,
      });
      yield* syncProgramRelationshipAndNotifyForWake({
        readModel,
        workerThread,
        wakeItem,
        createdAt: event.payload.completedAt,
      });
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
      commandTag: "session-settle-upsert",
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

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: orchestratorThread.id,
    });
    const completedTurn = turns.find((turn) => turn.turnId === turnId);
    if (!completedTurn || completedTurn.pendingMessageId === null) {
      return;
    }

    const matchedWakeItems = readModel.orchestratorWakeItems
      .filter(
        (wakeItem) =>
          wakeItem.orchestratorThreadId === orchestratorThread.id &&
          wakeItem.state === "delivering" &&
          sameId(wakeItem.deliveryMessageId, completedTurn.pendingMessageId),
      )
      .toSorted(compareWakeItems);
    if (matchedWakeItems.length === 0) {
      return;
    }

    yield* Effect.forEach(
      matchedWakeItems,
      (wakeItem) =>
        dispatchWakeUpsert({
          preferredThreadId: orchestratorThread.id,
          wakeItem: {
            ...wakeItem,
            state: "consumed",
            deliveredAt: wakeItem.deliveredAt ?? event.createdAt,
            consumedAt: event.createdAt,
            consumeReason: "worker_rechecked",
          },
          createdAt: event.createdAt,
          commandTag: "runtime-consume-reviewed",
        }),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
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

  const recheckWakeItemsForArchivedWorker = Effect.fn("recheckWakeItemsForArchivedWorker")(
    function* (input: { readonly workerThreadId: ThreadId; readonly archivedAt: string }) {
      const readModel = yield* orchestrationEngine.getReadModel();
      const workerThread = readModel.threads.find((entry) => entry.id === input.workerThreadId);
      const wakeItems = readModel.orchestratorWakeItems
        .filter(
          (wakeItem) =>
            wakeItem.workerThreadId === input.workerThreadId &&
            isWorkerWakeActiveState(wakeItem.state),
        )
        .toSorted(compareWakeItems);

      const orchestratorThreadIds = [
        ...new Set(
          [
            workerThread?.orchestratorThreadId ?? null,
            ...wakeItems.map((wakeItem) => wakeItem.orchestratorThreadId),
          ].filter((value): value is ThreadId => value !== null),
        ),
      ];

      const turnsByOrchestratorThreadId = new Map<ThreadId, ReadonlyArray<ProjectionTurn>>();
      const getTurnsForOrchestrator = (orchestratorThreadId: ThreadId) =>
        Effect.gen(function* () {
          const cachedTurns = turnsByOrchestratorThreadId.get(orchestratorThreadId);
          if (cachedTurns !== undefined) {
            return cachedTurns;
          }
          const turns = yield* projectionTurnRepository.listByThreadId({
            threadId: orchestratorThreadId,
          });
          turnsByOrchestratorThreadId.set(orchestratorThreadId, turns);
          return turns;
        });

      yield* Effect.forEach(
        wakeItems,
        (wakeItem) =>
          Effect.gen(function* () {
            if (wakeItem.state === "pending") {
              return;
            }

            if (wakeItem.state === "delivering") {
              const turns = yield* getTurnsForOrchestrator(wakeItem.orchestratorThreadId);
              const deliveryTurn = findTerminalDeliveryTurn({
                turns,
                deliveryMessageId: wakeItem.deliveryMessageId,
              });
              if (!deliveryTurn) {
                return;
              }

              yield* dispatchWakeUpsert({
                preferredThreadId: wakeItem.orchestratorThreadId,
                wakeItem: {
                  ...wakeItem,
                  state: "consumed",
                  deliveredAt:
                    wakeItem.deliveredAt ??
                    deliveryTurn.completedAt ??
                    deliveryTurn.startedAt ??
                    input.archivedAt,
                  consumedAt: input.archivedAt,
                  consumeReason: "worker_rechecked",
                },
                createdAt: input.archivedAt,
                commandTag: "archive-reviewed-consume",
              });
              return;
            }

            yield* dispatchWakeUpsert({
              preferredThreadId: wakeItem.orchestratorThreadId,
              wakeItem: {
                ...wakeItem,
                state: "consumed",
                consumedAt: input.archivedAt,
                consumeReason: "worker_rechecked",
              },
              createdAt: input.archivedAt,
              commandTag: "archive-delivered-consume",
            });
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);

      yield* Effect.forEach(
        orchestratorThreadIds,
        (orchestratorThreadId) => evaluateDrainForOrchestrator(orchestratorThreadId),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    },
  );

  const finalizeDeliveringWakeItemsForOrchestrator = Effect.fn(
    "finalizeDeliveringWakeItemsForOrchestrator",
  )(function* (input: { readonly orchestratorThreadId: ThreadId; readonly settledAt: string }) {
    const wakeItems = yield* listWakeItemsForOrchestrator(input.orchestratorThreadId);
    const deliveringItems = wakeItems.filter((item) => item.state === "delivering");
    if (deliveringItems.length === 0) {
      return;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: input.orchestratorThreadId,
    });

    yield* Effect.forEach(
      deliveringItems,
      (wakeItem) => {
        const deliveryTurn = findTerminalDeliveryTurn({
          turns,
          deliveryMessageId: wakeItem.deliveryMessageId,
        });
        const deliveredAt =
          wakeItem.deliveredAt ??
          deliveryTurn?.completedAt ??
          deliveryTurn?.startedAt ??
          input.settledAt;

        return dispatchWakeUpsert({
          preferredThreadId: input.orchestratorThreadId,
          wakeItem: {
            ...wakeItem,
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
    const wakeItems = yield* listWakeItemsForOrchestrator(input.orchestratorThreadId);
    const deliveredItems = wakeItems.filter(
      (item) => item.state === "delivered" && item.consumedAt === null,
    );
    if (deliveredItems.length === 0) {
      return;
    }

    const turns = yield* projectionTurnRepository.listByThreadId({
      threadId: input.orchestratorThreadId,
    });

    yield* Effect.forEach(
      deliveredItems,
      (wakeItem) => {
        const deliveryTurn = findTerminalDeliveryTurn({
          turns,
          deliveryMessageId: wakeItem.deliveryMessageId,
        });
        if (!deliveryTurn) {
          return Effect.void;
        }

        return dispatchWakeUpsert({
          preferredThreadId: input.orchestratorThreadId,
          wakeItem: {
            ...wakeItem,
            state: "consumed",
            deliveredAt: wakeItem.deliveredAt ?? deliveryTurn.completedAt ?? deliveryTurn.startedAt,
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
    const wakeItems = readModel.orchestratorWakeItems
      .filter((item) => item.orchestratorThreadId === orchestratorThreadId)
      .toSorted(compareWakeItems);
    const deliveringItems = wakeItems.filter((item) => item.state === "delivering");
    if (deliveringItems.length === 0) {
      return;
    }

    if (!orchestratorThread || orchestratorThread.deletedAt !== null) {
      const consumedAt = new Date().toISOString();
      yield* Effect.forEach(
        deliveringItems,
        (wakeItem) =>
          dispatchWakeUpsert({
            preferredThreadId: wakeItem.orchestratorThreadId,
            wakeItem: {
              ...wakeItem,
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
      deliveringItems,
      (wakeItem) =>
        Effect.gen(function* () {
          const deliveryTurn =
            wakeItem.deliveryMessageId === undefined
              ? undefined
              : turns.find(
                  (turn) =>
                    turn.turnId !== null &&
                    turn.pendingMessageId === wakeItem.deliveryMessageId &&
                    (turn.state === "completed" ||
                      turn.state === "error" ||
                      turn.state === "interrupted"),
                );

          if (deliveryTurn) {
            yield* dispatchWakeUpsert({
              preferredThreadId: orchestratorThreadId,
              wakeItem: {
                ...wakeItem,
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
    const allItems = readModel.orchestratorWakeItems
      .filter((item) => item.orchestratorThreadId === orchestratorThreadId)
      .toSorted(compareWakeItems);
    const pendingItems = allItems.filter((item) => item.state === "pending");
    if (pendingItems.length === 0) {
      return;
    }

    if (allItems.some((item) => item.state === "delivering")) {
      return;
    }

    if (!orchestratorThread || orchestratorThread.deletedAt !== null) {
      yield* Effect.forEach(
        pendingItems,
        (wakeItem) =>
          dispatchWakeUpsert({
            preferredThreadId: wakeItem.orchestratorThreadId,
            wakeItem: {
              ...wakeItem,
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
      const refreshedItems = refreshedReadModel.orchestratorWakeItems
        .filter((item) => item.orchestratorThreadId === orchestratorThreadId)
        .toSorted(compareWakeItems);
      const refreshedPendingItems = refreshedItems.filter((item) => item.state === "pending");
      if (
        !refreshedOrchestratorThread ||
        refreshedOrchestratorThread.deletedAt !== null ||
        refreshedOrchestratorThread.archivedAt !== null ||
        !isOrchestratorInactive(refreshedOrchestratorThread) ||
        refreshedItems.some((item) => item.state === "delivering")
      ) {
        return;
      }

      const { deliverableItems, duplicateItems } =
        partitionPendingWakeItemsForDelivery(refreshedPendingItems);

      if (duplicateItems.length > 0) {
        yield* Effect.forEach(
          duplicateItems,
          (wakeItem) =>
            dispatchWakeUpsert({
              preferredThreadId: orchestratorThreadId,
              wakeItem: {
                ...wakeItem,
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

      const batch = deliverableItems.slice(0, MAX_WAKE_BATCH_SIZE);
      if (batch.length === 0) {
        return;
      }

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

      const prompt = buildOrchestratorWakePrompt({
        items: batch,
        readModel: refreshedReadModel,
      });

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
        yield* Effect.logWarning("orchestrator wake batch delivery dispatch failed", {
          orchestratorThreadId,
          wakeIds: batch.map((wakeItem) => wakeItem.wakeId),
          cause: Cause.pretty(dispatchResult.cause),
        });
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
        readModel.orchestratorWakeItems
          .filter((wakeItem) => wakeItem.state === "pending" || wakeItem.state === "delivering")
          .map((wakeItem) => wakeItem.orchestratorThreadId),
      ),
    ];
    yield* Effect.forEach(
      activeOrchestratorThreadIds,
      (orchestratorThreadId) =>
        reconcileDeliveringWakeItemsForOrchestrator(orchestratorThreadId).pipe(
          Effect.flatMap(() => evaluateDrainForOrchestrator(orchestratorThreadId)),
        ),
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
    yield* _reconcileWakesOnStart;

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
