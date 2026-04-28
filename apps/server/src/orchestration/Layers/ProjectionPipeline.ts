import {
  ApprovalRequestId,
  type ChatAttachment,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Option, Path, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionCtoAttentionRepository } from "../../persistence/Services/ProjectionCtoAttention.ts";
import { ProjectionOrchestratorWakeRepository } from "../../persistence/Services/ProjectionOrchestratorWakes.ts";
import { ProjectionProgramNotificationRepository } from "../../persistence/Services/ProjectionProgramNotifications.ts";
import { ProjectionProgramRepository } from "../../persistence/Services/ProjectionPrograms.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { type ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import {
  type ProjectionThreadMessage,
  ProjectionThreadMessageRepository,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  type ProjectionThreadProposedPlan,
  ProjectionThreadProposedPlanRepository,
} from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import {
  type ProjectionThreadSession,
  ProjectionThreadSessionRepository,
} from "../../persistence/Services/ProjectionThreadSessions.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../../persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionCtoAttentionRepositoryLive } from "../../persistence/Layers/ProjectionCtoAttention.ts";
import { ProjectionOrchestratorWakeRepositoryLive } from "../../persistence/Layers/ProjectionOrchestratorWakes.ts";
import { ProjectionProgramNotificationRepositoryLive } from "../../persistence/Layers/ProjectionProgramNotifications.ts";
import { ProjectionProgramRepositoryLive } from "../../persistence/Layers/ProjectionPrograms.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionStateRepositoryLive } from "../../persistence/Layers/ProjectionState.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSessionRepositoryLive } from "../../persistence/Layers/ProjectionThreadSessions.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import { ServerConfig } from "../../config.ts";
import {
  acknowledgeCtoAttentionItem,
  dropCtoAttentionItem,
  projectCtoAttentionFromProgramNotification,
} from "../projectionCtoAttention.ts";
import {
  OrchestrationProjectionPipeline,
  type ProjectionAttachmentSideEffects,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import {
  attachmentRelativePath,
  parseAttachmentIdFromRelativePath,
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import { getVxappProjectionProjectors } from "../../extensions/vxapp";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  programs: "projection.programs",
  programNotifications: "projection.program-notifications",
  ctoAttention: "projection.cto-attention",
  threads: "projection.threads",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
  orchestratorWakes: "projection.orchestrator-wakes",
} as const;

const CORE_PROJECTOR_NAME_SET = new Set<string>(Object.values(ORCHESTRATION_PROJECTOR_NAMES));

type ProjectorEventType = OrchestrationEvent["type"];

export interface ProjectorDefinition {
  readonly name: string;
  readonly eventTypes: ReadonlyArray<ProjectorEventType>;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export interface AttachmentSideEffects extends ProjectionAttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

function defineProjector(input: ProjectorDefinition): ProjectorDefinition {
  return input;
}

function projectorAppliesToEvent(
  projector: ProjectorDefinition,
  event: OrchestrationEvent,
): boolean {
  return projector.eventTypes.includes(event.type);
}

function projectorSource(projector: ProjectorDefinition): "core" | "vxapp" {
  return CORE_PROJECTOR_NAME_SET.has(projector.name) ? "core" : "vxapp";
}

function createAttachmentSideEffects(): AttachmentSideEffects {
  return {
    deletedThreadIds: new Set<string>(),
    prunedThreadRelativePaths: new Map<string, Set<string>>(),
  };
}

function upsertCollectionItemByKey<T>(
  items: ReadonlyArray<T>,
  nextItem: T,
  matches: (item: T) => boolean,
): T[] {
  const index = items.findIndex(matches);
  if (index < 0) {
    return [...items, nextItem];
  }
  const nextItems = items.slice();
  nextItems[index] = nextItem;
  return nextItems;
}

const materializeAttachmentsForProjection = Effect.fn("materializeAttachmentsForProjection")(
  (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.succeed(input.attachments.length === 0 ? [] : input.attachments),
);

function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.makeUnsafe(requestId) : null;
}

function extractActivityDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const detail = (payload as Record<string, unknown>).detail;
  return typeof detail === "string" ? detail : null;
}

function resolvesPendingApprovalFromFailureActivity(
  activityKind: string,
  payload: unknown,
): boolean {
  const detail = extractActivityDetail(payload)?.toLowerCase();
  if (!detail) {
    return false;
  }

  if (activityKind === "provider.approval.respond.failed") {
    return (
      detail.includes("stale pending approval request") ||
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }

  if (activityKind === "provider.user-input.respond.failed") {
    return (
      detail.includes("stale pending user-input request") ||
      detail.includes("unknown pending user-input request") ||
      detail.includes("unknown pending user input request")
    );
  }

  return false;
}

function checkpointStatusToProjectionTurnState(
  status: "ready" | "missing" | "error",
): ProjectionTurn["state"] {
  if (status === "error") {
    return "error";
  }
  if (status === "missing") {
    return "interrupted";
  }
  return "completed";
}

function nextProjectionTurnState(
  existingTurn: Option.Option<ProjectionTurn>,
  status: "ready" | "missing" | "error",
  keepRunning: boolean,
): ProjectionTurn["state"] {
  if (keepRunning && Option.isSome(existingTurn)) {
    if (existingTurn.value.state === "interrupted") {
      return "interrupted";
    }
    return existingTurn.value.state === "pending" ? "pending" : "running";
  }
  if (
    status === "missing" &&
    Option.isSome(existingTurn) &&
    (existingTurn.value.state === "running" || existingTurn.value.state === "pending")
  ) {
    return existingTurn.value.state;
  }
  if (Option.isSome(existingTurn) && existingTurn.value.state === "interrupted") {
    return "interrupted";
  }
  return checkpointStatusToProjectionTurnState(status);
}

function nextProjectionTurnCompletedAt(
  existingTurn: Option.Option<ProjectionTurn>,
  nextState: ProjectionTurn["state"],
  completedAt: string,
): string | null {
  if ((nextState === "running" || nextState === "pending") && Option.isSome(existingTurn)) {
    return existingTurn.value.completedAt;
  }
  return completedAt;
}

function isRunningSessionCheckpointEventForTurn(
  session: Option.Option<ProjectionThreadSession>,
  turnId: string,
): boolean {
  return (
    Option.isSome(session) &&
    session.value.status === "running" &&
    session.value.activeTurnId !== null &&
    session.value.activeTurnId === turnId
  );
}

function retainProjectionMessagesAfterRevert(
  messages: ReadonlyArray<ProjectionThreadMessage>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadMessage> {
  const retainedMessageIds = new Set<string>();
  const retainedTurnIds = new Set<string>();
  const keptTurns = turns.filter(
    (turn) =>
      turn.turnId !== null &&
      turn.checkpointTurnCount !== null &&
      turn.checkpointTurnCount <= turnCount,
  );
  for (const turn of keptTurns) {
    if (turn.turnId !== null) {
      retainedTurnIds.add(turn.turnId);
    }
    if (turn.pendingMessageId !== null) {
      retainedMessageIds.add(turn.pendingMessageId);
    }
    if (turn.assistantMessageId !== null) {
      retainedMessageIds.add(turn.assistantMessageId);
    }
  }

  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.messageId);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.messageId),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.messageId) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.messageId.localeCompare(right.messageId),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.messageId);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.messageId));
}

function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function collectThreadAttachmentRelativePaths(
  threadId: string,
  messages: ReadonlyArray<ProjectionThreadMessage>,
): Set<string> {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return new Set();
  }
  const relativePaths = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type !== "image") {
        continue;
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachment.id);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        continue;
      }
      relativePaths.add(attachmentRelativePath(attachment));
    }
  }
  return relativePaths;
}

const runAttachmentSideEffects = Effect.fn("runAttachmentSideEffects")(function* (
  sideEffects: AttachmentSideEffects,
) {
  const serverConfig = yield* Effect.service(ServerConfig);
  const fileSystem = yield* Effect.service(FileSystem.FileSystem);
  const path = yield* Effect.service(Path.Path);

  const attachmentsRootDir = serverConfig.attachmentsDir;
  const readAttachmentRootEntries = fileSystem
    .readDirectory(attachmentsRootDir, { recursive: false })
    .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

  const removeDeletedThreadAttachmentEntry = Effect.fn("removeDeletedThreadAttachmentEntry")(
    function* (threadSegment: string, entry: string) {
      const normalizedEntry = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (normalizedEntry.length === 0 || normalizedEntry.includes("/")) {
        return;
      }
      const attachmentId = parseAttachmentIdFromRelativePath(normalizedEntry);
      if (!attachmentId) {
        return;
      }
      const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
      if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
        return;
      }
      yield* fileSystem.remove(path.join(attachmentsRootDir, normalizedEntry), {
        force: true,
      });
    },
  );

  const deleteThreadAttachments = Effect.fn("deleteThreadAttachments")(function* (
    threadId: string,
  ) {
    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment cleanup for unsafe thread id", {
        threadId,
      });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => removeDeletedThreadAttachmentEntry(threadSegment, entry),
      {
        concurrency: 1,
      },
    );
  });

  const pruneThreadAttachmentEntry = Effect.fn("pruneThreadAttachmentEntry")(function* (
    threadSegment: string,
    keptThreadRelativePaths: Set<string>,
    entry: string,
  ) {
    const relativePath = entry.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (relativePath.length === 0 || relativePath.includes("/")) {
      return;
    }
    const attachmentId = parseAttachmentIdFromRelativePath(relativePath);
    if (!attachmentId) {
      return;
    }
    const attachmentThreadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    if (!attachmentThreadSegment || attachmentThreadSegment !== threadSegment) {
      return;
    }

    const absolutePath = path.join(attachmentsRootDir, relativePath);
    const fileInfo = yield* fileSystem
      .stat(absolutePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return;
    }

    if (!keptThreadRelativePaths.has(relativePath)) {
      yield* fileSystem.remove(absolutePath, { force: true });
    }
  });

  const pruneThreadAttachments = Effect.fn("pruneThreadAttachments")(function* (
    threadId: string,
    keptThreadRelativePaths: Set<string>,
  ) {
    if (sideEffects.deletedThreadIds.has(threadId)) {
      return;
    }

    const threadSegment = toSafeThreadAttachmentSegment(threadId);
    if (!threadSegment) {
      yield* Effect.logWarning("skipping attachment prune for unsafe thread id", { threadId });
      return;
    }

    const entries = yield* readAttachmentRootEntries;
    yield* Effect.forEach(
      entries,
      (entry) => pruneThreadAttachmentEntry(threadSegment, keptThreadRelativePaths, entry),
      { concurrency: 1 },
    );
  });

  yield* Effect.forEach(sideEffects.deletedThreadIds, deleteThreadAttachments, {
    concurrency: 1,
  });

  yield* Effect.forEach(
    sideEffects.prunedThreadRelativePaths.entries(),
    ([threadId, keptThreadRelativePaths]) =>
      pruneThreadAttachments(threadId, keptThreadRelativePaths),
    { concurrency: 1 },
  );
});

const makeOrchestrationProjectionPipeline = Effect.fn("makeOrchestrationProjectionPipeline")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const eventStore = yield* OrchestrationEventStore;
    const projectionStateRepository = yield* ProjectionStateRepository;
    const projectionProjectRepository = yield* ProjectionProjectRepository;
    const projectionProgramRepository = yield* ProjectionProgramRepository;
    const projectionProgramNotificationRepository = yield* ProjectionProgramNotificationRepository;
    const projectionCtoAttentionRepository = yield* ProjectionCtoAttentionRepository;
    const projectionThreadRepository = yield* ProjectionThreadRepository;
    const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
    const projectionThreadProposedPlanRepository = yield* ProjectionThreadProposedPlanRepository;
    const projectionThreadActivityRepository = yield* ProjectionThreadActivityRepository;
    const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
    const projectionTurnRepository = yield* ProjectionTurnRepository;
    const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
    const projectionOrchestratorWakeRepository = yield* ProjectionOrchestratorWakeRepository;

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;

    const applyProjectsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProjectsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "project.created":
          yield* projectionProjectRepository.upsert({
            projectId: event.payload.projectId,
            title: event.payload.title,
            workspaceRoot: event.payload.workspaceRoot,
            kind: event.payload.kind ?? "project",
            sidebarParentProjectId: event.payload.sidebarParentProjectId ?? null,
            currentSessionRootThreadId: event.payload.currentSessionRootThreadId ?? null,
            defaultModelSelection: event.payload.defaultModelSelection,
            scripts: event.payload.scripts,
            hooks: event.payload.hooks,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            deletedAt: null,
          });
          return;

        case "project.meta-updated": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.workspaceRoot !== undefined
              ? { workspaceRoot: event.payload.workspaceRoot }
              : {}),
            ...(event.payload.kind !== undefined ? { kind: event.payload.kind } : {}),
            ...(event.payload.sidebarParentProjectId !== undefined
              ? { sidebarParentProjectId: event.payload.sidebarParentProjectId }
              : {}),
            ...(event.payload.currentSessionRootThreadId !== undefined
              ? { currentSessionRootThreadId: event.payload.currentSessionRootThreadId }
              : {}),
            ...(event.payload.defaultModelSelection !== undefined
              ? { defaultModelSelection: event.payload.defaultModelSelection }
              : {}),
            ...(event.payload.scripts !== undefined ? { scripts: event.payload.scripts } : {}),
            ...(event.payload.hooks !== undefined ? { hooks: event.payload.hooks } : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "project.deleted": {
          const existingRow = yield* projectionProjectRepository.getById({
            projectId: event.payload.projectId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProjectRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const applyThreadsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadsProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "thread.created":
          yield* projectionThreadRepository.upsert({
            threadId: event.payload.threadId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            labels: event.payload.labels,
            modelSelection: event.payload.modelSelection,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            latestTurnId: null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
            orchestratorProjectId: event.payload.orchestratorProjectId ?? null,
            orchestratorThreadId: event.payload.orchestratorThreadId ?? null,
            parentThreadId: event.payload.parentThreadId ?? null,
            spawnRole: event.payload.spawnRole ?? null,
            spawnedBy: event.payload.spawnedBy ?? null,
            workflowId: event.payload.workflowId ?? null,
            programId: event.payload.programId ?? null,
            executiveProjectId: event.payload.executiveProjectId ?? null,
            executiveThreadId: event.payload.executiveThreadId ?? null,
          });
          return;

        case "thread.archived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            archivedAt: event.payload.archivedAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.unarchived": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            archivedAt: null,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.meta-updated": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.labels !== undefined ? { labels: event.payload.labels } : {}),
            ...(event.payload.modelSelection !== undefined
              ? { modelSelection: event.payload.modelSelection }
              : {}),
            ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
            ...(event.payload.worktreePath !== undefined
              ? { worktreePath: event.payload.worktreePath }
              : {}),
            ...(event.payload.orchestratorProjectId !== undefined
              ? { orchestratorProjectId: event.payload.orchestratorProjectId }
              : {}),
            ...(event.payload.orchestratorThreadId !== undefined
              ? { orchestratorThreadId: event.payload.orchestratorThreadId }
              : {}),
            ...(event.payload.parentThreadId !== undefined
              ? { parentThreadId: event.payload.parentThreadId }
              : {}),
            ...(event.payload.spawnRole !== undefined
              ? { spawnRole: event.payload.spawnRole }
              : {}),
            ...(event.payload.spawnedBy !== undefined
              ? { spawnedBy: event.payload.spawnedBy }
              : {}),
            ...(event.payload.workflowId !== undefined
              ? { workflowId: event.payload.workflowId }
              : {}),
            ...(event.payload.programId !== undefined
              ? { programId: event.payload.programId }
              : {}),
            ...(event.payload.executiveProjectId !== undefined
              ? { executiveProjectId: event.payload.executiveProjectId }
              : {}),
            ...(event.payload.executiveThreadId !== undefined
              ? { executiveThreadId: event.payload.executiveThreadId }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.runtime-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            runtimeMode: event.payload.runtimeMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.interaction-mode-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            interactionMode: event.payload.interactionMode,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.deleted": {
          attachmentSideEffects.deletedThreadIds.add(event.payload.threadId);
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        case "thread.message-sent":
        case "thread.proposed-plan-upserted":
        case "thread.activity-appended":
        case "thread.orchestrator-wake-upserted": {
          const targetThreadId =
            event.type === "thread.orchestrator-wake-upserted"
              ? event.payload.wakeItem.orchestratorThreadId
              : event.payload.threadId;
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: targetThreadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const nextLatestTurnId =
            event.type === "thread.message-sent" && event.payload.turnId !== null
              ? event.payload.turnId
              : existingRow.value.latestTurnId;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: nextLatestTurnId,
            updatedAt: event.occurredAt,
          });
          return;
        }

        case "thread.session-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          const nextLatestTurnId =
            event.payload.session.status === "running" &&
            event.payload.session.activeTurnId !== null
              ? event.payload.session.activeTurnId
              : existingRow.value.latestTurnId;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: nextLatestTurnId,
            updatedAt: event.occurredAt,
          });
          return;
        }

        case "thread.turn-checkpoint-recorded":
        case "thread.turn-diff-completed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: event.payload.turnId,
            updatedAt: event.occurredAt,
          });
          return;
        }

        case "thread.reverted": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            latestTurnId: null,
            updatedAt: event.occurredAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const applyProgramsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProgramsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "program.created":
          yield* projectionProgramRepository.upsert({
            programId: event.payload.programId,
            title: event.payload.title,
            objective: event.payload.objective,
            status: event.payload.status,
            declaredRepos: event.payload.declaredRepos ?? [],
            affectedAppTargets: event.payload.affectedAppTargets ?? [],
            requiredLocalSuites: event.payload.requiredLocalSuites ?? [],
            requiredExternalE2ESuites: event.payload.requiredExternalE2ESuites ?? [],
            requireDevelopmentDeploy: event.payload.requireDevelopmentDeploy ?? false,
            requireExternalE2E: event.payload.requireExternalE2E ?? false,
            requireCleanPostFlight: event.payload.requireCleanPostFlight ?? false,
            requirePrPerRepo: event.payload.requirePrPerRepo ?? false,
            executiveProjectId: event.payload.executiveProjectId,
            executiveThreadId: event.payload.executiveThreadId,
            currentOrchestratorThreadId: event.payload.currentOrchestratorThreadId,
            repoPrs: event.payload.repoPrs ?? [],
            localValidation: event.payload.localValidation ?? [],
            appValidations: event.payload.appValidations ?? [],
            observedRepos: event.payload.observedRepos ?? [],
            postFlight: event.payload.postFlight ?? null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            completedAt: event.payload.completedAt,
            cancelReason: event.payload.cancelReason ?? null,
            cancelledAt: event.payload.cancelledAt ?? null,
            supersededByProgramId: event.payload.supersededByProgramId ?? null,
            deletedAt: null,
          });
          return;

        case "program.scope-updated": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            ...(event.payload.declaredRepos !== undefined
              ? { declaredRepos: event.payload.declaredRepos }
              : {}),
            ...(event.payload.affectedAppTargets !== undefined
              ? { affectedAppTargets: event.payload.affectedAppTargets }
              : {}),
            ...(event.payload.requiredLocalSuites !== undefined
              ? { requiredLocalSuites: event.payload.requiredLocalSuites }
              : {}),
            ...(event.payload.requiredExternalE2ESuites !== undefined
              ? { requiredExternalE2ESuites: event.payload.requiredExternalE2ESuites }
              : {}),
            ...(event.payload.requireDevelopmentDeploy !== undefined
              ? { requireDevelopmentDeploy: event.payload.requireDevelopmentDeploy }
              : {}),
            ...(event.payload.requireExternalE2E !== undefined
              ? { requireExternalE2E: event.payload.requireExternalE2E }
              : {}),
            ...(event.payload.requireCleanPostFlight !== undefined
              ? { requireCleanPostFlight: event.payload.requireCleanPostFlight }
              : {}),
            ...(event.payload.requirePrPerRepo !== undefined
              ? { requirePrPerRepo: event.payload.requirePrPerRepo }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.meta-updated": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
            ...(event.payload.objective !== undefined
              ? { objective: event.payload.objective }
              : {}),
            ...(event.payload.status !== undefined ? { status: event.payload.status } : {}),
            ...(event.payload.executiveProjectId !== undefined
              ? { executiveProjectId: event.payload.executiveProjectId }
              : {}),
            ...(event.payload.executiveThreadId !== undefined
              ? { executiveThreadId: event.payload.executiveThreadId }
              : {}),
            ...(event.payload.currentOrchestratorThreadId !== undefined
              ? { currentOrchestratorThreadId: event.payload.currentOrchestratorThreadId }
              : {}),
            ...(event.payload.completedAt !== undefined
              ? { completedAt: event.payload.completedAt }
              : {}),
            ...(event.payload.cancelReason !== undefined
              ? { cancelReason: event.payload.cancelReason }
              : {}),
            ...(event.payload.cancelledAt !== undefined
              ? { cancelledAt: event.payload.cancelledAt }
              : {}),
            ...(event.payload.supersededByProgramId !== undefined
              ? { supersededByProgramId: event.payload.supersededByProgramId }
              : {}),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.repo-pr-upserted": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            repoPrs: upsertCollectionItemByKey(
              existingRow.value.repoPrs,
              event.payload.repoPr,
              (entry) => entry.repo === event.payload.repoPr.repo,
            ),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.local-validation-upserted": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            localValidation: upsertCollectionItemByKey(
              existingRow.value.localValidation,
              event.payload.localValidation,
              (entry) =>
                entry.repo === event.payload.localValidation.repo &&
                entry.suiteId === event.payload.localValidation.suiteId &&
                entry.kind === event.payload.localValidation.kind,
            ),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.app-validation-upserted": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            appValidations: upsertCollectionItemByKey(
              existingRow.value.appValidations,
              event.payload.appValidation,
              (entry) =>
                entry.target === event.payload.appValidation.target &&
                entry.suiteId === event.payload.appValidation.suiteId &&
                entry.kind === event.payload.appValidation.kind,
            ),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.observed-repo-upserted": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            observedRepos: upsertCollectionItemByKey(
              existingRow.value.observedRepos,
              event.payload.observedRepo,
              (entry) =>
                entry.repo === event.payload.observedRepo.repo &&
                entry.source === event.payload.observedRepo.source,
            ),
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.post-flight-set": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            postFlight: event.payload.postFlight,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.deleted": {
          const existingRow = yield* projectionProgramRepository.getById({
            programId: event.payload.programId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramRepository.upsert({
            ...existingRow.value,
            deletedAt: event.payload.deletedAt,
            updatedAt: event.payload.deletedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const applyProgramNotificationsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyProgramNotificationsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "program.notification-upserted":
          yield* projectionProgramNotificationRepository.upsert({
            notificationId: event.payload.notificationId,
            programId: event.payload.programId,
            executiveProjectId: event.payload.executiveProjectId,
            executiveThreadId: event.payload.executiveThreadId,
            orchestratorThreadId: event.payload.orchestratorThreadId,
            kind: event.payload.kind,
            severity: event.payload.severity,
            summary: event.payload.summary,
            evidence: event.payload.evidence,
            state: event.payload.state,
            queuedAt: event.payload.queuedAt,
            deliveredAt: event.payload.deliveredAt,
            consumedAt: event.payload.consumedAt,
            droppedAt: event.payload.droppedAt,
            consumeReason: event.payload.consumeReason,
            dropReason: event.payload.dropReason,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;

        case "program.notification-consumed": {
          const existingRow = yield* projectionProgramNotificationRepository.getById({
            notificationId: event.payload.notificationId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramNotificationRepository.upsert({
            ...existingRow.value,
            state: "consumed",
            consumedAt: event.payload.consumedAt,
            consumeReason: event.payload.consumeReason,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "program.notification-dropped": {
          const existingRow = yield* projectionProgramNotificationRepository.getById({
            notificationId: event.payload.notificationId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionProgramNotificationRepository.upsert({
            ...existingRow.value,
            state: "dropped",
            droppedAt: event.payload.droppedAt,
            dropReason: event.payload.dropReason,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const applyCtoAttentionProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyCtoAttentionProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "program.notification-upserted": {
          const nextAttention =
            projectCtoAttentionFromProgramNotification({
              ...event.payload,
              commandId: event.commandId,
              correlationId: event.correlationId,
            }) ?? null;
          if (nextAttention === null) {
            return;
          }
          yield* projectionCtoAttentionRepository.upsert(nextAttention);
          return;
        }

        case "program.notification-consumed": {
          const existingRow = yield* projectionCtoAttentionRepository.getByNotificationId({
            notificationId: event.payload.notificationId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionCtoAttentionRepository.upsert(
            acknowledgeCtoAttentionItem(
              existingRow.value,
              event.payload.consumedAt,
              event.payload.updatedAt,
            ),
          );
          return;
        }

        case "program.notification-dropped": {
          const existingRow = yield* projectionCtoAttentionRepository.getByNotificationId({
            notificationId: event.payload.notificationId,
          });
          if (Option.isNone(existingRow)) {
            return;
          }
          yield* projectionCtoAttentionRepository.upsert(
            dropCtoAttentionItem(
              existingRow.value,
              event.payload.droppedAt,
              event.payload.updatedAt,
            ),
          );
          return;
        }

        default:
          return;
      }
    });

    const applyThreadMessagesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadMessagesProjection",
    )(function* (event, attachmentSideEffects) {
      switch (event.type) {
        case "thread.message-sent": {
          const existingRows = yield* projectionThreadMessageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const existingMessage = existingRows.find(
            (row) => row.messageId === event.payload.messageId,
          );
          const nextText =
            existingMessage && event.payload.streaming
              ? `${existingMessage.text}${event.payload.text}`
              : existingMessage && event.payload.text.length === 0
                ? existingMessage.text
                : event.payload.text;
          const nextAttachments =
            event.payload.attachments !== undefined
              ? yield* materializeAttachmentsForProjection({
                  attachments: event.payload.attachments,
                })
              : existingMessage?.attachments;
          yield* projectionThreadMessageRepository.upsert({
            messageId: event.payload.messageId,
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            role: event.payload.role,
            text: nextText,
            ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
            isStreaming: event.payload.streaming,
            createdAt: existingMessage?.createdAt ?? event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        }

        case "thread.reverted": {
          const existingRows = yield* projectionThreadMessageRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionMessagesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadMessageRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadMessageRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          attachmentSideEffects.prunedThreadRelativePaths.set(
            event.payload.threadId,
            collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows),
          );
          return;
        }

        default:
          return;
      }
    });

    const applyThreadProposedPlansProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadProposedPlansProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.proposed-plan-upserted":
          yield* projectionThreadProposedPlanRepository.upsert({
            planId: event.payload.proposedPlan.id,
            threadId: event.payload.threadId,
            turnId: event.payload.proposedPlan.turnId,
            planMarkdown: event.payload.proposedPlan.planMarkdown,
            implementedAt: event.payload.proposedPlan.implementedAt,
            implementationThreadId: event.payload.proposedPlan.implementationThreadId,
            createdAt: event.payload.proposedPlan.createdAt,
            updatedAt: event.payload.proposedPlan.updatedAt,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadProposedPlanRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }

          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionProposedPlansAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }

          yield* projectionThreadProposedPlanRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadProposedPlanRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyThreadActivitiesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadActivitiesProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.activity-appended":
          yield* projectionThreadActivityRepository.upsert({
            activityId: event.payload.activity.id,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            tone: event.payload.activity.tone,
            kind: event.payload.activity.kind,
            summary: event.payload.activity.summary,
            payload: event.payload.activity.payload,
            ...(event.payload.activity.sequence !== undefined
              ? { sequence: event.payload.activity.sequence }
              : {}),
            createdAt: event.payload.activity.createdAt,
          });
          return;

        case "thread.reverted": {
          const existingRows = yield* projectionThreadActivityRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          if (existingRows.length === 0) {
            return;
          }
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptRows = retainProjectionActivitiesAfterRevert(
            existingRows,
            existingTurns,
            event.payload.turnCount,
          );
          if (keptRows.length === existingRows.length) {
            return;
          }
          yield* projectionThreadActivityRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(keptRows, projectionThreadActivityRepository.upsert, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyOrchestratorWakesProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyOrchestratorWakesProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type !== "thread.orchestrator-wake-upserted") {
        return;
      }

      yield* projectionOrchestratorWakeRepository.upsert({
        wakeId: event.payload.wakeItem.wakeId,
        orchestratorThreadId: event.payload.wakeItem.orchestratorThreadId,
        orchestratorProjectId: event.payload.wakeItem.orchestratorProjectId,
        workerThreadId: event.payload.wakeItem.workerThreadId,
        workerProjectId: event.payload.wakeItem.workerProjectId,
        workerTurnId: event.payload.wakeItem.workerTurnId,
        workflowId: event.payload.wakeItem.workflowId ?? null,
        workerTitleSnapshot: event.payload.wakeItem.workerTitleSnapshot,
        outcome: event.payload.wakeItem.outcome,
        summary: event.payload.wakeItem.summary,
        queuedAt: event.payload.wakeItem.queuedAt,
        state: event.payload.wakeItem.state,
        deliveryMessageId: event.payload.wakeItem.deliveryMessageId ?? null,
        deliveredAt: event.payload.wakeItem.deliveredAt,
        consumedAt: event.payload.wakeItem.consumedAt,
        consumeReason: event.payload.wakeItem.consumeReason ?? null,
      });
    });

    const applyThreadSessionsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadSessionsProjection",
    )(function* (event, _attachmentSideEffects) {
      if (event.type !== "thread.session-set") {
        return;
      }
      yield* projectionThreadSessionRepository.upsert({
        threadId: event.payload.threadId,
        status: event.payload.session.status,
        providerName: event.payload.session.providerName,
        runtimeMode: event.payload.session.runtimeMode,
        activeTurnId: event.payload.session.activeTurnId,
        lastError: event.payload.session.lastError,
        updatedAt: event.payload.session.updatedAt,
      });
    });

    const applyThreadTurnsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyThreadTurnsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.turn-start-requested": {
          yield* projectionTurnRepository.replacePendingTurnStart({
            threadId: event.payload.threadId,
            messageId: event.payload.messageId,
            sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
            sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
            requestedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.session-set": {
          const turnId = event.payload.session.activeTurnId;
          const isTerminalSessionSet =
            event.payload.session.status !== "running" &&
            event.payload.session.status !== "starting";
          if (turnId === null && !isTerminalSessionSet) {
            return;
          }
          if (turnId === null || isTerminalSessionSet) {
            // Imported from the active-branch continuation settlement review.
            // See active-branch-runtime-fixes-review.md.
            const existingThread = yield* projectionThreadRepository.getById({
              threadId: event.payload.threadId,
            });
            if (Option.isNone(existingThread) || event.payload.session.status === "starting") {
              return;
            }

            const existingTurn =
              existingThread.value.latestTurnId !== null
                ? yield* projectionTurnRepository.getByTurnId({
                    threadId: event.payload.threadId,
                    turnId: existingThread.value.latestTurnId,
                  })
                : Option.none();
            let fallbackRunningTurn = Option.none<ProjectionTurn>();
            if (Option.isNone(existingTurn) && existingThread.value.latestTurnId === null) {
              const runningTurn = (yield* projectionTurnRepository.listByThreadId({
                threadId: event.payload.threadId,
              }))
                .filter((turn) => turn.turnId !== null)
                .find((turn) => turn.state === "running" || turn.state === "pending");
              fallbackRunningTurn = runningTurn
                ? Option.some(runningTurn)
                : Option.none<ProjectionTurn>();
            }
            const targetTurn = Option.isSome(existingTurn) ? existingTurn : fallbackRunningTurn;
            if (
              Option.isNone(targetTurn) ||
              targetTurn.value.turnId === null ||
              (targetTurn.value.state !== "running" && targetTurn.value.state !== "pending")
            ) {
              return;
            }

            const terminalState = event.payload.session.status === "error" ? "error" : "completed";
            const { turnId, ...targetTurnRest } = targetTurn.value;
            yield* projectionTurnRepository.upsertByTurnId({
              ...targetTurnRest,
              turnId,
              state: terminalState,
              startedAt:
                targetTurn.value.startedAt ??
                targetTurn.value.requestedAt ??
                event.payload.session.updatedAt,
              requestedAt:
                targetTurn.value.requestedAt ??
                targetTurn.value.startedAt ??
                event.payload.session.updatedAt,
              completedAt: targetTurn.value.completedAt ?? event.payload.session.updatedAt,
            });
            return;
          }

          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            const nextState =
              existingTurn.value.state === "completed" || existingTurn.value.state === "error"
                ? existingTurn.value.state
                : "running";
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: nextState,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanThreadId:
                existingTurn.value.sourceProposedPlanThreadId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanThreadId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              startedAt:
                existingTurn.value.startedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.occurredAt),
            });
          } else {
            yield* projectionTurnRepository.upsertByTurnId({
              turnId,
              threadId: event.payload.threadId,
              pendingMessageId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.messageId
                : null,
              sourceProposedPlanThreadId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanThreadId
                : null,
              sourceProposedPlanId: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.sourceProposedPlanId
                : null,
              assistantMessageId: null,
              state: "running",
              requestedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              startedAt: Option.isSome(pendingTurnStart)
                ? pendingTurnStart.value.requestedAt
                : event.occurredAt,
              completedAt: null,
              checkpointTurnCount: null,
              checkpointRef: null,
              checkpointStatus: null,
              checkpointFiles: [],
            });
          }

          yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          return;
        }

        case "thread.message-sent": {
          if (event.payload.turnId === null || event.payload.role !== "assistant") {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
            threadId: event.payload.threadId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              pendingMessageId:
                existingTurn.value.pendingMessageId ??
                (Option.isSome(pendingTurnStart) ? pendingTurnStart.value.messageId : null),
              sourceProposedPlanThreadId:
                existingTurn.value.sourceProposedPlanThreadId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanThreadId
                  : null),
              sourceProposedPlanId:
                existingTurn.value.sourceProposedPlanId ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.sourceProposedPlanId
                  : null),
              assistantMessageId: event.payload.messageId,
              state: existingTurn.value.state,
              completedAt: existingTurn.value.completedAt,
              startedAt:
                existingTurn.value.startedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.payload.createdAt),
              requestedAt:
                existingTurn.value.requestedAt ??
                (Option.isSome(pendingTurnStart)
                  ? pendingTurnStart.value.requestedAt
                  : event.payload.createdAt),
            });
            if (Option.isSome(pendingTurnStart)) {
              yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
                threadId: event.payload.threadId,
              });
            }
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: Option.isSome(pendingTurnStart)
              ? pendingTurnStart.value.messageId
              : null,
            sourceProposedPlanThreadId: Option.isSome(pendingTurnStart)
              ? pendingTurnStart.value.sourceProposedPlanThreadId
              : null,
            sourceProposedPlanId: Option.isSome(pendingTurnStart)
              ? pendingTurnStart.value.sourceProposedPlanId
              : null,
            assistantMessageId: event.payload.messageId,
            state: "running",
            requestedAt: Option.isSome(pendingTurnStart)
              ? pendingTurnStart.value.requestedAt
              : event.payload.createdAt,
            startedAt: Option.isSome(pendingTurnStart)
              ? pendingTurnStart.value.requestedAt
              : event.payload.createdAt,
            completedAt: null,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          if (Option.isSome(pendingTurnStart)) {
            yield* projectionTurnRepository.deletePendingTurnStartByThreadId({
              threadId: event.payload.threadId,
            });
          }
          return;
        }

        case "thread.turn-interrupt-requested": {
          const existingThread =
            event.payload.turnId === undefined
              ? yield* projectionThreadRepository.getById({
                  threadId: event.payload.threadId,
                })
              : Option.none();
          const targetTurnId =
            event.payload.turnId ??
            (Option.isSome(existingThread) ? existingThread.value.latestTurnId : null);
          if (targetTurnId === null) {
            return;
          }
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: targetTurnId,
          });
          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              state: "interrupted",
              completedAt: existingTurn.value.completedAt ?? event.payload.createdAt,
              startedAt: existingTurn.value.startedAt ?? event.payload.createdAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.createdAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: targetTurnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: null,
            state: "interrupted",
            requestedAt: event.payload.createdAt,
            startedAt: event.payload.createdAt,
            completedAt: event.payload.createdAt,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
          });
          return;
        }

        case "thread.turn-checkpoint-recorded":
        case "thread.turn-diff-completed": {
          const existingTurn = yield* projectionTurnRepository.getByTurnId({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
          });
          const session = yield* projectionThreadSessionRepository.getByThreadId({
            threadId: event.payload.threadId,
          });
          if (
            event.payload.status === "missing" &&
            Option.isSome(existingTurn) &&
            existingTurn.value.checkpointStatus !== null &&
            existingTurn.value.checkpointStatus !== "missing"
          ) {
            return;
          }
          const nextState = nextProjectionTurnState(
            existingTurn,
            event.payload.status,
            isRunningSessionCheckpointEventForTurn(session, event.payload.turnId),
          );
          const nextCompletedAt = nextProjectionTurnCompletedAt(
            existingTurn,
            nextState,
            event.payload.completedAt,
          );
          yield* projectionTurnRepository.clearCheckpointTurnConflict({
            threadId: event.payload.threadId,
            turnId: event.payload.turnId,
            checkpointTurnCount: event.payload.checkpointTurnCount,
          });

          if (Option.isSome(existingTurn)) {
            yield* projectionTurnRepository.upsertByTurnId({
              ...existingTurn.value,
              assistantMessageId: event.payload.assistantMessageId,
              state: nextState,
              checkpointTurnCount: event.payload.checkpointTurnCount,
              checkpointRef: event.payload.checkpointRef,
              checkpointStatus: event.payload.status,
              checkpointFiles: event.payload.files,
              startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
              requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
              completedAt: nextCompletedAt,
            });
            return;
          }
          yield* projectionTurnRepository.upsertByTurnId({
            turnId: event.payload.turnId,
            threadId: event.payload.threadId,
            pendingMessageId: null,
            sourceProposedPlanThreadId: null,
            sourceProposedPlanId: null,
            assistantMessageId: event.payload.assistantMessageId,
            state: nextState,
            requestedAt: event.payload.completedAt,
            startedAt: event.payload.completedAt,
            completedAt: event.payload.completedAt,
            checkpointTurnCount: event.payload.checkpointTurnCount,
            checkpointRef: event.payload.checkpointRef,
            checkpointStatus: event.payload.status,
            checkpointFiles: event.payload.files,
          });
          return;
        }

        case "thread.reverted": {
          const existingTurns = yield* projectionTurnRepository.listByThreadId({
            threadId: event.payload.threadId,
          });
          const keptTurns = existingTurns.filter(
            (turn) =>
              turn.turnId !== null &&
              turn.checkpointTurnCount !== null &&
              turn.checkpointTurnCount <= event.payload.turnCount,
          );
          yield* projectionTurnRepository.deleteByThreadId({
            threadId: event.payload.threadId,
          });
          yield* Effect.forEach(
            keptTurns,
            (turn) =>
              turn.turnId === null
                ? Effect.void
                : projectionTurnRepository.upsertByTurnId({
                    ...turn,
                    turnId: turn.turnId,
                  }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          return;
        }

        default:
          return;
      }
    });

    const applyCheckpointsProjection: ProjectorDefinition["apply"] = () => Effect.void;

    const applyPendingApprovalsProjection: ProjectorDefinition["apply"] = Effect.fn(
      "applyPendingApprovalsProjection",
    )(function* (event, _attachmentSideEffects) {
      switch (event.type) {
        case "thread.activity-appended": {
          const activityKind = event.payload.activity.kind;
          if (
            activityKind !== "approval.requested" &&
            activityKind !== "approval.resolved" &&
            activityKind !== "user-input.requested" &&
            activityKind !== "user-input.resolved" &&
            activityKind !== "provider.approval.respond.failed" &&
            activityKind !== "provider.user-input.respond.failed"
          ) {
            return;
          }
          const requestId =
            extractActivityRequestId(event.payload.activity.payload) ??
            event.metadata.requestId ??
            null;
          if (requestId === null) {
            return;
          }
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId,
          });
          const resolvedByFailureActivity = resolvesPendingApprovalFromFailureActivity(
            activityKind,
            event.payload.activity.payload,
          );
          if (
            activityKind === "approval.resolved" ||
            activityKind === "user-input.resolved" ||
            resolvedByFailureActivity
          ) {
            const resolvedDecisionRaw =
              typeof event.payload.activity.payload === "object" &&
              event.payload.activity.payload !== null &&
              "decision" in event.payload.activity.payload
                ? (event.payload.activity.payload as { decision?: unknown }).decision
                : null;
            const resolvedDecision =
              resolvedDecisionRaw === "accept" ||
              resolvedDecisionRaw === "acceptForSession" ||
              resolvedDecisionRaw === "decline" ||
              resolvedDecisionRaw === "cancel"
                ? resolvedDecisionRaw
                : null;
            yield* projectionPendingApprovalRepository.upsert({
              requestId,
              threadId: Option.isSome(existingRow)
                ? existingRow.value.threadId
                : event.payload.threadId,
              turnId: Option.isSome(existingRow)
                ? existingRow.value.turnId
                : event.payload.activity.turnId,
              status: "resolved",
              decision: resolvedDecision,
              createdAt: Option.isSome(existingRow)
                ? existingRow.value.createdAt
                : event.payload.activity.createdAt,
              resolvedAt: event.payload.activity.createdAt,
            });
            return;
          }
          if (Option.isSome(existingRow) && existingRow.value.status === "resolved") {
            return;
          }
          yield* projectionPendingApprovalRepository.upsert({
            requestId,
            threadId: event.payload.threadId,
            turnId: event.payload.activity.turnId,
            status: "pending",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.activity.createdAt,
            resolvedAt: null,
          });
          return;
        }

        case "thread.approval-response-requested": {
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* projectionPendingApprovalRepository.upsert({
            requestId: event.payload.requestId,
            threadId: Option.isSome(existingRow)
              ? existingRow.value.threadId
              : event.payload.threadId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: event.payload.decision,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }

        case "thread.user-input-response-requested": {
          const existingRow = yield* projectionPendingApprovalRepository.getByRequestId({
            requestId: event.payload.requestId,
          });
          yield* projectionPendingApprovalRepository.upsert({
            requestId: event.payload.requestId,
            threadId: Option.isSome(existingRow)
              ? existingRow.value.threadId
              : event.payload.threadId,
            turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
            status: "resolved",
            decision: null,
            createdAt: Option.isSome(existingRow)
              ? existingRow.value.createdAt
              : event.payload.createdAt,
            resolvedAt: event.payload.createdAt,
          });
          return;
        }

        default:
          return;
      }
    });

    const projectors: ReadonlyArray<ProjectorDefinition> = [
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.projects,
        eventTypes: ["project.created", "project.meta-updated", "project.deleted"],
        apply: applyProjectsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.programs,
        eventTypes: [
          "program.created",
          "program.scope-updated",
          "program.meta-updated",
          "program.repo-pr-upserted",
          "program.local-validation-upserted",
          "program.app-validation-upserted",
          "program.observed-repo-upserted",
          "program.post-flight-set",
          "program.deleted",
        ],
        apply: applyProgramsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.programNotifications,
        eventTypes: [
          "program.notification-upserted",
          "program.notification-consumed",
          "program.notification-dropped",
        ],
        apply: applyProgramNotificationsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.ctoAttention,
        eventTypes: [
          "program.notification-upserted",
          "program.notification-consumed",
          "program.notification-dropped",
        ],
        apply: applyCtoAttentionProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
        eventTypes: ["thread.message-sent", "thread.reverted"],
        apply: applyThreadMessagesProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
        eventTypes: ["thread.proposed-plan-upserted", "thread.reverted"],
        apply: applyThreadProposedPlansProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
        eventTypes: ["thread.activity-appended", "thread.reverted"],
        apply: applyThreadActivitiesProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
        eventTypes: ["thread.session-set"],
        apply: applyThreadSessionsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
        eventTypes: [
          "thread.turn-start-requested",
          "thread.session-set",
          "thread.message-sent",
          "thread.turn-interrupt-requested",
          "thread.turn-checkpoint-recorded",
          "thread.turn-diff-completed",
          "thread.reverted",
        ],
        apply: applyThreadTurnsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
        eventTypes: [],
        apply: applyCheckpointsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
        eventTypes: [
          "thread.activity-appended",
          "thread.approval-response-requested",
          "thread.user-input-response-requested",
        ],
        apply: applyPendingApprovalsProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.orchestratorWakes,
        eventTypes: ["thread.orchestrator-wake-upserted"],
        apply: applyOrchestratorWakesProjection,
      }),
      defineProjector({
        name: ORCHESTRATION_PROJECTOR_NAMES.threads,
        eventTypes: [
          "thread.created",
          "thread.archived",
          "thread.unarchived",
          "thread.meta-updated",
          "thread.runtime-mode-set",
          "thread.interaction-mode-set",
          "thread.deleted",
          "thread.message-sent",
          "thread.proposed-plan-upserted",
          "thread.activity-appended",
          "thread.orchestrator-wake-upserted",
          "thread.session-set",
          "thread.turn-checkpoint-recorded",
          "thread.turn-diff-completed",
          "thread.reverted",
        ],
        apply: applyThreadsProjection,
      }),
      ...getVxappProjectionProjectors(),
    ];

    const applyProjectorEventsInTransaction = Effect.fn("applyProjectorEventsInTransaction")(
      function* (projector: ProjectorDefinition, events: ReadonlyArray<OrchestrationEvent>) {
        if (events.length === 0) {
          return [] as ReadonlyArray<ProjectionAttachmentSideEffects>;
        }

        const attachmentSideEffects = yield* Effect.forEach(
          events,
          (event) =>
            Effect.gen(function* () {
              const applicable = projectorAppliesToEvent(projector, event);
              const source = projectorSource(projector);
              if (!applicable) {
                yield* Effect.logDebug("orchestration projector skipped event", {
                  projector: projector.name,
                  projectorSource: source,
                  eventType: event.type,
                  sequence: event.sequence,
                  commandId: event.commandId,
                  durationMs: 0,
                });
                return null;
              }

              const startedAtMs = Date.now();
              const nextAttachmentSideEffects = createAttachmentSideEffects();
              yield* projector.apply(event, nextAttachmentSideEffects);
              yield* Effect.logDebug("orchestration projector applied event", {
                projector: projector.name,
                projectorSource: source,
                eventType: event.type,
                sequence: event.sequence,
                commandId: event.commandId,
                durationMs: Math.max(0, Date.now() - startedAtMs),
              });
              return nextAttachmentSideEffects as ProjectionAttachmentSideEffects;
            }),
          { concurrency: 1 },
        );

        return attachmentSideEffects.filter(
          (sideEffect): sideEffect is ProjectionAttachmentSideEffects => sideEffect !== null,
        );
      },
    );

    const flushAttachmentSideEffects: OrchestrationProjectionPipelineShape["flushAttachmentSideEffects"] =
      (sideEffects) =>
        Effect.forEach(
          sideEffects,
          (sideEffect) =>
            runAttachmentSideEffects(sideEffect).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("failed to apply projected attachment side-effects", {
                  cause,
                }),
              ),
            ),
          { concurrency: 1 },
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.provideService(ServerConfig, serverConfig),
          Effect.asVoid,
        );

    const runProjectorForEvents = Effect.fn("runProjectorForEvents")(function* (
      projector: ProjectorDefinition,
      events: ReadonlyArray<OrchestrationEvent>,
    ) {
      const attachmentSideEffects = yield* sql.withTransaction(
        applyProjectorEventsInTransaction(projector, events).pipe(
          Effect.flatMap((nextAttachmentSideEffects) => {
            const lastEvent = events.at(-1) ?? null;
            if (lastEvent === null) {
              return Effect.succeed(nextAttachmentSideEffects);
            }

            return projectionStateRepository
              .upsert({
                projector: projector.name,
                lastAppliedSequence: lastEvent.sequence,
                updatedAt: lastEvent.occurredAt,
              })
              .pipe(Effect.as(nextAttachmentSideEffects));
          }),
        ),
      );
      yield* flushAttachmentSideEffects(attachmentSideEffects);
    });

    const bootstrapProjector = (projector: ProjectorDefinition) =>
      projectionStateRepository
        .getByProjector({
          projector: projector.name,
        })
        .pipe(
          Effect.flatMap((stateRow) =>
            Stream.runForEach(
              eventStore.readFromSequence(
                Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0,
              ),
              (event) => runProjectorForEvents(projector, [event]),
            ),
          ),
        );

    const projectEventsInTransaction: OrchestrationProjectionPipelineShape["projectEventsInTransaction"] =
      (events) =>
        events.length === 0
          ? Effect.succeed([])
          : Effect.gen(function* () {
              const startedAtMs = Date.now();
              const applicableProjectors = projectors.filter((projector) =>
                events.some((event) => projectorAppliesToEvent(projector, event)),
              );
              const applicableCoreProjectorCount = applicableProjectors.filter(
                (projector) => projectorSource(projector) === "core",
              ).length;
              const applicableVxappProjectorCount =
                applicableProjectors.length - applicableCoreProjectorCount;
              const skippedProjectorCount = projectors.length - applicableProjectors.length;
              const eventTypes = Array.from(new Set(events.map((event) => event.type)));
              const rows = yield* Effect.forEach(
                projectors,
                (projector) => applyProjectorEventsInTransaction(projector, events),
                {
                  concurrency: 1,
                },
              );
              const sideEffects = rows.flat();
              const lastEvent = events.at(-1) ?? null;
              if (lastEvent === null) {
                return sideEffects;
              }

              yield* projectionStateRepository.upsertMany(
                projectors.map((projector) => ({
                  projector: projector.name,
                  lastAppliedSequence: lastEvent.sequence,
                  updatedAt: lastEvent.occurredAt,
                })),
              );

              yield* Effect.logDebug("orchestration projection batch completed", {
                eventCount: events.length,
                eventTypes,
                commandId: lastEvent.commandId,
                finalSequence: lastEvent.sequence,
                projectorCount: projectors.length,
                applicableCoreProjectorCount,
                applicableVxappProjectorCount,
                skippedProjectorCount,
                projectionStateRowsWritten: projectors.length,
                durationMs: Math.max(0, Date.now() - startedAtMs),
              });

              return sideEffects;
            });

    const projectEventInTransaction: OrchestrationProjectionPipelineShape["projectEventInTransaction"] =
      (event) => projectEventsInTransaction([event]);

    const projectEvents: OrchestrationProjectionPipelineShape["projectEvents"] = (events) =>
      sql.withTransaction(projectEventsInTransaction(events)).pipe(
        Effect.flatMap((sideEffects) => flushAttachmentSideEffects(sideEffects)),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvents:query")(sqlError)),
        ),
      );

    const projectEvent: OrchestrationProjectionPipelineShape["projectEvent"] = (event) =>
      sql.withTransaction(projectEventInTransaction(event)).pipe(
        Effect.flatMap((sideEffects) => flushAttachmentSideEffects(sideEffects)),
        Effect.asVoid,
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(toPersistenceSqlError("ProjectionPipeline.projectEvent:query")(sqlError)),
        ),
      );

    const bootstrap: OrchestrationProjectionPipelineShape["bootstrap"] = Effect.forEach(
      projectors,
      bootstrapProjector,
      { concurrency: 1 },
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig, serverConfig),
      Effect.asVoid,
      Effect.tap(() =>
        Effect.log("orchestration projection pipeline bootstrapped").pipe(
          Effect.annotateLogs({ projectors: projectors.length }),
        ),
      ),
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.bootstrap:query")(sqlError)),
      ),
    );

    return {
      bootstrap,
      projectEvents,
      projectEvent,
      projectEventsInTransaction,
      projectEventInTransaction,
      flushAttachmentSideEffects,
    } satisfies OrchestrationProjectionPipelineShape;
  },
);

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline(),
).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionProgramRepositoryLive),
  Layer.provideMerge(ProjectionProgramNotificationRepositoryLive),
  Layer.provideMerge(ProjectionCtoAttentionRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ProjectionOrchestratorWakeRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive),
);
