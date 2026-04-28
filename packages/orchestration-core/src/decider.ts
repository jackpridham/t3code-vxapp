import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@t3tools/contracts";
import {
  buildOrchestratorThreadLabels,
  reconcileOrchestratorThreadLabels,
  stripOrchestratorThreadLabels,
} from "@t3tools/shared/orchestrator";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./errors.ts";
import {
  listActiveThreadsByProjectId,
  requireProjectCanBecomeOrchestrator,
  requireOrchestratorProjectThreadSlotAvailable,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
  requireThreadTurnStartSlotAvailable,
} from "./commandInvariants.ts";

const nowIso = () => new Date().toISOString();
const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

function sameLabels(
  left: ReadonlyArray<string> | null | undefined,
  right: ReadonlyArray<string> | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((label, index) => label === right[index]);
}

function labelsIncludeAgent(labels: ReadonlyArray<string>, agent: string): boolean {
  const expected = `agent:${agent}`.toLowerCase();
  return labels.some((label) => label.trim().toLowerCase() === expected);
}

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  OrchestrationCommandInvariantError
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          kind: command.kind ?? "project",
          sidebarParentProjectId: undefined,
          currentSessionRootThreadId: undefined,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          hooks: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      const nextProjectKind = command.kind ?? project.kind ?? "project";
      const nextProjectTitle = command.title ?? project.title;

      if (nextProjectKind === "orchestrator" && project.kind !== "orchestrator") {
        yield* requireProjectCanBecomeOrchestrator({
          readModel,
          command,
          project,
        });
      }

      const events: Array<Omit<OrchestrationEvent, "sequence">> = [
        {
          ...withEventBase({
            aggregateKind: "project",
            aggregateId: command.projectId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "project.meta-updated",
          payload: {
            projectId: command.projectId,
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.workspaceRoot !== undefined
              ? { workspaceRoot: command.workspaceRoot }
              : {}),
            ...(command.kind !== undefined ? { kind: command.kind } : {}),
            ...(command.sidebarParentProjectId !== undefined
              ? { sidebarParentProjectId: command.sidebarParentProjectId }
              : {}),
            ...(command.currentSessionRootThreadId !== undefined
              ? { currentSessionRootThreadId: command.currentSessionRootThreadId }
              : {}),
            ...(command.defaultModelSelection !== undefined
              ? { defaultModelSelection: command.defaultModelSelection }
              : {}),
            ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
            ...(command.hooks !== undefined ? { hooks: command.hooks } : {}),
            updatedAt: occurredAt,
          },
        },
      ];

      const activeThreads = listActiveThreadsByProjectId(readModel, command.projectId);
      for (const thread of activeThreads) {
        const nextLabels =
          nextProjectKind === "orchestrator"
            ? reconcileOrchestratorThreadLabels({
                existingLabels: thread.labels,
                orchestratorName: nextProjectTitle,
                previousOrchestratorName:
                  project.kind === "orchestrator" ? project.title : undefined,
              })
            : project.kind === "orchestrator"
              ? stripOrchestratorThreadLabels({
                  existingLabels: thread.labels,
                  orchestratorName: project.title,
                })
              : null;

        if (nextLabels === null || sameLabels(thread.labels, nextLabels)) {
          continue;
        }

        events.push({
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: thread.id,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.meta-updated",
          payload: {
            threadId: thread.id,
            labels: nextLabels,
            updatedAt: occurredAt,
          },
        });
      }

      return events.length === 1 ? events[0]! : events;
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.deleted",
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "program.create": {
      const existing = (readModel.programs ?? []).find(
        (program) => program.id === command.programId,
      );
      if (existing && existing.deletedAt === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program '${command.programId}' already exists.`,
        });
      }
      yield* requireProject({
        readModel,
        command,
        projectId: command.executiveProjectId,
      });
      yield* requireThread({
        readModel,
        command,
        threadId: command.executiveThreadId,
      });
      if (
        command.currentOrchestratorThreadId !== undefined &&
        command.currentOrchestratorThreadId !== null
      ) {
        yield* requireThread({
          readModel,
          command,
          threadId: command.currentOrchestratorThreadId,
        });
      }
      const status = command.status ?? "active";
      return {
        ...withEventBase({
          aggregateKind: "program",
          aggregateId: command.programId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "program.created",
        payload: {
          programId: command.programId,
          title: command.title,
          objective: command.objective ?? null,
          status,
          executiveProjectId: command.executiveProjectId,
          executiveThreadId: command.executiveThreadId,
          currentOrchestratorThreadId: command.currentOrchestratorThreadId ?? null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
          completedAt: status === "completed" ? command.createdAt : null,
        },
      };
    }

    case "program.meta.update": {
      const program = (readModel.programs ?? []).find(
        (entry) => entry.id === command.programId && entry.deletedAt === null,
      );
      if (!program) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program '${command.programId}' does not exist.`,
        });
      }
      if (command.executiveProjectId !== undefined) {
        yield* requireProject({
          readModel,
          command,
          projectId: command.executiveProjectId,
        });
      }
      if (command.executiveThreadId !== undefined) {
        yield* requireThread({
          readModel,
          command,
          threadId: command.executiveThreadId,
        });
      }
      if (
        command.currentOrchestratorThreadId !== undefined &&
        command.currentOrchestratorThreadId !== null
      ) {
        yield* requireThread({
          readModel,
          command,
          threadId: command.currentOrchestratorThreadId,
        });
      }
      const occurredAt = nowIso();
      const nextStatus = command.status ?? program.status;
      return {
        ...withEventBase({
          aggregateKind: "program",
          aggregateId: command.programId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "program.meta-updated",
        payload: {
          programId: command.programId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.objective !== undefined ? { objective: command.objective } : {}),
          ...(command.status !== undefined ? { status: command.status } : {}),
          ...(command.executiveProjectId !== undefined
            ? { executiveProjectId: command.executiveProjectId }
            : {}),
          ...(command.executiveThreadId !== undefined
            ? { executiveThreadId: command.executiveThreadId }
            : {}),
          ...(command.currentOrchestratorThreadId !== undefined
            ? { currentOrchestratorThreadId: command.currentOrchestratorThreadId }
            : {}),
          ...(command.completedAt !== undefined
            ? { completedAt: command.completedAt }
            : nextStatus === "completed" && program.completedAt === null
              ? { completedAt: occurredAt }
              : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "program.delete": {
      const program = (readModel.programs ?? []).find(
        (entry) => entry.id === command.programId && entry.deletedAt === null,
      );
      if (!program) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program '${command.programId}' does not exist.`,
        });
      }
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "program",
          aggregateId: command.programId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "program.deleted",
        payload: {
          programId: command.programId,
          deletedAt: occurredAt,
        },
      };
    }

    case "program.notification.upsert": {
      const program = (readModel.programs ?? []).find(
        (entry) => entry.id === command.programId && entry.deletedAt === null,
      );
      if (!program) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program '${command.programId}' does not exist.`,
        });
      }
      const executiveProjectId = command.executiveProjectId ?? program.executiveProjectId;
      const executiveThreadId = command.executiveThreadId ?? program.executiveThreadId;
      yield* requireProject({
        readModel,
        command,
        projectId: executiveProjectId,
      });
      yield* requireThread({
        readModel,
        command,
        threadId: executiveThreadId,
      });
      if (command.orchestratorThreadId !== undefined && command.orchestratorThreadId !== null) {
        yield* requireThread({
          readModel,
          command,
          threadId: command.orchestratorThreadId,
        });
      }
      const existing = (readModel.programNotifications ?? []).find(
        (entry) => entry.notificationId === command.notificationId,
      );
      return {
        ...withEventBase({
          aggregateKind: "program",
          aggregateId: command.programId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "program.notification-upserted",
        payload: {
          notificationId: command.notificationId,
          programId: command.programId,
          executiveProjectId,
          executiveThreadId,
          orchestratorThreadId:
            command.orchestratorThreadId !== undefined
              ? command.orchestratorThreadId
              : (existing?.orchestratorThreadId ?? program.currentOrchestratorThreadId),
          kind: command.kind,
          severity: command.severity ?? existing?.severity ?? "info",
          summary: command.summary,
          evidence: command.evidence ?? existing?.evidence ?? {},
          state: command.state ?? existing?.state ?? "pending",
          queuedAt: command.queuedAt ?? existing?.queuedAt ?? command.createdAt,
          deliveredAt:
            command.deliveredAt !== undefined
              ? command.deliveredAt
              : (existing?.deliveredAt ?? null),
          consumedAt: existing?.consumedAt ?? null,
          droppedAt: existing?.droppedAt ?? null,
          consumeReason: existing?.consumeReason,
          dropReason: existing?.dropReason,
          createdAt: existing?.createdAt ?? command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "program.notification.consume": {
      const program = (readModel.programs ?? []).find(
        (entry) => entry.id === command.programId && entry.deletedAt === null,
      );
      if (!program) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program '${command.programId}' does not exist.`,
        });
      }
      const notification = (readModel.programNotifications ?? []).find(
        (entry) =>
          entry.notificationId === command.notificationId && entry.programId === command.programId,
      );
      if (!notification) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program notification '${command.notificationId}' does not exist.`,
        });
      }
      const occurredAt = command.consumedAt ?? nowIso();
      return {
        ...withEventBase({
          aggregateKind: "program",
          aggregateId: command.programId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "program.notification-consumed",
        payload: {
          programId: command.programId,
          notificationId: command.notificationId,
          consumedAt: occurredAt,
          ...(command.consumeReason !== undefined ? { consumeReason: command.consumeReason } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "program.notification.drop": {
      const program = (readModel.programs ?? []).find(
        (entry) => entry.id === command.programId && entry.deletedAt === null,
      );
      if (!program) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program '${command.programId}' does not exist.`,
        });
      }
      const notification = (readModel.programNotifications ?? []).find(
        (entry) =>
          entry.notificationId === command.notificationId && entry.programId === command.programId,
      );
      if (!notification) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Program notification '${command.notificationId}' does not exist.`,
        });
      }
      const occurredAt = command.droppedAt ?? nowIso();
      return {
        ...withEventBase({
          aggregateKind: "program",
          aggregateId: command.programId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "program.notification-dropped",
        payload: {
          programId: command.programId,
          notificationId: command.notificationId,
          droppedAt: occurredAt,
          ...(command.dropReason !== undefined ? { dropReason: command.dropReason } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireOrchestratorProjectThreadSlotAvailable({
        readModel,
        command,
        project,
      });
      const labels =
        command.labels ??
        (project.kind === "orchestrator" ? buildOrchestratorThreadLabels(project.title) : []);
      if (command.spawnRole === "worker" && labelsIncludeAgent(labels, "jasper")) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Jasper is reserved for primary orchestrator threads and cannot be created as a worker.",
        });
      }
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          labels,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          ...(command.orchestratorProjectId !== undefined
            ? { orchestratorProjectId: command.orchestratorProjectId }
            : {}),
          ...(command.orchestratorThreadId !== undefined
            ? { orchestratorThreadId: command.orchestratorThreadId }
            : {}),
          ...(command.parentThreadId !== undefined
            ? { parentThreadId: command.parentThreadId }
            : {}),
          ...(command.spawnRole !== undefined ? { spawnRole: command.spawnRole } : {}),
          ...(command.spawnedBy !== undefined ? { spawnedBy: command.spawnedBy } : {}),
          ...(command.workflowId !== undefined ? { workflowId: command.workflowId } : {}),
          ...(command.programId !== undefined ? { programId: command.programId } : {}),
          ...(command.executiveProjectId !== undefined
            ? { executiveProjectId: command.executiveProjectId }
            : {}),
          ...(command.executiveThreadId !== undefined
            ? { executiveThreadId: command.executiveThreadId }
            : {}),
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      const thread = yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: thread.projectId,
      });
      yield* requireOrchestratorProjectThreadSlotAvailable({
        readModel,
        command,
        project,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.labels !== undefined ? { labels: command.labels } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          ...(command.orchestratorProjectId !== undefined
            ? { orchestratorProjectId: command.orchestratorProjectId }
            : {}),
          ...(command.orchestratorThreadId !== undefined
            ? { orchestratorThreadId: command.orchestratorThreadId }
            : {}),
          ...(command.parentThreadId !== undefined
            ? { parentThreadId: command.parentThreadId }
            : {}),
          ...(command.spawnRole !== undefined ? { spawnRole: command.spawnRole } : {}),
          ...(command.spawnedBy !== undefined ? { spawnedBy: command.spawnedBy } : {}),
          ...(command.workflowId !== undefined ? { workflowId: command.workflowId } : {}),
          ...(command.programId !== undefined ? { programId: command.programId } : {}),
          ...(command.executiveProjectId !== undefined
            ? { executiveProjectId: command.executiveProjectId }
            : {}),
          ...(command.executiveThreadId !== undefined
            ? { executiveThreadId: command.executiveThreadId }
            : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireThreadTurnStartSlotAvailable({
        thread: targetThread,
        command,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.turn.checkpoint.record": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-checkpoint-recorded",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        }),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    case "thread.orchestrator-wake.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.orchestrator-wake-upserted",
        payload: {
          threadId: command.threadId,
          wakeItem: command.wakeItem,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
