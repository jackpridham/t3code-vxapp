import {
  IsoDateTime,
  MessageId,
  OrchestratorWakeConsumeReason,
  OrchestratorWakeOutcome,
  OrchestratorWakeState,
  ProjectId,
  ThreadId,
  TurnId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionOrchestratorWake = Schema.Struct({
  wakeId: TrimmedNonEmptyString,
  orchestratorThreadId: ThreadId,
  orchestratorProjectId: ProjectId,
  workerThreadId: ThreadId,
  workerProjectId: ProjectId,
  workerTurnId: TurnId,
  workflowId: Schema.NullOr(TrimmedNonEmptyString),
  workerTitleSnapshot: TrimmedNonEmptyString,
  outcome: OrchestratorWakeOutcome,
  summary: TrimmedNonEmptyString,
  queuedAt: IsoDateTime,
  state: OrchestratorWakeState,
  deliveryMessageId: Schema.NullOr(MessageId),
  deliveredAt: Schema.NullOr(IsoDateTime),
  consumedAt: Schema.NullOr(IsoDateTime),
  consumeReason: Schema.NullOr(OrchestratorWakeConsumeReason),
});
export type ProjectionOrchestratorWake = typeof ProjectionOrchestratorWake.Type;

export const ListProjectionOrchestratorWakesByThreadInput = Schema.Struct({
  orchestratorThreadId: ThreadId,
});
export type ListProjectionOrchestratorWakesByThreadInput =
  typeof ListProjectionOrchestratorWakesByThreadInput.Type;

export const ListProjectionWorkerWakesInput = Schema.Struct({
  workerThreadId: ThreadId,
});
export type ListProjectionWorkerWakesInput = typeof ListProjectionWorkerWakesInput.Type;

export interface ProjectionOrchestratorWakeRepositoryShape {
  readonly upsert: (
    wake: ProjectionOrchestratorWake,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByOrchestratorThreadId: (
    input: ListProjectionOrchestratorWakesByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionOrchestratorWake>, ProjectionRepositoryError>;
  readonly listPendingByOrchestratorThreadId: (
    input: ListProjectionOrchestratorWakesByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionOrchestratorWake>, ProjectionRepositoryError>;
  readonly listUndeliveredByWorkerThreadId: (
    input: ListProjectionWorkerWakesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionOrchestratorWake>, ProjectionRepositoryError>;
}

export class ProjectionOrchestratorWakeRepository extends ServiceMap.Service<
  ProjectionOrchestratorWakeRepository,
  ProjectionOrchestratorWakeRepositoryShape
>()("t3/persistence/Services/ProjectionOrchestratorWakes/ProjectionOrchestratorWakeRepository") {}
