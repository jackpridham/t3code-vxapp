import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionBootstrapSummaryQueryLive } from "./ProjectionBootstrapSummaryQuery.ts";
import { ProjectionBootstrapSummaryQuery } from "../Services/ProjectionBootstrapSummaryQuery.ts";

const projectionBootstrapSummaryLayer = it.layer(
  OrchestrationProjectionBootstrapSummaryQueryLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

projectionBootstrapSummaryLayer("ProjectionBootstrapSummaryQuery", (it) => {
  it.effect("returns a bounded bootstrap read model without archived threads", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionBootstrapSummaryQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_orchestrator_wakes`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          hooks_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project One',
          '/tmp/project-one',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '[]',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
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
          deleted_at
        )
        VALUES
          (
            'thread-active',
            'project-1',
            'Thread Active',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            'turn-active',
            '2026-04-06T00:00:02.000Z',
            '2026-04-06T00:00:03.000Z',
            NULL,
            NULL
          ),
          (
            'thread-archived',
            'project-1',
            'Thread Archived',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:04.000Z',
            '2026-04-06T00:00:05.000Z',
            '2026-04-06T00:00:06.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'thread-active',
          'ready',
          'codex',
          'provider-session-1',
          'provider-thread-1',
          'full-access',
          NULL,
          NULL,
          '2026-04-06T00:00:07.000Z'
        )
      `;

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
        VALUES (
          'thread-active',
          'turn-active',
          NULL,
          NULL,
          NULL,
          NULL,
          'completed',
          '2026-04-06T00:00:08.000Z',
          '2026-04-06T00:00:08.000Z',
          '2026-04-06T00:00:09.000Z',
          NULL,
          NULL,
          NULL,
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
        VALUES (
          'wake-1',
          'thread-active',
          'project-1',
          'thread-worker-1',
          'project-worker-1',
          'turn-worker-1',
          NULL,
          'Worker One',
          'completed',
          'Worker finished',
          '2026-04-06T00:00:10.000Z',
          'pending',
          NULL,
          NULL,
          NULL,
          NULL
        )
      `;

      let sequence = 10;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
          VALUES (${projector}, ${sequence}, '2026-04-06T00:00:11.000Z')
        `;
        sequence += 1;
      }

      const summary = yield* query.getBootstrapSummary();

      assert.equal(summary.snapshotSequence, 10);
      assert.equal(summary.snapshotProfile, "bootstrap-summary");
      assert.equal(summary.projects.length, 1);
      assert.equal(summary.threads.length, 1);
      assert.equal(summary.threads[0]?.id, "thread-active");
      assert.deepEqual(summary.threads[0]?.messages, []);
      assert.deepEqual(summary.threads[0]?.proposedPlans, []);
      assert.deepEqual(summary.threads[0]?.activities, []);
      assert.deepEqual(summary.threads[0]?.checkpoints, []);
      assert.equal(summary.threads[0]?.session?.status, "ready");
      assert.equal(summary.threads[0]?.latestTurn?.turnId, "turn-active");
      assert.equal(summary.orchestratorWakeItems.length, 1);
    }),
  );
});
