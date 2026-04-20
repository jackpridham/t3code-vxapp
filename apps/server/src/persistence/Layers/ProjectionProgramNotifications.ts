import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionProgramNotificationInput,
  GetProjectionProgramNotificationInput,
  ProjectionProgramNotification,
  ProjectionProgramNotificationRepository,
  type ProjectionProgramNotificationRepositoryShape,
} from "../Services/ProjectionProgramNotifications.ts";

const ProjectionProgramNotificationDbRow = Schema.Struct({
  ...ProjectionProgramNotification.fields,
  evidence: Schema.String,
  consumeReason: Schema.NullOr(Schema.String),
  dropReason: Schema.NullOr(Schema.String),
});
type ProjectionProgramNotificationDbRow = typeof ProjectionProgramNotificationDbRow.Type;

const decodeEvidence = (row: ProjectionProgramNotificationDbRow): ProjectionProgramNotification => {
  const { consumeReason, dropReason, evidence, ...rest } = row;
  return {
    ...rest,
    evidence: JSON.parse(evidence) as ProjectionProgramNotification["evidence"],
    ...(consumeReason === null ? {} : { consumeReason }),
    ...(dropReason === null ? {} : { dropReason }),
  };
};

const makeProjectionProgramNotificationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProgramNotificationRow = SqlSchema.void({
    Request: ProjectionProgramNotification,
    execute: (row) =>
      sql`
        INSERT INTO projection_program_notifications (
          notification_id,
          program_id,
          executive_project_id,
          executive_thread_id,
          orchestrator_thread_id,
          kind,
          severity,
          summary,
          evidence_json,
          state,
          queued_at,
          delivered_at,
          consumed_at,
          dropped_at,
          consume_reason,
          drop_reason,
          created_at,
          updated_at
        )
        VALUES (
          ${row.notificationId},
          ${row.programId},
          ${row.executiveProjectId},
          ${row.executiveThreadId},
          ${row.orchestratorThreadId},
          ${row.kind},
          ${row.severity},
          ${row.summary},
          ${JSON.stringify(row.evidence)},
          ${row.state},
          ${row.queuedAt},
          ${row.deliveredAt},
          ${row.consumedAt},
          ${row.droppedAt},
          ${row.consumeReason ?? null},
          ${row.dropReason ?? null},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (notification_id)
        DO UPDATE SET
          program_id = excluded.program_id,
          executive_project_id = excluded.executive_project_id,
          executive_thread_id = excluded.executive_thread_id,
          orchestrator_thread_id = excluded.orchestrator_thread_id,
          kind = excluded.kind,
          severity = excluded.severity,
          summary = excluded.summary,
          evidence_json = excluded.evidence_json,
          state = excluded.state,
          queued_at = excluded.queued_at,
          delivered_at = excluded.delivered_at,
          consumed_at = excluded.consumed_at,
          dropped_at = excluded.dropped_at,
          consume_reason = excluded.consume_reason,
          drop_reason = excluded.drop_reason,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionProgramNotificationRow = SqlSchema.findOneOption({
    Request: GetProjectionProgramNotificationInput,
    Result: ProjectionProgramNotificationDbRow,
    execute: ({ notificationId }) =>
      sql`
        SELECT
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          orchestrator_thread_id AS "orchestratorThreadId",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          delivered_at AS "deliveredAt",
          consumed_at AS "consumedAt",
          dropped_at AS "droppedAt",
          consume_reason AS "consumeReason",
          drop_reason AS "dropReason",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_program_notifications
        WHERE notification_id = ${notificationId}
      `,
  });

  const listProjectionProgramNotificationRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProgramNotificationDbRow,
    execute: () =>
      sql`
        SELECT
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          orchestrator_thread_id AS "orchestratorThreadId",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          delivered_at AS "deliveredAt",
          consumed_at AS "consumedAt",
          dropped_at AS "droppedAt",
          consume_reason AS "consumeReason",
          drop_reason AS "dropReason",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_program_notifications
        ORDER BY queued_at DESC, notification_id ASC
      `,
  });

  const deleteProjectionProgramNotificationRow = SqlSchema.void({
    Request: DeleteProjectionProgramNotificationInput,
    execute: ({ notificationId }) =>
      sql`
        DELETE FROM projection_program_notifications
        WHERE notification_id = ${notificationId}
      `,
  });

  const upsert: ProjectionProgramNotificationRepositoryShape["upsert"] = (row) =>
    upsertProjectionProgramNotificationRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionProgramNotificationRepository.upsert:query"),
      ),
    );

  const getById: ProjectionProgramNotificationRepositoryShape["getById"] = (input) =>
    getProjectionProgramNotificationRow(input).pipe(
      Effect.map((option) => option.pipe(Option.map(decodeEvidence))),
      Effect.mapError(
        toPersistenceSqlError("ProjectionProgramNotificationRepository.getById:query"),
      ),
    );

  const listAll: ProjectionProgramNotificationRepositoryShape["listAll"] = () =>
    listProjectionProgramNotificationRows().pipe(
      Effect.map((rows) => rows.map(decodeEvidence)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionProgramNotificationRepository.listAll:query"),
      ),
    );

  const deleteById: ProjectionProgramNotificationRepositoryShape["deleteById"] = (input) =>
    deleteProjectionProgramNotificationRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionProgramNotificationRepository.deleteById:query"),
      ),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionProgramNotificationRepositoryShape;
});

export const ProjectionProgramNotificationRepositoryLive = Layer.effect(
  ProjectionProgramNotificationRepository,
  makeProjectionProgramNotificationRepository,
);
