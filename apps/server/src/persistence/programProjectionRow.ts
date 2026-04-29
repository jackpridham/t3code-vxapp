import { type OrchestrationProgram } from "@t3tools/contracts";
import { Schema } from "effect";

import {
  ProjectionProgram,
  type ProjectionProgram as ProjectionProgramRow,
} from "./Services/ProjectionPrograms.ts";

export const ProjectionProgramDbRowSchema = Schema.Struct({
  programId: ProjectionProgram.fields.programId,
  title: ProjectionProgram.fields.title,
  objective: ProjectionProgram.fields.objective,
  status: ProjectionProgram.fields.status,
  declaredRepos: Schema.String,
  affectedAppTargets: Schema.String,
  requiredLocalSuites: Schema.String,
  requiredExternalE2ESuites: Schema.String,
  requireDevelopmentDeploy: Schema.Number,
  requireExternalE2E: Schema.Number,
  requireCleanPostFlight: Schema.Number,
  requirePrPerRepo: Schema.Number,
  executiveProjectId: ProjectionProgram.fields.executiveProjectId,
  executiveThreadId: ProjectionProgram.fields.executiveThreadId,
  currentOrchestratorThreadId: ProjectionProgram.fields.currentOrchestratorThreadId,
  repoPrs: Schema.String,
  localValidation: Schema.String,
  appValidations: Schema.String,
  observedRepos: Schema.String,
  postFlight: Schema.NullOr(Schema.String),
  createdAt: ProjectionProgram.fields.createdAt,
  updatedAt: ProjectionProgram.fields.updatedAt,
  completedAt: ProjectionProgram.fields.completedAt,
  cancelReason: ProjectionProgram.fields.cancelReason,
  cancelledAt: ProjectionProgram.fields.cancelledAt,
  supersededByProgramId: ProjectionProgram.fields.supersededByProgramId,
  deletedAt: ProjectionProgram.fields.deletedAt,
});
export type ProjectionProgramDbRow = typeof ProjectionProgramDbRowSchema.Type;

const decodeProjectionProgram = Schema.decodeUnknownSync(ProjectionProgram);

export function decodeProjectionProgramDbRow(row: ProjectionProgramDbRow): ProjectionProgramRow {
  return decodeProjectionProgram({
    programId: row.programId,
    title: row.title,
    objective: row.objective,
    status: row.status,
    declaredRepos: JSON.parse(row.declaredRepos),
    affectedAppTargets: JSON.parse(row.affectedAppTargets),
    requiredLocalSuites: JSON.parse(row.requiredLocalSuites),
    requiredExternalE2ESuites: JSON.parse(row.requiredExternalE2ESuites),
    requireDevelopmentDeploy: row.requireDevelopmentDeploy === 1,
    requireExternalE2E: row.requireExternalE2E === 1,
    requireCleanPostFlight: row.requireCleanPostFlight === 1,
    requirePrPerRepo: row.requirePrPerRepo === 1,
    executiveProjectId: row.executiveProjectId,
    executiveThreadId: row.executiveThreadId,
    currentOrchestratorThreadId: row.currentOrchestratorThreadId,
    repoPrs: JSON.parse(row.repoPrs),
    localValidation: JSON.parse(row.localValidation),
    appValidations: JSON.parse(row.appValidations),
    observedRepos: JSON.parse(row.observedRepos),
    postFlight: row.postFlight === null ? null : JSON.parse(row.postFlight),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    cancelReason: row.cancelReason,
    cancelledAt: row.cancelledAt,
    supersededByProgramId: row.supersededByProgramId,
    deletedAt: row.deletedAt,
  });
}

export function toOrchestrationProgram(row: ProjectionProgramRow): OrchestrationProgram {
  return {
    id: row.programId,
    title: row.title,
    objective: row.objective,
    status: row.status,
    declaredRepos: row.declaredRepos,
    affectedAppTargets: row.affectedAppTargets,
    requiredLocalSuites: row.requiredLocalSuites,
    requiredExternalE2ESuites: row.requiredExternalE2ESuites,
    requireDevelopmentDeploy: row.requireDevelopmentDeploy,
    requireExternalE2E: row.requireExternalE2E,
    requireCleanPostFlight: row.requireCleanPostFlight,
    requirePrPerRepo: row.requirePrPerRepo,
    executiveProjectId: row.executiveProjectId,
    executiveThreadId: row.executiveThreadId,
    currentOrchestratorThreadId: row.currentOrchestratorThreadId,
    repoPrs: row.repoPrs,
    localValidation: row.localValidation,
    appValidations: row.appValidations,
    observedRepos: row.observedRepos,
    postFlight: row.postFlight,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    cancelReason: row.cancelReason,
    cancelledAt: row.cancelledAt,
    supersededByProgramId: row.supersededByProgramId,
    deletedAt: row.deletedAt,
  };
}
