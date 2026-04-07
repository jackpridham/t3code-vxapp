import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ListProjectionOrchestratorWakesByThreadInput,
  ListProjectionWorkerWakesInput,
  ProjectionOrchestratorWake,
  ProjectionOrchestratorWakeRepository,
  type ProjectionOrchestratorWakeRepositoryShape,
} from "../Services/ProjectionOrchestratorWakes.ts";

const makeProjectionOrchestratorWakeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionOrchestratorWakeRow = SqlSchema.void({
    Request: ProjectionOrchestratorWake,
    execute: (row) => sql`
      INSERT INTO projection_orchestrator_wakes (
        wake_id,
        orchestrator_thread_id,
        orchestrator_project_id,
        worker_thread_id,
        worker_project_id,
        worker_turn_id,
        workflow_id,
        worker_title_snapshot,
        outcome,
        summary,
        queued_at,
        state,
        delivery_message_id,
        delivered_at,
        consumed_at,
        consume_reason
      )
      VALUES (
        ${row.wakeId},
        ${row.orchestratorThreadId},
        ${row.orchestratorProjectId},
        ${row.workerThreadId},
        ${row.workerProjectId},
        ${row.workerTurnId},
        ${row.workflowId},
        ${row.workerTitleSnapshot},
        ${row.outcome},
        ${row.summary},
        ${row.queuedAt},
        ${row.state},
        ${row.deliveryMessageId},
        ${row.deliveredAt},
        ${row.consumedAt},
        ${row.consumeReason}
      )
      ON CONFLICT (wake_id)
      DO UPDATE SET
        orchestrator_thread_id = excluded.orchestrator_thread_id,
        orchestrator_project_id = excluded.orchestrator_project_id,
        worker_thread_id = excluded.worker_thread_id,
        worker_project_id = excluded.worker_project_id,
        worker_turn_id = excluded.worker_turn_id,
        workflow_id = excluded.workflow_id,
        worker_title_snapshot = excluded.worker_title_snapshot,
        outcome = excluded.outcome,
        summary = excluded.summary,
        queued_at = excluded.queued_at,
        state = excluded.state,
        delivery_message_id = excluded.delivery_message_id,
        delivered_at = excluded.delivered_at,
        consumed_at = excluded.consumed_at,
        consume_reason = excluded.consume_reason
    `,
  });

  const listProjectionOrchestratorWakeRows = SqlSchema.findAll({
    Request: ListProjectionOrchestratorWakesByThreadInput,
    Result: ProjectionOrchestratorWake,
    execute: ({ orchestratorThreadId }) => sql`
      SELECT
        wake_id AS "wakeId",
        orchestrator_thread_id AS "orchestratorThreadId",
        orchestrator_project_id AS "orchestratorProjectId",
        worker_thread_id AS "workerThreadId",
        worker_project_id AS "workerProjectId",
        worker_turn_id AS "workerTurnId",
        workflow_id AS "workflowId",
        worker_title_snapshot AS "workerTitleSnapshot",
        outcome,
        summary,
        queued_at AS "queuedAt",
        state,
        delivery_message_id AS "deliveryMessageId",
        delivered_at AS "deliveredAt",
        consumed_at AS "consumedAt",
        consume_reason AS "consumeReason"
      FROM projection_orchestrator_wakes
      WHERE orchestrator_thread_id = ${orchestratorThreadId}
      ORDER BY queued_at ASC, wake_id ASC
    `,
  });

  const listPendingProjectionOrchestratorWakeRows = SqlSchema.findAll({
    Request: ListProjectionOrchestratorWakesByThreadInput,
    Result: ProjectionOrchestratorWake,
    execute: ({ orchestratorThreadId }) => sql`
      SELECT
        wake_id AS "wakeId",
        orchestrator_thread_id AS "orchestratorThreadId",
        orchestrator_project_id AS "orchestratorProjectId",
        worker_thread_id AS "workerThreadId",
        worker_project_id AS "workerProjectId",
        worker_turn_id AS "workerTurnId",
        workflow_id AS "workflowId",
        worker_title_snapshot AS "workerTitleSnapshot",
        outcome,
        summary,
        queued_at AS "queuedAt",
        state,
        delivery_message_id AS "deliveryMessageId",
        delivered_at AS "deliveredAt",
        consumed_at AS "consumedAt",
        consume_reason AS "consumeReason"
      FROM projection_orchestrator_wakes
      WHERE orchestrator_thread_id = ${orchestratorThreadId}
        AND state = 'pending'
      ORDER BY queued_at ASC, wake_id ASC
    `,
  });

  const listUndeliveredProjectionOrchestratorWakeRows = SqlSchema.findAll({
    Request: ListProjectionWorkerWakesInput,
    Result: ProjectionOrchestratorWake,
    execute: ({ workerThreadId }) => sql`
      SELECT
        wake_id AS "wakeId",
        orchestrator_thread_id AS "orchestratorThreadId",
        orchestrator_project_id AS "orchestratorProjectId",
        worker_thread_id AS "workerThreadId",
        worker_project_id AS "workerProjectId",
        worker_turn_id AS "workerTurnId",
        workflow_id AS "workflowId",
        worker_title_snapshot AS "workerTitleSnapshot",
        outcome,
        summary,
        queued_at AS "queuedAt",
        state,
        delivery_message_id AS "deliveryMessageId",
        delivered_at AS "deliveredAt",
        consumed_at AS "consumedAt",
        consume_reason AS "consumeReason"
      FROM projection_orchestrator_wakes
      WHERE worker_thread_id = ${workerThreadId}
        AND state IN ('pending', 'delivering')
      ORDER BY queued_at ASC, wake_id ASC
    `,
  });

  const upsert: ProjectionOrchestratorWakeRepositoryShape["upsert"] = (row) =>
    upsertProjectionOrchestratorWakeRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorWakeRepository.upsert:query")),
    );

  const listByOrchestratorThreadId: ProjectionOrchestratorWakeRepositoryShape["listByOrchestratorThreadId"] =
    (input) =>
      listProjectionOrchestratorWakeRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionOrchestratorWakeRepository.listByOrchestratorThreadId:query",
          ),
        ),
      );

  const listPendingByOrchestratorThreadId: ProjectionOrchestratorWakeRepositoryShape["listPendingByOrchestratorThreadId"] =
    (input) =>
      listPendingProjectionOrchestratorWakeRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionOrchestratorWakeRepository.listPendingByOrchestratorThreadId:query",
          ),
        ),
      );

  const listUndeliveredByWorkerThreadId: ProjectionOrchestratorWakeRepositoryShape["listUndeliveredByWorkerThreadId"] =
    (input) =>
      listUndeliveredProjectionOrchestratorWakeRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionOrchestratorWakeRepository.listUndeliveredByWorkerThreadId:query",
          ),
        ),
      );

  return {
    upsert,
    listByOrchestratorThreadId,
    listPendingByOrchestratorThreadId,
    listUndeliveredByWorkerThreadId,
  } satisfies ProjectionOrchestratorWakeRepositoryShape;
});

export const ProjectionOrchestratorWakeRepositoryLive = Layer.effect(
  ProjectionOrchestratorWakeRepository,
  makeProjectionOrchestratorWakeRepository,
);
