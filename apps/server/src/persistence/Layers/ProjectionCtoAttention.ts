import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionCtoAttentionByKeyInput,
  GetProjectionCtoAttentionByNotificationIdInput,
  GetProjectionCtoAttentionInput,
  ProjectionCtoAttention,
  ProjectionCtoAttentionRepository,
  type ProjectionCtoAttentionRepositoryShape,
} from "../Services/ProjectionCtoAttention.ts";

const ProjectionCtoAttentionDbRow = Schema.Struct({
  ...ProjectionCtoAttention.fields,
  evidence: Schema.String,
});
type ProjectionCtoAttentionDbRow = typeof ProjectionCtoAttentionDbRow.Type;

const decodeEvidence = (row: ProjectionCtoAttentionDbRow): ProjectionCtoAttention => ({
  ...row,
  evidence: JSON.parse(row.evidence) as ProjectionCtoAttention["evidence"],
});

const makeProjectionCtoAttentionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionCtoAttentionRow = SqlSchema.void({
    Request: ProjectionCtoAttention,
    execute: (row) =>
      sql`
        INSERT INTO projection_cto_attention (
          attention_id,
          attention_key,
          notification_id,
          program_id,
          executive_project_id,
          executive_thread_id,
          source_thread_id,
          source_role,
          kind,
          severity,
          summary,
          evidence_json,
          state,
          queued_at,
          acknowledged_at,
          resolved_at,
          dropped_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.attentionId},
          ${row.attentionKey},
          ${row.notificationId},
          ${row.programId},
          ${row.executiveProjectId},
          ${row.executiveThreadId},
          ${row.sourceThreadId},
          ${row.sourceRole},
          ${row.kind},
          ${row.severity},
          ${row.summary},
          ${JSON.stringify(row.evidence)},
          ${row.state},
          ${row.queuedAt},
          ${row.acknowledgedAt},
          ${row.resolvedAt},
          ${row.droppedAt},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (attention_key)
        DO UPDATE SET
          attention_id = excluded.attention_id,
          notification_id = excluded.notification_id,
          program_id = excluded.program_id,
          executive_project_id = excluded.executive_project_id,
          executive_thread_id = excluded.executive_thread_id,
          source_thread_id = excluded.source_thread_id,
          source_role = excluded.source_role,
          kind = excluded.kind,
          severity = excluded.severity,
          summary = excluded.summary,
          evidence_json = excluded.evidence_json,
          state = excluded.state,
          queued_at = excluded.queued_at,
          acknowledged_at = excluded.acknowledged_at,
          resolved_at = excluded.resolved_at,
          dropped_at = excluded.dropped_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionCtoAttentionRow = SqlSchema.findOneOption({
    Request: GetProjectionCtoAttentionInput,
    Result: ProjectionCtoAttentionDbRow,
    execute: ({ attentionId }) =>
      sql`
        SELECT
          attention_id AS "attentionId",
          attention_key AS "attentionKey",
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          source_thread_id AS "sourceThreadId",
          source_role AS "sourceRole",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          acknowledged_at AS "acknowledgedAt",
          resolved_at AS "resolvedAt",
          dropped_at AS "droppedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cto_attention
        WHERE attention_id = ${attentionId}
      `,
  });

  const getProjectionCtoAttentionRowByKey = SqlSchema.findOneOption({
    Request: GetProjectionCtoAttentionByKeyInput,
    Result: ProjectionCtoAttentionDbRow,
    execute: ({ attentionKey }) =>
      sql`
        SELECT
          attention_id AS "attentionId",
          attention_key AS "attentionKey",
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          source_thread_id AS "sourceThreadId",
          source_role AS "sourceRole",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          acknowledged_at AS "acknowledgedAt",
          resolved_at AS "resolvedAt",
          dropped_at AS "droppedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cto_attention
        WHERE attention_key = ${attentionKey}
      `,
  });

  const getProjectionCtoAttentionRowByNotificationId = SqlSchema.findOneOption({
    Request: GetProjectionCtoAttentionByNotificationIdInput,
    Result: ProjectionCtoAttentionDbRow,
    execute: ({ notificationId }) =>
      sql`
        SELECT
          attention_id AS "attentionId",
          attention_key AS "attentionKey",
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          source_thread_id AS "sourceThreadId",
          source_role AS "sourceRole",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          acknowledged_at AS "acknowledgedAt",
          resolved_at AS "resolvedAt",
          dropped_at AS "droppedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cto_attention
        WHERE notification_id = ${notificationId}
      `,
  });

  const listProjectionCtoAttentionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCtoAttentionDbRow,
    execute: () =>
      sql`
        SELECT
          attention_id AS "attentionId",
          attention_key AS "attentionKey",
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          source_thread_id AS "sourceThreadId",
          source_role AS "sourceRole",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          acknowledged_at AS "acknowledgedAt",
          resolved_at AS "resolvedAt",
          dropped_at AS "droppedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cto_attention
        ORDER BY queued_at DESC, attention_id ASC
      `,
  });

  const upsert: ProjectionCtoAttentionRepositoryShape["upsert"] = (row) =>
    upsertProjectionCtoAttentionRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionCtoAttentionRepository.upsert:query")),
    );

  const getById: ProjectionCtoAttentionRepositoryShape["getById"] = (input) =>
    getProjectionCtoAttentionRow(input).pipe(
      Effect.map((option) => option.pipe(Option.map(decodeEvidence))),
      Effect.mapError(toPersistenceSqlError("ProjectionCtoAttentionRepository.getById:query")),
    );

  const getByKey: ProjectionCtoAttentionRepositoryShape["getByKey"] = (input) =>
    getProjectionCtoAttentionRowByKey(input).pipe(
      Effect.map((option) => option.pipe(Option.map(decodeEvidence))),
      Effect.mapError(toPersistenceSqlError("ProjectionCtoAttentionRepository.getByKey:query")),
    );

  const getByNotificationId: ProjectionCtoAttentionRepositoryShape["getByNotificationId"] = (
    input,
  ) =>
    getProjectionCtoAttentionRowByNotificationId(input).pipe(
      Effect.map((option) => option.pipe(Option.map(decodeEvidence))),
      Effect.mapError(
        toPersistenceSqlError("ProjectionCtoAttentionRepository.getByNotificationId:query"),
      ),
    );

  const listAll: ProjectionCtoAttentionRepositoryShape["listAll"] = () =>
    listProjectionCtoAttentionRows().pipe(
      Effect.map((rows) => rows.map(decodeEvidence)),
      Effect.mapError(toPersistenceSqlError("ProjectionCtoAttentionRepository.listAll:query")),
    );

  return {
    upsert,
    getById,
    getByKey,
    getByNotificationId,
    listAll,
  } satisfies ProjectionCtoAttentionRepositoryShape;
});

export const ProjectionCtoAttentionRepositoryLive = Layer.effect(
  ProjectionCtoAttentionRepository,
  makeProjectionCtoAttentionRepository,
);
