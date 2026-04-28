import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  decodeProjectionProgramDbRow,
  ProjectionProgramDbRowSchema,
} from "../programProjectionRow.ts";
import {
  DeleteProjectionProgramInput,
  GetProjectionProgramInput,
  ProjectionProgram,
  ProjectionProgramRepository,
  type ProjectionProgramRepositoryShape,
} from "../Services/ProjectionPrograms.ts";

const makeProjectionProgramRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProgramRow = SqlSchema.void({
    Request: ProjectionProgram,
    execute: (row) =>
      sql`
        INSERT INTO projection_programs (
          program_id,
          title,
          objective,
          status,
          declared_repos_json,
          affected_app_targets_json,
          required_local_suites_json,
          required_external_e2e_suites_json,
          require_development_deploy,
          require_external_e2e,
          require_clean_post_flight,
          require_pr_per_repo,
          executive_project_id,
          executive_thread_id,
          current_orchestrator_thread_id,
          repo_prs_json,
          local_validation_json,
          app_validations_json,
          observed_repos_json,
          post_flight_json,
          created_at,
          updated_at,
          completed_at,
          cancel_reason,
          cancelled_at,
          superseded_by_program_id,
          deleted_at
        )
        VALUES (
          ${row.programId},
          ${row.title},
          ${row.objective},
          ${row.status},
          ${JSON.stringify(row.declaredRepos)},
          ${JSON.stringify(row.affectedAppTargets)},
          ${JSON.stringify(row.requiredLocalSuites)},
          ${JSON.stringify(row.requiredExternalE2ESuites)},
          ${row.requireDevelopmentDeploy ? 1 : 0},
          ${row.requireExternalE2E ? 1 : 0},
          ${row.requireCleanPostFlight ? 1 : 0},
          ${row.requirePrPerRepo ? 1 : 0},
          ${row.executiveProjectId},
          ${row.executiveThreadId},
          ${row.currentOrchestratorThreadId},
          ${JSON.stringify(row.repoPrs)},
          ${JSON.stringify(row.localValidation)},
          ${JSON.stringify(row.appValidations)},
          ${JSON.stringify(row.observedRepos)},
          ${row.postFlight === null ? null : JSON.stringify(row.postFlight)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.completedAt},
          ${row.cancelReason},
          ${row.cancelledAt},
          ${row.supersededByProgramId},
          ${row.deletedAt}
        )
        ON CONFLICT (program_id)
        DO UPDATE SET
          title = excluded.title,
          objective = excluded.objective,
          status = excluded.status,
          declared_repos_json = excluded.declared_repos_json,
          affected_app_targets_json = excluded.affected_app_targets_json,
          required_local_suites_json = excluded.required_local_suites_json,
          required_external_e2e_suites_json = excluded.required_external_e2e_suites_json,
          require_development_deploy = excluded.require_development_deploy,
          require_external_e2e = excluded.require_external_e2e,
          require_clean_post_flight = excluded.require_clean_post_flight,
          require_pr_per_repo = excluded.require_pr_per_repo,
          executive_project_id = excluded.executive_project_id,
          executive_thread_id = excluded.executive_thread_id,
          current_orchestrator_thread_id = excluded.current_orchestrator_thread_id,
          repo_prs_json = excluded.repo_prs_json,
          local_validation_json = excluded.local_validation_json,
          app_validations_json = excluded.app_validations_json,
          observed_repos_json = excluded.observed_repos_json,
          post_flight_json = excluded.post_flight_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at,
          cancel_reason = excluded.cancel_reason,
          cancelled_at = excluded.cancelled_at,
          superseded_by_program_id = excluded.superseded_by_program_id,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionProgramRow = SqlSchema.findOneOption({
    Request: GetProjectionProgramInput,
    Result: ProjectionProgramDbRowSchema,
    execute: ({ programId }) =>
      sql`
        SELECT
          program_id AS "programId",
          title,
          objective,
          status,
          declared_repos_json AS "declaredRepos",
          affected_app_targets_json AS "affectedAppTargets",
          required_local_suites_json AS "requiredLocalSuites",
          required_external_e2e_suites_json AS "requiredExternalE2ESuites",
          require_development_deploy AS "requireDevelopmentDeploy",
          require_external_e2e AS "requireExternalE2E",
          require_clean_post_flight AS "requireCleanPostFlight",
          require_pr_per_repo AS "requirePrPerRepo",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          current_orchestrator_thread_id AS "currentOrchestratorThreadId",
          repo_prs_json AS "repoPrs",
          local_validation_json AS "localValidation",
          app_validations_json AS "appValidations",
          observed_repos_json AS "observedRepos",
          post_flight_json AS "postFlight",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          cancel_reason AS "cancelReason",
          cancelled_at AS "cancelledAt",
          superseded_by_program_id AS "supersededByProgramId",
          deleted_at AS "deletedAt"
        FROM projection_programs
        WHERE program_id = ${programId}
      `,
  });

  const listProjectionProgramRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProgramDbRowSchema,
    execute: () =>
      sql`
        SELECT
          program_id AS "programId",
          title,
          objective,
          status,
          declared_repos_json AS "declaredRepos",
          affected_app_targets_json AS "affectedAppTargets",
          required_local_suites_json AS "requiredLocalSuites",
          required_external_e2e_suites_json AS "requiredExternalE2ESuites",
          require_development_deploy AS "requireDevelopmentDeploy",
          require_external_e2e AS "requireExternalE2E",
          require_clean_post_flight AS "requireCleanPostFlight",
          require_pr_per_repo AS "requirePrPerRepo",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          current_orchestrator_thread_id AS "currentOrchestratorThreadId",
          repo_prs_json AS "repoPrs",
          local_validation_json AS "localValidation",
          app_validations_json AS "appValidations",
          observed_repos_json AS "observedRepos",
          post_flight_json AS "postFlight",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          cancel_reason AS "cancelReason",
          cancelled_at AS "cancelledAt",
          superseded_by_program_id AS "supersededByProgramId",
          deleted_at AS "deletedAt"
        FROM projection_programs
        ORDER BY created_at ASC, program_id ASC
      `,
  });

  const deleteProjectionProgramRow = SqlSchema.void({
    Request: DeleteProjectionProgramInput,
    execute: ({ programId }) =>
      sql`
        DELETE FROM projection_programs
        WHERE program_id = ${programId}
      `,
  });

  const upsert: ProjectionProgramRepositoryShape["upsert"] = (row) =>
    upsertProjectionProgramRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProgramRepository.upsert:query")),
    );

  const getById: ProjectionProgramRepositoryShape["getById"] = (input) =>
    getProjectionProgramRow(input).pipe(
      Effect.map((option) => option.pipe(Option.map(decodeProjectionProgramDbRow))),
      Effect.mapError(toPersistenceSqlError("ProjectionProgramRepository.getById:query")),
    );

  const listAll: ProjectionProgramRepositoryShape["listAll"] = () =>
    listProjectionProgramRows().pipe(
      Effect.map((rows) => rows.map(decodeProjectionProgramDbRow)),
      Effect.mapError(toPersistenceSqlError("ProjectionProgramRepository.listAll:query")),
    );

  const deleteById: ProjectionProgramRepositoryShape["deleteById"] = (input) =>
    deleteProjectionProgramRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProgramRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionProgramRepositoryShape;
});

export const ProjectionProgramRepositoryLive = Layer.effect(
  ProjectionProgramRepository,
  makeProjectionProgramRepository,
);
