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
  ProgramAffectedAppTargets,
  ProgramAppValidation,
  ProgramId,
  ProgramDeclaredRepos,
  ProgramLocalValidation,
  ProgramObservedRepo,
  ProgramPostFlight,
  ProgramRepoPr,
  ProgramRequiredExternalE2ESuite,
  ProgramRequiredLocalSuite,
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
  declaredRepos: ProgramDeclaredRepos,
  affectedAppTargets: ProgramAffectedAppTargets,
  requiredLocalSuites: Schema.Array(ProgramRequiredLocalSuite),
  requiredExternalE2ESuites: Schema.Array(ProgramRequiredExternalE2ESuite),
  requireDevelopmentDeploy: Schema.Boolean,
  requireExternalE2E: Schema.Boolean,
  requireCleanPostFlight: Schema.Boolean,
  requirePrPerRepo: Schema.Boolean,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  currentOrchestratorThreadId: Schema.NullOr(ThreadId),
  repoPrs: Schema.Array(ProgramRepoPr),
  localValidation: Schema.Array(ProgramLocalValidation),
  appValidations: Schema.Array(ProgramAppValidation),
  observedRepos: Schema.Array(ProgramObservedRepo),
  postFlight: Schema.NullOr(ProgramPostFlight),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  cancelReason: Schema.NullOr(Schema.String),
  cancelledAt: Schema.NullOr(IsoDateTime),
  supersededByProgramId: Schema.NullOr(ProgramId),
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
