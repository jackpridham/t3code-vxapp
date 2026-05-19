import type { OrchestrationEvent } from "@t3tools/contracts";

import { requestAgentsVxappThreadEventIngest } from "./agentsVxappOwnerClient.ts";

type JsonRecord = Record<string, unknown>;

export type ThreadLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.created"
      | "thread.meta-updated"
      | "thread.runtime-mode-set"
      | "thread.interaction-mode-set"
      | "thread.archived"
      | "thread.unarchived"
      | "thread.deleted";
  }
>;

function ownerProvenance(event: ThreadLifecycleEvent): JsonRecord {
  return {
    source: "t3code-vxapp.orchestration",
    eventId: event.eventId,
    eventType: event.type,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
  };
}

export function isThreadLifecycleEvent(event: OrchestrationEvent): event is ThreadLifecycleEvent {
  return (
    event.type === "thread.created" ||
    event.type === "thread.meta-updated" ||
    event.type === "thread.runtime-mode-set" ||
    event.type === "thread.interaction-mode-set" ||
    event.type === "thread.archived" ||
    event.type === "thread.unarchived" ||
    event.type === "thread.deleted"
  );
}

export function buildThreadLifecycleOwnerPayload(
  event: ThreadLifecycleEvent,
): Readonly<JsonRecord> {
  switch (event.type) {
    case "thread.created":
      return {
        threadId: event.payload.threadId,
        projectId: event.payload.projectId,
        title: event.payload.title,
        labels: event.payload.labels,
        modelSelection: event.payload.modelSelection,
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        branch: event.payload.branch,
        ...(event.payload.worktreePath !== null
          ? {
              worktreePath: event.payload.worktreePath,
              workspaceRoot: event.payload.worktreePath,
            }
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
        ...(event.payload.spawnRole !== undefined ? { spawnRole: event.payload.spawnRole } : {}),
        ...(event.payload.spawnedBy !== undefined ? { spawnedBy: event.payload.spawnedBy } : {}),
        ...(event.payload.workflowId !== undefined ? { workflowId: event.payload.workflowId } : {}),
        ...(event.payload.programId !== undefined ? { programId: event.payload.programId } : {}),
        ...(event.payload.executiveProjectId !== undefined
          ? { executiveProjectId: event.payload.executiveProjectId }
          : {}),
        ...(event.payload.executiveThreadId !== undefined
          ? { executiveThreadId: event.payload.executiveThreadId }
          : {}),
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "thread.meta-updated":
      return {
        threadId: event.payload.threadId,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.labels !== undefined ? { labels: event.payload.labels } : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined && event.payload.worktreePath !== null
          ? {
              worktreePath: event.payload.worktreePath,
              workspaceRoot: event.payload.worktreePath,
            }
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
        ...(event.payload.spawnRole !== undefined ? { spawnRole: event.payload.spawnRole } : {}),
        ...(event.payload.spawnedBy !== undefined ? { spawnedBy: event.payload.spawnedBy } : {}),
        ...(event.payload.workflowId !== undefined ? { workflowId: event.payload.workflowId } : {}),
        ...(event.payload.programId !== undefined ? { programId: event.payload.programId } : {}),
        ...(event.payload.executiveProjectId !== undefined
          ? { executiveProjectId: event.payload.executiveProjectId }
          : {}),
        ...(event.payload.executiveThreadId !== undefined
          ? { executiveThreadId: event.payload.executiveThreadId }
          : {}),
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "thread.runtime-mode-set":
      return {
        threadId: event.payload.threadId,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "thread.interaction-mode-set":
      return {
        threadId: event.payload.threadId,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "thread.archived":
      return {
        threadId: event.payload.threadId,
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "thread.unarchived":
      return {
        threadId: event.payload.threadId,
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "thread.deleted":
      return {
        threadId: event.payload.threadId,
        deletedAt: event.payload.deletedAt,
        updatedAt: event.payload.deletedAt,
        ownerProvenance: ownerProvenance(event),
      };
  }
}

export async function mirrorThreadLifecycleEvent(event: ThreadLifecycleEvent): Promise<void> {
  await requestAgentsVxappThreadEventIngest(buildThreadLifecycleOwnerPayload(event));
}
