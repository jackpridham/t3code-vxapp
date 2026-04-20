/**
 * ProjectionProgramNotificationRepository - Projection repository interface for program notifications.
 *
 * Program notifications are durable executive-level signals. They are separate
 * from worker wake items so the CTO can review decisions and blockers without
 * creating another always-on agent loop.
 *
 * @module ProjectionProgramNotificationRepository
 */
import {
  IsoDateTime,
  OrchestrationProgramNotificationKind,
  OrchestrationProgramNotificationSeverity,
  OrchestrationProgramNotificationState,
  ProgramId,
  ProgramNotificationEvidence,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProgramNotification = Schema.Struct({
  notificationId: ProgramNotificationId,
  programId: ProgramId,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  orchestratorThreadId: Schema.NullOr(ThreadId),
  kind: OrchestrationProgramNotificationKind,
  severity: OrchestrationProgramNotificationSeverity,
  summary: Schema.String,
  evidence: ProgramNotificationEvidence,
  state: OrchestrationProgramNotificationState,
  queuedAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  consumedAt: Schema.NullOr(IsoDateTime),
  droppedAt: Schema.NullOr(IsoDateTime),
  consumeReason: Schema.optional(Schema.String),
  dropReason: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionProgramNotification = typeof ProjectionProgramNotification.Type;

export const GetProjectionProgramNotificationInput = Schema.Struct({
  notificationId: ProgramNotificationId,
});
export type GetProjectionProgramNotificationInput =
  typeof GetProjectionProgramNotificationInput.Type;

export const DeleteProjectionProgramNotificationInput = Schema.Struct({
  notificationId: ProgramNotificationId,
});
export type DeleteProjectionProgramNotificationInput =
  typeof DeleteProjectionProgramNotificationInput.Type;

export interface ProjectionProgramNotificationRepositoryShape {
  readonly upsert: (
    notification: ProjectionProgramNotification,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionProgramNotificationInput,
  ) => Effect.Effect<Option.Option<ProjectionProgramNotification>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionProgramNotification>,
    ProjectionRepositoryError
  >;
  readonly deleteById: (
    input: DeleteProjectionProgramNotificationInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionProgramNotificationRepository extends ServiceMap.Service<
  ProjectionProgramNotificationRepository,
  ProjectionProgramNotificationRepositoryShape
>()(
  "t3/persistence/Services/ProjectionProgramNotifications/ProjectionProgramNotificationRepository",
) {}
