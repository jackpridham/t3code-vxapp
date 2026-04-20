import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionProgramInput,
  GetProjectionProgramInput,
  ProjectionProgram,
  ProjectionProgramRepository,
  type ProjectionProgramRepositoryShape,
} from "../Services/ProjectionPrograms.ts";

const ProjectionProgramDbRow = ProjectionProgram;
type ProjectionProgramDbRow = typeof ProjectionProgramDbRow.Type;

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
          executive_project_id,
          executive_thread_id,
          current_orchestrator_thread_id,
          created_at,
          updated_at,
          completed_at,
          deleted_at
        )
        VALUES (
          ${row.programId},
          ${row.title},
          ${row.objective},
          ${row.status},
          ${row.executiveProjectId},
          ${row.executiveThreadId},
          ${row.currentOrchestratorThreadId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.completedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (program_id)
        DO UPDATE SET
          title = excluded.title,
          objective = excluded.objective,
          status = excluded.status,
          executive_project_id = excluded.executive_project_id,
          executive_thread_id = excluded.executive_thread_id,
          current_orchestrator_thread_id = excluded.current_orchestrator_thread_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionProgramRow = SqlSchema.findOneOption({
    Request: GetProjectionProgramInput,
    Result: ProjectionProgramDbRow,
    execute: ({ programId }) =>
      sql`
        SELECT
          program_id AS "programId",
          title,
          objective,
          status,
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          current_orchestrator_thread_id AS "currentOrchestratorThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          deleted_at AS "deletedAt"
        FROM projection_programs
        WHERE program_id = ${programId}
      `,
  });

  const listProjectionProgramRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProgramDbRow,
    execute: () =>
      sql`
        SELECT
          program_id AS "programId",
          title,
          objective,
          status,
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          current_orchestrator_thread_id AS "currentOrchestratorThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
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
      Effect.mapError(toPersistenceSqlError("ProjectionProgramRepository.getById:query")),
    );

  const listAll: ProjectionProgramRepositoryShape["listAll"] = () =>
    listProjectionProgramRows().pipe(
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
