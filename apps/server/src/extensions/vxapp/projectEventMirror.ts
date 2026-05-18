import type { OrchestrationEvent } from "@t3tools/contracts";

import { requestAgentsVxappProjectEventIngest } from "./agentsVxappOwnerClient.ts";

type JsonRecord = Record<string, unknown>;

export type ProjectLifecycleEvent = Extract<
  OrchestrationEvent,
  { type: "project.created" | "project.meta-updated" | "project.deleted" }
>;

function ownerProvenance(event: ProjectLifecycleEvent): JsonRecord {
  return {
    source: "t3code-vxapp.orchestration",
    eventId: event.eventId,
    eventType: event.type,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
  };
}

export function isProjectLifecycleEvent(event: OrchestrationEvent): event is ProjectLifecycleEvent {
  return (
    event.type === "project.created" ||
    event.type === "project.meta-updated" ||
    event.type === "project.deleted"
  );
}

export function buildProjectLifecycleOwnerPayload(
  event: ProjectLifecycleEvent,
): Readonly<JsonRecord> {
  switch (event.type) {
    case "project.created":
      return {
        action: "create",
        projectId: event.payload.projectId,
        workspaceRoot: event.payload.workspaceRoot,
        title: event.payload.title,
        ...(event.payload.kind !== undefined ? { kind: event.payload.kind } : {}),
        ...(event.payload.currentSessionRootThreadId !== undefined
          ? { currentSessionRootThreadId: event.payload.currentSessionRootThreadId }
          : {}),
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "project.meta-updated":
      return {
        action: "update",
        projectId: event.payload.projectId,
        ...(event.payload.workspaceRoot !== undefined
          ? { workspaceRoot: event.payload.workspaceRoot }
          : {}),
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.kind !== undefined ? { kind: event.payload.kind } : {}),
        ...(event.payload.currentSessionRootThreadId !== undefined
          ? { currentSessionRootThreadId: event.payload.currentSessionRootThreadId }
          : {}),
        updatedAt: event.payload.updatedAt,
        ownerProvenance: ownerProvenance(event),
      };
    case "project.deleted":
      return {
        action: "delete",
        projectId: event.payload.projectId,
        deletedAt: event.payload.deletedAt,
        updatedAt: event.payload.deletedAt,
        ownerProvenance: ownerProvenance(event),
      };
  }
}

export async function mirrorProjectLifecycleEvent(event: ProjectLifecycleEvent): Promise<void> {
  await requestAgentsVxappProjectEventIngest(buildProjectLifecycleOwnerPayload(event));
}
