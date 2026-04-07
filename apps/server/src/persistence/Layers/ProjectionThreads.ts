import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Struct } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadInput,
  GetProjectionThreadInput,
  ListProjectionThreadsByProjectInput,
  ProjectionThread,
  ProjectionThreadRepository,
  type ProjectionThreadRepositoryShape,
} from "../Services/ProjectionThreads.ts";
import { ModelSelection, ThreadLabels } from "@t3tools/contracts";

const ProjectionThreadDbRow = ProjectionThread.mapFields(
  Struct.assign({
    labels: Schema.fromJsonString(ThreadLabels),
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
type ProjectionThreadDbRow = typeof ProjectionThreadDbRow.Type;

const MODEL_LABEL_PREFIX = "model:";

function normalizeThreadLabels(labels: ReadonlyArray<string>, modelSelection: ModelSelection) {
  const normalizedModelLabel = `${MODEL_LABEL_PREFIX}${modelSelection.model}`;
  let replacedModelLabel = false;

  const normalizedLabels = labels.flatMap((label) => {
    if (!label.startsWith(MODEL_LABEL_PREFIX)) {
      return [label];
    }
    if (replacedModelLabel) {
      return [];
    }
    replacedModelLabel = true;
    return [normalizedModelLabel];
  });

  return replacedModelLabel ? normalizedLabels : labels;
}

const makeProjectionThreadRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadRow = SqlSchema.void({
    Request: ProjectionThread,
    execute: (row) => {
      const labels = normalizeThreadLabels(row.labels, row.modelSelection);
      return sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          labels_json,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at,
          orchestrator_project_id,
          orchestrator_thread_id,
          parent_thread_id,
          spawn_role,
          spawned_by,
          workflow_id
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.title},
          ${JSON.stringify(labels)},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.branch},
          ${row.worktreePath},
          ${row.latestTurnId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.deletedAt},
          ${row.orchestratorProjectId},
          ${row.orchestratorThreadId},
          ${row.parentThreadId},
          ${row.spawnRole},
          ${row.spawnedBy},
          ${row.workflowId}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          labels_json = excluded.labels_json,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          latest_turn_id = excluded.latest_turn_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          deleted_at = excluded.deleted_at,
          orchestrator_project_id = excluded.orchestrator_project_id,
          orchestrator_thread_id = excluded.orchestrator_thread_id,
          parent_thread_id = excluded.parent_thread_id,
          spawn_role = excluded.spawn_role,
          spawned_by = excluded.spawned_by,
          workflow_id = excluded.workflow_id
      `;
    },
  });

  const getProjectionThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadInput,
    Result: ProjectionThreadDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          labels_json AS "labels",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt",
          orchestrator_project_id AS "orchestratorProjectId",
          orchestrator_thread_id AS "orchestratorThreadId",
          parent_thread_id AS "parentThreadId",
          spawn_role AS "spawnRole",
          spawned_by AS "spawnedBy",
          workflow_id AS "workflowId"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const listProjectionThreadRows = SqlSchema.findAll({
    Request: ListProjectionThreadsByProjectInput,
    Result: ProjectionThreadDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          labels_json AS "labels",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt",
          orchestrator_project_id AS "orchestratorProjectId",
          orchestrator_thread_id AS "orchestratorThreadId",
          parent_thread_id AS "parentThreadId",
          spawn_role AS "spawnRole",
          spawned_by AS "spawnedBy",
          workflow_id AS "workflowId"
        FROM projection_threads
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const deleteProjectionThreadRow = SqlSchema.void({
    Request: DeleteProjectionThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.upsert:query")),
    );

  const getById: ProjectionThreadRepositoryShape["getById"] = (input) =>
    getProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.getById:query")),
    );

  const listByProjectId: ProjectionThreadRepositoryShape["listByProjectId"] = (input) =>
    listProjectionThreadRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.listByProjectId:query")),
    );

  const deleteById: ProjectionThreadRepositoryShape["deleteById"] = (input) =>
    deleteProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    deleteById,
  } satisfies ProjectionThreadRepositoryShape;
});

export const ProjectionThreadRepositoryLive = Layer.effect(
  ProjectionThreadRepository,
  makeProjectionThreadRepository,
);
