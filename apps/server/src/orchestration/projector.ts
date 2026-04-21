import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  ProgramId,
  ProgramNotificationId,
  ThreadId,
} from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestratorWakeItem,
  OrchestrationSession,
  OrchestrationProgram,
  OrchestrationProgramNotification,
  OrchestrationThread,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ProgramCreatedPayload,
  ProgramDeletedPayload,
  ProgramMetaUpdatedPayload,
  ProgramNotificationConsumedPayload,
  ProgramNotificationDroppedPayload,
  ProgramNotificationUpsertedPayload,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
  ThreadOrchestratorWakeUpsertedPayload,
} from "./Schemas.ts";
import {
  acknowledgeCtoAttentionItem,
  dropCtoAttentionItem,
  projectCtoAttentionFromProgramNotification,
  upsertCtoAttentionItemByKey,
  updateCtoAttentionItemByNotificationId,
} from "./projectionCtoAttention.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
type ProgramPatch = Partial<Omit<OrchestrationProgram, "id">>;
type ProgramNotificationPatch = Partial<Omit<OrchestrationProgramNotification, "notificationId">>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(
  status: "ready" | "missing" | "error",
  existingLatestTurn?: OrchestrationThread["latestTurn"],
) {
  if (status === "error") return "error" as const;
  if (status === "missing") {
    if (existingLatestTurn?.state === "running") {
      return "running" as const;
    }
    return "interrupted" as const;
  }
  return "completed" as const;
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function updateProgram(
  programs: ReadonlyArray<OrchestrationProgram>,
  programId: ProgramId,
  patch: ProgramPatch,
): OrchestrationProgram[] {
  return programs.map((program) => (program.id === programId ? { ...program, ...patch } : program));
}

function updateProgramNotification(
  notifications: ReadonlyArray<OrchestrationProgramNotification>,
  notificationId: ProgramNotificationId,
  patch: ProgramNotificationPatch,
): OrchestrationProgramNotification[] {
  return notifications.map((notification) =>
    notification.notificationId === notificationId ? { ...notification, ...patch } : notification,
  );
}

function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value),
    catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  });
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    programs: [],
    programNotifications: [],
    ctoAttentionItems: [],
    threads: [],
    orchestratorWakeItems: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            kind: payload.kind ?? "project",
            sidebarParentProjectId: payload.sidebarParentProjectId,
            defaultModelSelection: payload.defaultModelSelection,
            scripts: payload.scripts,
            hooks: payload.hooks,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
                  ...(payload.sidebarParentProjectId !== undefined
                    ? { sidebarParentProjectId: payload.sidebarParentProjectId }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  ...(payload.hooks !== undefined ? { hooks: payload.hooks } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "program.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ProgramCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const program: OrchestrationProgram = yield* decodeForEvent(
          OrchestrationProgram,
          {
            id: payload.programId,
            title: payload.title,
            objective: payload.objective,
            status: payload.status,
            executiveProjectId: payload.executiveProjectId,
            executiveThreadId: payload.executiveThreadId,
            currentOrchestratorThreadId: payload.currentOrchestratorThreadId,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            completedAt: payload.completedAt,
            deletedAt: null,
          },
          event.type,
          "program",
        );
        const programs = nextBase.programs ?? [];
        const existing = programs.find((entry) => entry.id === program.id);
        return {
          ...nextBase,
          programs: existing
            ? programs.map((entry) => (entry.id === program.id ? program : entry))
            : [...programs, program],
        };
      });

    case "program.meta-updated":
      return decodeForEvent(ProgramMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          programs: updateProgram(nextBase.programs ?? [], payload.programId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.objective !== undefined ? { objective: payload.objective } : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.executiveProjectId !== undefined
              ? { executiveProjectId: payload.executiveProjectId }
              : {}),
            ...(payload.executiveThreadId !== undefined
              ? { executiveThreadId: payload.executiveThreadId }
              : {}),
            ...(payload.currentOrchestratorThreadId !== undefined
              ? { currentOrchestratorThreadId: payload.currentOrchestratorThreadId }
              : {}),
            ...(payload.completedAt !== undefined ? { completedAt: payload.completedAt } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "program.deleted":
      return decodeForEvent(ProgramDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          programs: updateProgram(nextBase.programs ?? [], payload.programId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "program.notification-upserted":
      return Effect.gen(function* () {
        const notification = yield* decodeForEvent(
          ProgramNotificationUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const notifications = nextBase.programNotifications ?? [];
        const existing = notifications.find(
          (entry) => entry.notificationId === notification.notificationId,
        );
        const nextCtoAttention =
          projectCtoAttentionFromProgramNotification({
            ...notification,
            commandId: event.commandId,
            correlationId: event.correlationId,
          }) ?? null;
        return {
          ...nextBase,
          programNotifications: existing
            ? notifications.map((entry) =>
                entry.notificationId === notification.notificationId ? notification : entry,
              )
            : [...notifications, notification],
          ctoAttentionItems:
            nextCtoAttention === null
              ? (nextBase.ctoAttentionItems ?? [])
              : upsertCtoAttentionItemByKey(nextBase.ctoAttentionItems ?? [], nextCtoAttention),
        };
      });

    case "program.notification-consumed":
      return decodeForEvent(
        ProgramNotificationConsumedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          programNotifications: updateProgramNotification(
            nextBase.programNotifications ?? [],
            payload.notificationId,
            {
              state: "consumed",
              consumedAt: payload.consumedAt,
              ...(payload.consumeReason !== undefined
                ? { consumeReason: payload.consumeReason }
                : {}),
              updatedAt: payload.updatedAt,
            },
          ),
          ctoAttentionItems: updateCtoAttentionItemByNotificationId(
            nextBase.ctoAttentionItems ?? [],
            payload.notificationId,
            (item) => acknowledgeCtoAttentionItem(item, payload.consumedAt, payload.updatedAt),
          ),
        })),
      );

    case "program.notification-dropped":
      return decodeForEvent(
        ProgramNotificationDroppedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          programNotifications: updateProgramNotification(
            nextBase.programNotifications ?? [],
            payload.notificationId,
            {
              state: "dropped",
              droppedAt: payload.droppedAt,
              ...(payload.dropReason !== undefined ? { dropReason: payload.dropReason } : {}),
              updatedAt: payload.updatedAt,
            },
          ),
          ctoAttentionItems: updateCtoAttentionItemByNotificationId(
            nextBase.ctoAttentionItems ?? [],
            payload.notificationId,
            (item) => dropCtoAttentionItem(item, payload.droppedAt, payload.updatedAt),
          ),
        })),
      );

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            labels: payload.labels,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
            orchestratorProjectId: payload.orchestratorProjectId,
            orchestratorThreadId: payload.orchestratorThreadId,
            parentThreadId: payload.parentThreadId,
            spawnRole: payload.spawnRole,
            spawnedBy: payload.spawnedBy,
            workflowId: payload.workflowId,
            programId: payload.programId,
            executiveProjectId: payload.executiveProjectId,
            executiveThreadId: payload.executiveThreadId,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: payload.archivedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.labels !== undefined ? { labels: payload.labels } : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            ...(payload.orchestratorProjectId !== undefined
              ? { orchestratorProjectId: payload.orchestratorProjectId }
              : {}),
            ...(payload.orchestratorThreadId !== undefined
              ? { orchestratorThreadId: payload.orchestratorThreadId }
              : {}),
            ...(payload.parentThreadId !== undefined
              ? { parentThreadId: payload.parentThreadId }
              : {}),
            ...(payload.spawnRole !== undefined ? { spawnRole: payload.spawnRole } : {}),
            ...(payload.spawnedBy !== undefined ? { spawnedBy: payload.spawnedBy } : {}),
            ...(payload.workflowId !== undefined ? { workflowId: payload.workflowId } : {}),
            ...(payload.programId !== undefined ? { programId: payload.programId } : {}),
            ...(payload.executiveProjectId !== undefined
              ? { executiveProjectId: payload.executiveProjectId }
              : {}),
            ...(payload.executiveThreadId !== undefined
              ? { executiveThreadId: payload.executiveThreadId }
              : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );
        // Imported from the active-branch continuation settlement review.
        // See active-branch-runtime-fixes-review.md.
        const latestTurn =
          session.status === "running" && session.activeTurnId !== null
            ? {
                turnId: session.activeTurnId,
                state: "running" as const,
                requestedAt:
                  thread.latestTurn?.turnId === session.activeTurnId
                    ? thread.latestTurn.requestedAt
                    : session.updatedAt,
                startedAt:
                  thread.latestTurn?.turnId === session.activeTurnId
                    ? (thread.latestTurn.startedAt ?? session.updatedAt)
                    : session.updatedAt,
                completedAt: null,
                assistantMessageId:
                  thread.latestTurn?.turnId === session.activeTurnId
                    ? thread.latestTurn.assistantMessageId
                    : null,
              }
            : thread.latestTurn && thread.latestTurn.state === "running"
              ? {
                  ...thread.latestTurn,
                  state: session.status === "error" ? ("error" as const) : ("completed" as const),
                  completedAt: thread.latestTurn.completedAt ?? session.updatedAt,
                }
              : thread.latestTurn;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);
        const existingLatestTurn =
          thread.latestTurn?.turnId === payload.turnId ? thread.latestTurn : null;
        const nextLatestTurnState = checkpointStatusToLatestTurnState(
          payload.status,
          existingLatestTurn,
        );
        const latestTurnCompletedAt =
          nextLatestTurnState === "running"
            ? (existingLatestTurn?.completedAt ?? null)
            : payload.completedAt;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn: {
              turnId: payload.turnId,
              state: nextLatestTurnState,
              requestedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? thread.latestTurn.requestedAt
                  : payload.completedAt,
              startedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? (thread.latestTurn.startedAt ?? payload.completedAt)
                  : payload.completedAt,
              completedAt: latestTurnCompletedAt,
              assistantMessageId: payload.assistantMessageId,
            },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = [
            ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareThreadActivities)
            .slice(-500);

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.orchestrator-wake-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadOrchestratorWakeUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const wakeItem: OrchestratorWakeItem = yield* decodeForEvent(
          OrchestratorWakeItem,
          payload.wakeItem,
          event.type,
          "wakeItem",
        );

        const orchestratorWakeItems = [
          ...nextBase.orchestratorWakeItems.filter((entry) => entry.wakeId !== wakeItem.wakeId),
          wakeItem,
        ].toSorted(
          (left, right) =>
            left.queuedAt.localeCompare(right.queuedAt) || left.wakeId.localeCompare(right.wakeId),
        );

        return {
          ...nextBase,
          orchestratorWakeItems,
          threads: updateThread(nextBase.threads, wakeItem.orchestratorThreadId, {
            updatedAt: event.occurredAt,
          }),
        };
      });

    default:
      return Effect.succeed(nextBase);
  }
}
