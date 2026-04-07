/**
 * OrchestrationProjectionPipeline - Event projection pipeline service interface.
 *
 * Coordinates projection bootstrap/replay and per-event projection updates for
 * orchestration read models.
 *
 * @module OrchestrationProjectionPipeline
 */
import type { OrchestrationEvent } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionAttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

/**
 * OrchestrationProjectionPipelineShape - Service API for projection execution.
 */
export interface OrchestrationProjectionPipelineShape {
  /**
   * Bootstrap projections by replaying persisted events.
   *
   * Resumes each projector from its stored projection-state cursor.
   */
  readonly bootstrap: Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Project a single orchestration event into projection repositories.
   *
   * Projectors are executed sequentially to preserve deterministic ordering.
   */
  readonly projectEvent: (
    event: OrchestrationEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Project a single orchestration event assuming the caller already owns the
   * surrounding SQL transaction. Attachment side effects are returned so the
   * caller can flush them only after the outer transaction commits.
   */
  readonly projectEventInTransaction: (
    event: OrchestrationEvent,
  ) => Effect.Effect<ReadonlyArray<ProjectionAttachmentSideEffects>, ProjectionRepositoryError>;

  /**
   * Flush deferred attachment side effects after the related transaction has
   * committed successfully.
   */
  readonly flushAttachmentSideEffects: (
    sideEffects: ReadonlyArray<ProjectionAttachmentSideEffects>,
  ) => Effect.Effect<void>;
}

/**
 * OrchestrationProjectionPipeline - Service tag for orchestration projections.
 */
export class OrchestrationProjectionPipeline extends ServiceMap.Service<
  OrchestrationProjectionPipeline,
  OrchestrationProjectionPipelineShape
>()("t3/orchestration/Services/ProjectionPipeline/OrchestrationProjectionPipeline") {}
