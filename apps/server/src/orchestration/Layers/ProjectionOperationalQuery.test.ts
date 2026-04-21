import { assert, it } from "@effect/vitest";
import {
  CheckpointRef,
  CtoAttentionId,
  NonNegativeInt,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionOperationalQueryLive } from "./ProjectionOperationalQuery.ts";
import { ProjectionOperationalQuery } from "../Services/ProjectionOperationalQuery.ts";

const projectionOperationalQueryLayer = it.layer(
  OrchestrationProjectionOperationalQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const asCtoAttentionId = (value: string): CtoAttentionId => CtoAttentionId.makeUnsafe(value);

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
      assert.equal(
        Object.prototype.hasOwnProperty.call(projects[0], "sidebarParentProjectId"),
        false,
      );
      assert.equal(project?.id, "project-1");
      assert.equal(Object.prototype.hasOwnProperty.call(project, "sidebarParentProjectId"), false);
      assert.equal(project?.defaultModelSelection?.model, "gpt-5-codex");
    }),
  );

  it.effect("omits default parent overrides while preserving configured sidebar parents", () =>
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
          kind,
          sidebar_parent_project_id,
          current_session_root_thread_id,
          default_model_selection_json,
          scripts_json,
          hooks_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-parent',
            'Parent Project',
            '/repos/project-parent',
            'project',
            NULL,
            NULL,
            NULL,
            '[]',
            '[]',
            '2026-04-06T00:00:00.000Z',
            '2026-04-06T00:00:01.000Z',
            NULL
          ),
          (
            'project-worktree',
            'Parent Project Feature',
            '/repos/project-parent/.worktrees/feature',
            'project',
            'project-parent',
            'thread-current',
            NULL,
            '[]',
            '[]',
            '2026-04-06T00:00:02.000Z',
            '2026-04-06T00:00:03.000Z',
            NULL
          )
      `;

      const projects = yield* query.listProjects();
      const parentProject = projects.find((project) => project.id === "project-parent");
      const worktreeProject = projects.find((project) => project.id === "project-worktree");

      assert.equal(
        Object.prototype.hasOwnProperty.call(parentProject, "sidebarParentProjectId"),
        false,
      );
      assert.equal(worktreeProject?.sidebarParentProjectId, "project-parent");
      assert.equal(worktreeProject?.currentSessionRootThreadId, "thread-current");
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
          ),
          (
            'thread-deleted',
            'project-threads',
            'Thread Deleted',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:10.000Z',
            '2026-04-06T00:00:11.000Z',
            NULL,
            '2026-04-06T00:00:12.000Z'
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

      const activeOnly = yield* query.listProjectThreads({
        projectId: ProjectId.makeUnsafe("project-threads"),
        includeArchived: false,
        includeDeleted: false,
      });

      assert.deepEqual(
        activeOnly.map((thread) => thread.id),
        ["thread-active"],
      );
      assert.equal(activeOnly[0]?.session?.status, "ready");
      assert.equal(activeOnly[0]?.latestTurn?.turnId, "turn-active");
      assert.equal(activeOnly[0]?.latestTurn?.completedAt, "2026-04-06T00:00:09.000Z");

      const archivedInclusive = yield* query.listProjectThreads({
        projectId: ProjectId.makeUnsafe("project-threads"),
        includeArchived: true,
        includeDeleted: false,
      });
      assert.deepEqual(
        archivedInclusive.map((thread) => thread.id),
        ["thread-active", "thread-archived"],
      );
      assert.equal(
        archivedInclusive.some((thread) => thread.id === "thread-deleted"),
        false,
      );
    }),
  );

  it.effect("lists full session families across projects and excludes unrelated roots", () =>
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
        VALUES
          (
            'project-orchestrator',
            'Orchestrator',
            '/tmp/orchestrator',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '[]',
            '2026-04-06T00:00:00.000Z',
            '2026-04-06T00:00:01.000Z',
            NULL
          ),
          (
            'project-worker',
            'Worker',
            '/tmp/worker',
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
          deleted_at,
          orchestrator_project_id,
          orchestrator_thread_id,
          parent_thread_id,
          spawn_role,
          spawned_by,
          workflow_id
        )
        VALUES
          (
            'root-1',
            'project-orchestrator',
            'Root One',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:02.000Z',
            '2026-04-06T00:00:03.000Z',
            NULL,
            NULL,
            'project-orchestrator',
            NULL,
            NULL,
            'orchestrator',
            NULL,
            'workflow-1'
          ),
          (
            'worker-1',
            'project-orchestrator',
            'Worker One',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:04.000Z',
            '2026-04-06T00:00:05.000Z',
            NULL,
            NULL,
            'project-orchestrator',
            'root-1',
            NULL,
            'worker',
            'root-1',
            'workflow-1'
          ),
          (
            'worker-2',
            'project-worker',
            'Worker Two',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:06.000Z',
            '2026-04-06T00:00:07.000Z',
            NULL,
            NULL,
            'project-orchestrator',
            'root-1',
            'worker-1',
            'worker',
            'worker-1',
            'workflow-1'
          ),
          (
            'worker-3',
            'project-worker',
            'Worker Three',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:08.000Z',
            '2026-04-06T00:00:09.000Z',
            '2026-04-06T00:00:10.000Z',
            NULL,
            'project-orchestrator',
            NULL,
            NULL,
            'worker',
            NULL,
            'workflow-1'
          ),
          (
            'worker-deleted',
            'project-worker',
            'Worker Deleted',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:15.000Z',
            '2026-04-06T00:00:16.000Z',
            NULL,
            '2026-04-06T00:00:17.000Z',
            'project-orchestrator',
            'root-1',
            'root-1',
            'worker',
            'root-1',
            'workflow-1'
          ),
          (
            'root-deleted',
            'project-orchestrator',
            'Deleted Root',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:18.000Z',
            '2026-04-06T00:00:19.000Z',
            NULL,
            '2026-04-06T00:00:20.000Z',
            'project-orchestrator',
            NULL,
            NULL,
            'orchestrator',
            NULL,
            'workflow-deleted'
          ),
          (
            'worker-under-deleted-root',
            'project-worker',
            'Worker Under Deleted Root',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:21.000Z',
            '2026-04-06T00:00:22.000Z',
            NULL,
            NULL,
            'project-orchestrator',
            'root-deleted',
            'root-deleted',
            'worker',
            'root-deleted',
            'workflow-deleted'
          ),
          (
            'root-2',
            'project-orchestrator',
            'Root Two',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:11.000Z',
            '2026-04-06T00:00:12.000Z',
            NULL,
            NULL,
            'project-orchestrator',
            NULL,
            NULL,
            'orchestrator',
            NULL,
            'workflow-2'
          ),
          (
            'worker-4',
            'project-worker',
            'Worker Four',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:13.000Z',
            '2026-04-06T00:00:14.000Z',
            NULL,
            NULL,
            'project-orchestrator',
            'root-2',
            NULL,
            'worker',
            'root-2',
            'workflow-2'
          )
      `;

      const sessionThreads = yield* query.listSessionThreads({
        rootThreadId: ThreadId.makeUnsafe("root-1"),
        includeArchived: true,
        includeDeleted: false,
      });

      assert.deepEqual(
        sessionThreads.map((thread) => thread.id),
        ["root-1", "worker-1", "worker-2", "worker-3"],
      );
      assert.equal(sessionThreads[2]?.projectId, "project-worker");
      assert.equal(sessionThreads[3]?.archivedAt, "2026-04-06T00:00:10.000Z");
      assert.equal(
        sessionThreads.some((thread) => thread.id === "worker-deleted"),
        false,
      );

      const deletedRootSessionThreads = yield* query.listSessionThreads({
        rootThreadId: ThreadId.makeUnsafe("root-deleted"),
        includeArchived: true,
        includeDeleted: false,
      });
      assert.deepEqual(deletedRootSessionThreads, []);

      const projectThreads = yield* query.listProjectThreads({
        projectId: ProjectId.makeUnsafe("project-orchestrator"),
        includeArchived: true,
        includeDeleted: false,
      });
      const rootOne = projectThreads.find((thread) => thread.id === "root-1");
      const rootTwo = projectThreads.find((thread) => thread.id === "root-2");

      assert.equal(rootOne?.sessionWorkerThreadCount, 3);
      assert.equal(rootTwo?.sessionWorkerThreadCount, 1);
    }),
  );

  it.effect("returns bounded checkpoint context for one thread", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionOperationalQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
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
          'project-checkpoints',
          'Project Checkpoints',
          '/tmp/project-checkpoints',
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
            'thread-with-worktree',
            'project-checkpoints',
            'Thread With Worktree',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            '/tmp/thread-worktree',
            'turn-2',
            '2026-04-06T00:00:02.000Z',
            '2026-04-06T00:00:03.000Z',
            NULL,
            NULL
          ),
          (
            'thread-with-project-root',
            'project-checkpoints',
            'Thread With Project Root',
            '[]',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-04-06T00:00:04.000Z',
            '2026-04-06T00:00:05.000Z',
            NULL,
            NULL
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
        VALUES
          (
            'thread-with-worktree',
            'turn-2',
            NULL,
            NULL,
            NULL,
            'message-2',
            'completed',
            '2026-04-06T00:00:08.000Z',
            '2026-04-06T00:00:08.000Z',
            '2026-04-06T00:00:09.000Z',
            2,
            'refs/checkpoints/thread-with-worktree/2',
            'ready',
            '[{"path":"b.ts","kind":"modified","additions":1,"deletions":0}]'
          ),
          (
            'thread-with-worktree',
            'turn-1',
            NULL,
            NULL,
            NULL,
            'message-1',
            'completed',
            '2026-04-06T00:00:06.000Z',
            '2026-04-06T00:00:06.000Z',
            '2026-04-06T00:00:07.000Z',
            1,
            'refs/checkpoints/thread-with-worktree/1',
            'ready',
            '[]'
          )
      `;

      const worktreeContext = yield* query.getThreadCheckpointContext({
        threadId: ThreadId.makeUnsafe("thread-with-worktree"),
      });
      assert.equal(worktreeContext.threadFound, true);
      assert.equal(worktreeContext.workspaceCwd, "/tmp/thread-worktree");
      assert.deepEqual(
        worktreeContext.checkpoints.map((checkpoint) => checkpoint.checkpointTurnCount),
        [1, 2],
      );
      assert.equal(
        worktreeContext.checkpoints[1]?.checkpointRef,
        CheckpointRef.makeUnsafe("refs/checkpoints/thread-with-worktree/2"),
      );
      assert.equal(worktreeContext.checkpoints[1]?.turnId, TurnId.makeUnsafe("turn-2"));

      const projectRootContext = yield* query.getThreadCheckpointContext({
        threadId: ThreadId.makeUnsafe("thread-with-project-root"),
      });
      assert.equal(projectRootContext.threadFound, true);
      assert.equal(projectRootContext.workspaceCwd, "/tmp/project-checkpoints");
      assert.deepEqual(projectRootContext.checkpoints, []);

      const missingContext = yield* query.getThreadCheckpointContext({
        threadId: ThreadId.makeUnsafe("thread-missing"),
      });
      assert.equal(missingContext.threadFound, false);
      assert.equal(missingContext.workspaceCwd, null);
      assert.deepEqual(missingContext.checkpoints, []);
    }),
  );

  it.effect("returns current state without history and pages thread detail separately", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionOperationalQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_orchestrator_wakes`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_cto_attention`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          kind,
          current_session_root_thread_id,
          default_model_selection_json,
          scripts_json,
          hooks_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-current',
          'Current Project',
          '/tmp/project-current',
          'orchestrator',
          'thread-current',
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
          deleted_at,
          spawn_role,
          workflow_id
        )
        VALUES (
          'thread-current',
          'project-current',
          'Current Thread',
          '[]',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-current',
          '2026-04-06T00:00:02.000Z',
          '2026-04-06T00:00:03.000Z',
          NULL,
          NULL,
          'orchestrator',
          'wf-current'
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
          'thread-current',
          'running',
          'codex',
          'session-current',
          'provider-thread-current',
          'full-access',
          'turn-current',
          NULL,
          '2026-04-06T00:00:04.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_files_json
        )
        VALUES (
          'thread-current',
          'turn-current',
          NULL,
          'msg-3',
          'running',
          '2026-04-06T00:00:05.000Z',
          '2026-04-06T00:00:06.000Z',
          NULL,
          '[]'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          attachments_json,
          created_at,
          updated_at
        )
        VALUES
          ('msg-1', 'thread-current', 'turn-current', 'user', 'one', 0, '[]', '2026-04-06T00:00:07.000Z', '2026-04-06T00:00:07.000Z'),
          ('msg-2', 'thread-current', 'turn-current', 'assistant', 'two', 0, '[]', '2026-04-06T00:00:08.000Z', '2026-04-06T00:00:08.000Z'),
          ('msg-3', 'thread-current', 'turn-current', 'assistant', 'three', 0, '[]', '2026-04-06T00:00:09.000Z', '2026-04-06T00:00:09.000Z')
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          ('activity-1', 'thread-current', 'turn-current', 'info', 'tool.one', 'one', '{}', 1, '2026-04-06T00:00:10.000Z'),
          ('activity-2', 'thread-current', 'turn-current', 'tool', 'tool.two', 'two', '{}', 2, '2026-04-06T00:00:11.000Z'),
          ('activity-3', 'thread-current', 'turn-current', 'tool', 'tool.three', 'three', '{}', 3, '2026-04-06T00:00:12.000Z')
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
          ('wake-1', 'thread-current', 'project-current', 'worker-1', 'project-worker', 'turn-worker-1', 'wf-current', 'Worker One', 'completed', 'first wake', '2026-04-06T00:00:13.000Z', 'pending', NULL, NULL, NULL, NULL),
          ('wake-2', 'thread-current', 'project-current', 'worker-2', 'project-worker', 'turn-worker-2', 'wf-current', 'Worker Two', 'failed', 'second wake', '2026-04-06T00:00:14.000Z', 'pending', NULL, NULL, NULL, NULL)
      `;

      yield* sql`
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
          'program:program-current|kind:decision_required|source-thread:thread-source|source-role:worker|correlation:notif-required',
          'program:program-current|kind:decision_required|source-thread:thread-source|source-role:worker|correlation:notif-required',
          'notif-required',
          'program-current',
          'project-current',
          'thread-current',
          'thread-source',
          'worker',
          'decision_required',
          'warning',
          'Required decision',
          '{"workerThreadId":"thread-source"}',
          'required',
          '2026-04-06T00:00:00.500Z',
          NULL,
          NULL,
          NULL,
          '2026-04-06T00:00:00.500Z',
          '2026-04-06T00:00:00.500Z'
        )
      `;

      for (let index = 1; index <= 26; index += 1) {
        const updatedAt = new Date(
          Date.parse("2026-04-06T00:00:01.000Z") + index * 1_000,
        ).toISOString();
        const notificationId = `notif-terminal-${index}`;
        const kind =
          index % 3 === 1
            ? "final_review_ready"
            : index % 3 === 2
              ? "blocked"
              : "program_completed";
        const state = index % 3 === 1 ? "acknowledged" : index % 3 === 2 ? "resolved" : "dropped";
        yield* sql`
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
            ${`program:program-current|kind:${kind}|source-thread:thread-source|source-role:worker|correlation:${notificationId}`},
            ${`program:program-current|kind:${kind}|source-thread:thread-source|source-role:worker|correlation:${notificationId}`},
            ${notificationId},
            'program-current',
            'project-current',
            'thread-current',
            'thread-source',
            'worker',
            ${kind},
            'warning',
            ${`Terminal attention ${index}`},
            '{"workerThreadId":"thread-source"}',
            ${state},
            ${updatedAt},
            ${state === "acknowledged" ? updatedAt : null},
            ${state === "resolved" ? updatedAt : null},
            ${state === "dropped" ? updatedAt : null},
            ${updatedAt},
            ${updatedAt}
          )
        `;
      }

      const currentState = yield* query.getCurrentState();
      assert.equal(currentState.snapshotProfile, "bootstrap-summary");
      assert.equal(
        Object.prototype.hasOwnProperty.call(currentState.projects[0], "sidebarParentProjectId"),
        false,
      );
      assert.equal(currentState.threads.length, 1);
      assert.equal(currentState.threads[0]?.messages.length, 0);
      assert.equal(currentState.threads[0]?.activities.length, 0);
      assert.equal(currentState.threads[0]?.session?.status, "running");
      assert.equal(currentState.threads[0]?.latestTurn?.state, "running");
      assert.equal(currentState.orchestratorWakeItems.length, 0);
      const ctoAttentionItems = currentState.ctoAttentionItems ?? [];
      assert.equal(ctoAttentionItems.length, 26);
      assert.equal(ctoAttentionItems[0]?.state, "required");
      assert.equal(
        ctoAttentionItems.some(
          (item) => item.notificationId === ProgramNotificationId.makeUnsafe("notif-terminal-1"),
        ),
        false,
      );
      assert.equal(
        ctoAttentionItems.some(
          (item) => item.notificationId === ProgramNotificationId.makeUnsafe("notif-terminal-26"),
        ),
        true,
      );

      const messages = yield* query.listThreadMessages({
        threadId: ThreadId.makeUnsafe("thread-current"),
        limit: NonNegativeInt.makeUnsafe(2),
      });
      assert.deepEqual(
        messages.map((message) => message.id),
        ["msg-2", "msg-3"],
      );

      const olderMessages = yield* query.listThreadMessages({
        threadId: ThreadId.makeUnsafe("thread-current"),
        limit: NonNegativeInt.makeUnsafe(2),
        beforeCreatedAt: "2026-04-06T00:00:09.000Z",
      });
      assert.deepEqual(
        olderMessages.map((message) => message.id),
        ["msg-1", "msg-2"],
      );

      const activities = yield* query.listThreadActivities({
        threadId: ThreadId.makeUnsafe("thread-current"),
        limit: NonNegativeInt.makeUnsafe(2),
        beforeSequence: NonNegativeInt.makeUnsafe(3),
      });
      assert.deepEqual(
        activities.map((activity) => activity.sequence),
        [1, 2],
      );

      const sessions = yield* query.listThreadSessions({
        threadId: ThreadId.makeUnsafe("thread-current"),
      });
      assert.equal(sessions[0]?.status, "running");

      const wakes = yield* query.listOrchestratorWakes({
        orchestratorThreadId: ThreadId.makeUnsafe("thread-current"),
        limit: NonNegativeInt.makeUnsafe(1),
      });
      assert.deepEqual(
        wakes.map((wake) => wake.wakeId),
        ["wake-2"],
      );
    }),
  );
});
