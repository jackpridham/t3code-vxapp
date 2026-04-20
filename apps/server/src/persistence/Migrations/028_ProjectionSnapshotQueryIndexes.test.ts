import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("028_ProjectionSnapshotQueryIndexes", (it) => {
  it.effect("creates indexes used by bounded snapshot queries", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 28 });

      const rows = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_projection_threads_archived_thread',
            'idx_projection_thread_messages_thread_created_id',
            'idx_projection_thread_proposed_plans_thread_created_id',
            'idx_projection_thread_activities_thread_sequence_created_id',
            'idx_projection_turns_thread_checkpoint_turn',
            'idx_projection_orchestrator_wakes_queued_id'
          )
        ORDER BY name ASC
      `;

      assert.deepEqual(
        rows.map((row) => row.name),
        [
          "idx_projection_orchestrator_wakes_queued_id",
          "idx_projection_thread_activities_thread_sequence_created_id",
          "idx_projection_thread_messages_thread_created_id",
          "idx_projection_thread_proposed_plans_thread_created_id",
          "idx_projection_threads_archived_thread",
          "idx_projection_turns_thread_checkpoint_turn",
        ],
      );
    }),
  );
});
