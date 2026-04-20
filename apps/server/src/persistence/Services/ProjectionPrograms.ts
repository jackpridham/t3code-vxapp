/**
 * ProjectionProgramRepository - Projection repository interface for programs.
 *
 * Programs are durable executive initiatives that link CTO/executive intent to
 * one or more Jasper orchestrator runs without reusing worker lineage fields.
 *
 * @module ProjectionProgramRepository
 */
import {
  IsoDateTime,
  OrchestrationProgramStatus,
  ProgramId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProgram = Schema.Struct({
  programId: ProgramId,
  title: Schema.String,
  objective: Schema.NullOr(Schema.String),
  status: OrchestrationProgramStatus,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  currentOrchestratorThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionProgram = typeof ProjectionProgram.Type;

export const GetProjectionProgramInput = Schema.Struct({
  programId: ProgramId,
});
export type GetProjectionProgramInput = typeof GetProjectionProgramInput.Type;

export const DeleteProjectionProgramInput = Schema.Struct({
  programId: ProgramId,
});
export type DeleteProjectionProgramInput = typeof DeleteProjectionProgramInput.Type;

export interface ProjectionProgramRepositoryShape {
  readonly upsert: (program: ProjectionProgram) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionProgramInput,
  ) => Effect.Effect<Option.Option<ProjectionProgram>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionProgram>,
    ProjectionRepositoryError
  >;
  readonly deleteById: (
    input: DeleteProjectionProgramInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionProgramRepository extends ServiceMap.Service<
  ProjectionProgramRepository,
  ProjectionProgramRepositoryShape
>()("t3/persistence/Services/ProjectionPrograms/ProjectionProgramRepository") {}
