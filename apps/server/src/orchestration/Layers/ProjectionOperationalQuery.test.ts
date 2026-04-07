import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionOperationalQueryLive } from "./ProjectionOperationalQuery.ts";
import { ProjectionOperationalQuery } from "../Services/ProjectionOperationalQuery.ts";

const projectionOperationalQueryLayer = it.layer(
  OrchestrationProjectionOperationalQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

projectionOperationalQueryLayer("ProjectionOperationalQuery", (it) => {
  it.effect("lists project summaries and resolves readiness counts", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionOperationalQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
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
        VALUES (
          'thread-1',
          'project-1',
          'Thread One',
          '[]',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-1',
          '2026-04-06T00:00:02.000Z',
          '2026-04-06T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      let sequence = 10;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
          VALUES (${projector}, ${sequence}, '2026-04-06T00:00:04.000Z')
        `;
        sequence += 1;
      }

      const readiness = yield* query.getReadiness();
      const projects = yield* query.listProjects();
      const project = yield* query.getProjectByWorkspace({
        workspaceRoot: "/tmp/project-one",
      });

      assert.deepEqual(readiness, {
        snapshotSequence: 10,
        projectCount: 1,
        threadCount: 1,
      });
      assert.equal(projects.length, 1);
      assert.equal(projects[0]?.id, "project-1");
      assert.equal(project?.id, "project-1");
      assert.equal(project?.defaultModelSelection?.model, "gpt-5-codex");
    }),
  );

  it.effect("lists bounded project threads with latest turn and session summaries", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionOperationalQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;

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
          'project-threads',
          'Project Threads',
          '/tmp/project-threads',
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
            'project-threads',
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
            'project-threads',
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

      const threads = yield* query.listProjectThreads({
        projectId: ProjectId.makeUnsafe("project-threads"),
        includeArchived: false,
        includeDeleted: false,
      });

      assert.equal(threads.length, 1);
      assert.equal(threads[0]?.id, "thread-active");
      assert.equal(threads[0]?.session?.status, "ready");
      assert.equal(threads[0]?.latestTurn?.turnId, "turn-active");
      assert.equal(threads[0]?.latestTurn?.completedAt, "2026-04-06T00:00:09.000Z");
    }),
  );
});
