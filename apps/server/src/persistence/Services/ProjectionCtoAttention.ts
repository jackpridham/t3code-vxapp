/**
 * ProjectionCtoAttentionRepository - Projection repository interface for CTO attention rows.
 *
 * CTO attention is a bounded executive projection derived from program
 * notifications. It is keyed by a stable attention key so repeated
 * projections remain idempotent.
 *
 * @module ProjectionCtoAttentionRepository
 */
import {
  IsoDateTime,
  OrchestrationCtoAttentionKind,
  OrchestrationCtoAttentionState,
  OrchestrationProgramNotificationSeverity,
  ProgramId,
  ProgramNotificationEvidence,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  CtoAttentionId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionCtoAttention = Schema.Struct({
  attentionId: CtoAttentionId,
  attentionKey: TrimmedNonEmptyString,
  notificationId: ProgramNotificationId,
  programId: ProgramId,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceRole: Schema.NullOr(TrimmedNonEmptyString),
  kind: OrchestrationCtoAttentionKind,
  severity: OrchestrationProgramNotificationSeverity,
  summary: TrimmedNonEmptyString,
  evidence: ProgramNotificationEvidence,
  state: OrchestrationCtoAttentionState,
  queuedAt: IsoDateTime,
  acknowledgedAt: Schema.NullOr(IsoDateTime),
  resolvedAt: Schema.NullOr(IsoDateTime),
  droppedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionCtoAttention = typeof ProjectionCtoAttention.Type;

export const GetProjectionCtoAttentionInput = Schema.Struct({
  attentionId: CtoAttentionId,
});
export type GetProjectionCtoAttentionInput = typeof GetProjectionCtoAttentionInput.Type;

export const GetProjectionCtoAttentionByKeyInput = Schema.Struct({
  attentionKey: TrimmedNonEmptyString,
});
export type GetProjectionCtoAttentionByKeyInput = typeof GetProjectionCtoAttentionByKeyInput.Type;

export const GetProjectionCtoAttentionByNotificationIdInput = Schema.Struct({
  notificationId: ProgramNotificationId,
});
export type GetProjectionCtoAttentionByNotificationIdInput =
  typeof GetProjectionCtoAttentionByNotificationIdInput.Type;

export interface ProjectionCtoAttentionRepositoryShape {
  readonly upsert: (row: ProjectionCtoAttention) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionCtoAttentionInput,
  ) => Effect.Effect<Option.Option<ProjectionCtoAttention>, ProjectionRepositoryError>;
  readonly getByKey: (
    input: GetProjectionCtoAttentionByKeyInput,
  ) => Effect.Effect<Option.Option<ProjectionCtoAttention>, ProjectionRepositoryError>;
  readonly getByNotificationId: (
    input: GetProjectionCtoAttentionByNotificationIdInput,
  ) => Effect.Effect<Option.Option<ProjectionCtoAttention>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionCtoAttention>,
    ProjectionRepositoryError
  >;
}

export class ProjectionCtoAttentionRepository extends ServiceMap.Service<
  ProjectionCtoAttentionRepository,
  ProjectionCtoAttentionRepositoryShape
>()("t3/persistence/Services/ProjectionCtoAttention/ProjectionCtoAttentionRepository") {}
