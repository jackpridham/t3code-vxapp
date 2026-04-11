import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("026_ReconcileCompletedWakeTurnStatus", (it) => {
  it.effect(
    "marks stale interrupted ready turns completed only when a completed wake exists without an interrupt event",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 25 });

        yield* sql`
          INSERT INTO projection_turns (
            thread_id,
            turn_id,
            pending_message_id,
            source_proposed_plan_thread_id,
            source_proposed_plan_id,
            assistant_message_id,
            state,
            requested_at,
            started_at,
            completed_at,
            checkpoint_turn_count,
            checkpoint_ref,
            checkpoint_status,
            checkpoint_files_json
          )
          VALUES
            (
              'thread-completed',
              'turn-completed',
              NULL,
              NULL,
              NULL,
              'assistant-completed',
              'interrupted',
              '2026-04-11T01:00:00.000Z',
              '2026-04-11T01:00:00.000Z',
              '2026-04-11T01:00:05.000Z',
              1,
              'refs/t3/checkpoints/thread-completed/turn/1',
              'ready',
              '[]'
            ),
            (
              'thread-interrupted',
              'turn-interrupted',
              NULL,
              NULL,
              NULL,
              'assistant-interrupted',
              'interrupted',
              '2026-04-11T01:01:00.000Z',
              '2026-04-11T01:01:00.000Z',
              '2026-04-11T01:01:05.000Z',
              1,
              'refs/t3/checkpoints/thread-interrupted/turn/1',
              'ready',
              '[]'
            ),
            (
              'thread-no-wake',
              'turn-no-wake',
              NULL,
              NULL,
              NULL,
              'assistant-no-wake',
              'interrupted',
              '2026-04-11T01:02:00.000Z',
              '2026-04-11T01:02:00.000Z',
              '2026-04-11T01:02:05.000Z',
              1,
              'refs/t3/checkpoints/thread-no-wake/turn/1',
              'ready',
              '[]'
            )
        `;

        yield* sql`
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
          VALUES
            (
              'wake-completed',
              'orchestrator-thread',
              'orchestrator-project',
              'thread-completed',
              'worker-project',
              'turn-completed',
              'workflow-1',
              'Completed worker',
              'completed',
              'done',
              '2026-04-11T01:00:06.000Z',
              'consumed',
              NULL,
              '2026-04-11T01:00:07.000Z',
              '2026-04-11T01:00:08.000Z',
              'worker_rechecked'
            ),
            (
              'wake-interrupted',
              'orchestrator-thread',
              'orchestrator-project',
              'thread-interrupted',
              'worker-project',
              'turn-interrupted',
              'workflow-1',
              'Interrupted worker',
              'completed',
              'done after interrupt marker',
              '2026-04-11T01:01:06.000Z',
              'consumed',
              NULL,
              '2026-04-11T01:01:07.000Z',
              '2026-04-11T01:01:08.000Z',
              'worker_rechecked'
            )
        `;

        yield* sql`
          INSERT INTO orchestration_events (
            event_id,
            aggregate_kind,
            stream_id,
            stream_version,
            event_type,
            occurred_at,
            command_id,
            causation_event_id,
            correlation_id,
            actor_kind,
            payload_json,
            metadata_json
          )
          VALUES (
            'event-interrupt',
            'thread',
            'thread-interrupted',
            1,
            'thread.turn-interrupt-requested',
            '2026-04-11T01:01:03.000Z',
            'command-interrupt',
            NULL,
            'command-interrupt',
            'user',
            '{"threadId":"thread-interrupted","turnId":"turn-interrupted","createdAt":"2026-04-11T01:01:03.000Z"}',
            '{}'
          )
        `;

        yield* runMigrations({ toMigrationInclusive: 26 });

        const rows = yield* sql<{
          readonly threadId: string;
          readonly state: string;
        }>`
          SELECT thread_id AS "threadId", state
          FROM projection_turns
          ORDER BY thread_id
        `;

        assert.deepStrictEqual(rows, [
          { threadId: "thread-completed", state: "completed" },
          { threadId: "thread-interrupted", state: "interrupted" },
          { threadId: "thread-no-wake", state: "interrupted" },
        ]);
      }),
  );
});
