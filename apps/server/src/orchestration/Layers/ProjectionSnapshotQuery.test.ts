import {
  CheckpointRef,
  CtoAttentionId,
  EventId,
  MessageId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asProgramId = (value: string): ProgramId => ProgramId.makeUnsafe(value);
const asProgramNotificationId = (value: string): ProgramNotificationId =>
  ProgramNotificationId.makeUnsafe(value);
const asCtoAttentionId = (value: string): CtoAttentionId => CtoAttentionId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);

const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

projectionSnapshotLayer("ProjectionSnapshotQuery", (it) => {
  it.effect("hydrates read model from projection tables and computes snapshot sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_program_notifications`;
      yield* sql`DELETE FROM projection_cto_attention`;
      yield* sql`DELETE FROM projection_programs`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_orchestrator_wakes`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_programs (
          program_id,
          title,
          objective,
          status,
          declared_repos_json,
          affected_app_targets_json,
          required_local_suites_json,
          required_external_e2e_suites_json,
          require_development_deploy,
          require_external_e2e,
          require_clean_post_flight,
          require_pr_per_repo,
          executive_project_id,
          executive_thread_id,
          current_orchestrator_thread_id,
          repo_prs_json,
          local_validation_json,
          app_validations_json,
          observed_repos_json,
          post_flight_json,
          created_at,
          updated_at,
          completed_at,
          cancel_reason,
          cancelled_at,
          superseded_by_program_id,
          deleted_at
        )
        VALUES (
          'program-cto',
          'Founder task',
          'Convert founder request into Jasper orchestration.',
          'active',
          '["t3code-vxapp","vortex-scripts"]',
          '["web","api"]',
          '[{"repo":"t3code-vxapp","suiteId":"lint","description":"Run lint before review."}]',
          '[{"target":"web","suiteId":"founder-e2e","description":"Founder-visible E2E."}]',
          1,
          1,
          1,
          1,
          'project-1',
          'thread-1',
          'thread-1',
          '[{"repo":"t3code-vxapp","url":"https://github.com/t3tools/t3code-vxapp/pull/42","number":42,"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED","mergeStateStatus":"CLEAN","headRefName":"feature/program-closeout","baseRefName":"main","updatedAt":"2026-02-24T00:00:01.300Z"}]',
          '[{"repo":"t3code-vxapp","suiteId":"lint","kind":"bun_lint","status":"passed","summary":"bun lint passed","command":"bun lint","recordedAt":"2026-02-24T00:00:01.350Z"}]',
          '[{"target":"web","kind":"development_deploy","suiteId":"dev-deploy","status":"passed","summary":"Development deploy succeeded","command":"vx apps web --deploy development","url":"https://web.dev.example.test","recordedAt":"2026-02-24T00:00:01.360Z"}]',
          '[{"repo":"t3code-vxapp","source":"git-status","observedAt":"2026-02-24T00:00:01.370Z"}]',
          '{"status":"clean","summary":"Closeout checks passed","recordedAt":"2026-02-24T00:00:01.380Z"}',
          '2026-02-24T00:00:01.250Z',
          '2026-02-24T00:00:01.500Z',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        )
      `;

      yield* sql`
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
          'notif-cto',
          'program-cto',
          'project-1',
          'thread-1',
          'thread-1',
          'decision_required',
          'warning',
          'Choose the deployment lane.',
          '{"workerThreadId":"thread-worker-1"}',
          'pending',
          '2026-02-24T00:00:01.750Z',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:01.750Z',
          '2026-02-24T00:00:01.750Z'
        )
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
        VALUES
          (
            'program:program-cto|kind:decision_required|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto',
            'program:program-cto|kind:decision_required|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto',
            'notif-cto',
            'program-cto',
            'project-1',
            'thread-1',
            'thread-worker-1',
            'worker',
            'decision_required',
            'warning',
            'Choose the deployment lane.',
            '{"workerThreadId":"thread-worker-1"}',
            'required',
            '2026-02-24T00:00:01.750Z',
            NULL,
            NULL,
            NULL,
            '2026-02-24T00:00:01.750Z',
            '2026-02-24T00:00:01.750Z'
          ),
          (
            'program:program-cto|kind:final_review_ready|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto-terminal',
            'program:program-cto|kind:final_review_ready|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto-terminal',
            'notif-cto-terminal',
            'program-cto',
            'project-1',
            'thread-1',
            'thread-worker-1',
            'worker',
            'final_review_ready',
            'info',
            'Review is ready and later resolved.',
            '{"workerThreadId":"thread-worker-1"}',
            'resolved',
            '2026-02-24T00:00:02.250Z',
            NULL,
            '2026-02-24T00:00:02.500Z',
            NULL,
            '2026-02-24T00:00:02.250Z',
            '2026-02-24T00:00:02.500Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          'turn-1',
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-archived',
          'project-1',
          'Archived thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:03.500Z',
          '2026-02-24T00:00:09.500Z',
          '2026-02-24T00:00:09.500Z',
          NULL
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
          created_at,
          updated_at
        )
        VALUES (
          'message-1',
          'thread-1',
          'turn-1',
          'assistant',
          'hello from projection',
          0,
          '2026-02-24T00:00:04.000Z',
          '2026-02-24T00:00:05.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          implemented_at,
          implementation_thread_id,
          created_at,
          updated_at
        )
        VALUES (
          'plan-1',
          'thread-1',
          'turn-1',
          '# Ship it',
          '2026-02-24T00:00:05.500Z',
          'thread-2',
          '2026-02-24T00:00:05.000Z',
          '2026-02-24T00:00:05.500Z'
        )
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
          created_at
        )
        VALUES (
          'activity-1',
          'thread-1',
          'turn-1',
          'info',
          'runtime.note',
          'provider started',
          '{"stage":"start"}',
          '2026-02-24T00:00:06.000Z'
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
          'thread-1',
          'running',
          'codex',
          'provider-session-1',
          'provider-thread-1',
          'approval-required',
          'turn-1',
          NULL,
          '2026-02-24T00:00:07.000Z'
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
          'wake:thread-worker-1:turn-1:completed',
          'thread-1',
          'project-1',
          'thread-worker-1',
          'project-worker-1',
          'turn-1',
          'wf-1',
          'Worker One',
          'completed',
          'Ready for orchestrator review',
          '2026-02-24T00:00:07.500Z',
          'delivered',
          'message-2',
          '2026-02-24T00:00:07.750Z',
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
        VALUES (
          'thread-1',
          'turn-1',
          NULL,
          'thread-1',
          'plan-1',
          'message-1',
          'completed',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          1,
          'checkpoint-1',
          'ready',
          '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]'
        )
      `;

      let sequence = 5;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-02-24T00:00:09.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 5);
      assert.equal(snapshot.updatedAt, "2026-02-24T00:00:09.500Z");
      assert.equal(snapshot.snapshotProfile, "operational");
      assert.deepEqual(snapshot.snapshotCoverage, {
        includeArchivedThreads: true,
        wakeItemCount: 1,
        wakeItemLimit: 100,
        wakeItemsTruncated: false,
        warnings: [],
      });
      assert.deepEqual(snapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          kind: "project",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          hooks: [],
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.programs, [
        {
          id: asProgramId("program-cto"),
          title: "Founder task",
          objective: "Convert founder request into Jasper orchestration.",
          status: "active",
          declaredRepos: ["t3code-vxapp", "vortex-scripts"],
          affectedAppTargets: ["web", "api"],
          requiredLocalSuites: [
            {
              repo: "t3code-vxapp",
              suiteId: "lint",
              description: "Run lint before review.",
            },
          ],
          requiredExternalE2ESuites: [
            {
              target: "web",
              suiteId: "founder-e2e",
              description: "Founder-visible E2E.",
            },
          ],
          requireDevelopmentDeploy: true,
          requireExternalE2E: true,
          requireCleanPostFlight: true,
          requirePrPerRepo: true,
          executiveProjectId: asProjectId("project-1"),
          executiveThreadId: asThreadId("thread-1"),
          currentOrchestratorThreadId: asThreadId("thread-1"),
          repoPrs: [
            {
              repo: "t3code-vxapp",
              url: "https://github.com/t3tools/t3code-vxapp/pull/42",
              number: 42,
              state: "OPEN",
              isDraft: false,
              reviewDecision: "APPROVED",
              mergeStateStatus: "CLEAN",
              headRefName: "feature/program-closeout",
              baseRefName: "main",
              updatedAt: "2026-02-24T00:00:01.300Z",
            },
          ],
          localValidation: [
            {
              repo: "t3code-vxapp",
              suiteId: "lint",
              kind: "bun_lint",
              status: "passed",
              summary: "bun lint passed",
              command: "bun lint",
              recordedAt: "2026-02-24T00:00:01.350Z",
            },
          ],
          appValidations: [
            {
              target: "web",
              kind: "development_deploy",
              suiteId: "dev-deploy",
              status: "passed",
              summary: "Development deploy succeeded",
              command: "vx apps web --deploy development",
              url: "https://web.dev.example.test",
              recordedAt: "2026-02-24T00:00:01.360Z",
            },
          ],
          observedRepos: [
            {
              repo: "t3code-vxapp",
              source: "git-status",
              observedAt: "2026-02-24T00:00:01.370Z",
            },
          ],
          postFlight: {
            status: "clean",
            summary: "Closeout checks passed",
            recordedAt: "2026-02-24T00:00:01.380Z",
          },
          createdAt: "2026-02-24T00:00:01.250Z",
          updatedAt: "2026-02-24T00:00:01.500Z",
          completedAt: null,
          cancelReason: null,
          cancelledAt: null,
          supersededByProgramId: null,
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.programNotifications, [
        {
          notificationId: asProgramNotificationId("notif-cto"),
          programId: asProgramId("program-cto"),
          executiveProjectId: asProjectId("project-1"),
          executiveThreadId: asThreadId("thread-1"),
          orchestratorThreadId: asThreadId("thread-1"),
          kind: "decision_required",
          severity: "warning",
          summary: "Choose the deployment lane.",
          evidence: { workerThreadId: "thread-worker-1" },
          state: "pending",
          queuedAt: "2026-02-24T00:00:01.750Z",
          deliveredAt: null,
          consumedAt: null,
          droppedAt: null,
          consumeReason: undefined,
          dropReason: undefined,
          createdAt: "2026-02-24T00:00:01.750Z",
          updatedAt: "2026-02-24T00:00:01.750Z",
        },
      ]);
      assert.deepEqual(snapshot.ctoAttentionItems, [
        {
          attentionId: asCtoAttentionId(
            "program:program-cto|kind:final_review_ready|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto-terminal",
          ),
          attentionKey:
            "program:program-cto|kind:final_review_ready|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto-terminal",
          notificationId: asProgramNotificationId("notif-cto-terminal"),
          programId: asProgramId("program-cto"),
          executiveProjectId: asProjectId("project-1"),
          executiveThreadId: asThreadId("thread-1"),
          sourceThreadId: asThreadId("thread-worker-1"),
          sourceRole: "worker",
          kind: "final_review_ready",
          severity: "info",
          summary: "Review is ready and later resolved.",
          evidence: { workerThreadId: "thread-worker-1" },
          state: "resolved",
          queuedAt: "2026-02-24T00:00:02.250Z",
          acknowledgedAt: null,
          resolvedAt: "2026-02-24T00:00:02.500Z",
          droppedAt: null,
          createdAt: "2026-02-24T00:00:02.250Z",
          updatedAt: "2026-02-24T00:00:02.500Z",
        },
        {
          attentionId: asCtoAttentionId(
            "program:program-cto|kind:decision_required|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto",
          ),
          attentionKey:
            "program:program-cto|kind:decision_required|source-thread:thread-worker-1|source-role:worker|correlation:notif-cto",
          notificationId: asProgramNotificationId("notif-cto"),
          programId: asProgramId("program-cto"),
          executiveProjectId: asProjectId("project-1"),
          executiveThreadId: asThreadId("thread-1"),
          sourceThreadId: asThreadId("thread-worker-1"),
          sourceRole: "worker",
          kind: "decision_required",
          severity: "warning",
          summary: "Choose the deployment lane.",
          evidence: { workerThreadId: "thread-worker-1" },
          state: "required",
          queuedAt: "2026-02-24T00:00:01.750Z",
          acknowledgedAt: null,
          resolvedAt: null,
          droppedAt: null,
          createdAt: "2026-02-24T00:00:01.750Z",
          updatedAt: "2026-02-24T00:00:01.750Z",
        },
      ]);
      assert.deepEqual(snapshot.orchestratorWakeItems, [
        {
          wakeId: "wake:thread-worker-1:turn-1:completed",
          orchestratorThreadId: asThreadId("thread-1"),
          orchestratorProjectId: asProjectId("project-1"),
          workerThreadId: asThreadId("thread-worker-1"),
          workerProjectId: asProjectId("project-worker-1"),
          workerTurnId: asTurnId("turn-1"),
          workflowId: "wf-1",
          workerTitleSnapshot: "Worker One",
          outcome: "completed",
          summary: "Ready for orchestrator review",
          queuedAt: "2026-02-24T00:00:07.500Z",
          state: "delivered",
          deliveryMessageId: asMessageId("message-2"),
          deliveredAt: "2026-02-24T00:00:07.750Z",
          consumedAt: null,
          consumeReason: undefined,
        },
      ]);
      assert.equal(snapshot.threads.length, 2);
      assert.equal(snapshot.threads[0]?.id, ThreadId.makeUnsafe("thread-1"));
      assert.equal(snapshot.threads[1]?.id, ThreadId.makeUnsafe("thread-archived"));
      assert.deepEqual(snapshot.threads[0], {
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread 1",
        labels: [],
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        latestTurn: {
          turnId: asTurnId("turn-1"),
          state: "completed",
          requestedAt: "2026-02-24T00:00:08.000Z",
          startedAt: "2026-02-24T00:00:08.000Z",
          completedAt: "2026-02-24T00:00:08.000Z",
          assistantMessageId: asMessageId("message-1"),
          sourceProposedPlan: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            planId: "plan-1",
          },
        },
        createdAt: "2026-02-24T00:00:02.000Z",
        updatedAt: "2026-02-24T00:00:03.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: asMessageId("message-1"),
            role: "assistant",
            text: "hello from projection",
            turnId: asTurnId("turn-1"),
            streaming: false,
            createdAt: "2026-02-24T00:00:04.000Z",
            updatedAt: "2026-02-24T00:00:05.000Z",
          },
        ],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: asTurnId("turn-1"),
            planMarkdown: "# Ship it",
            implementedAt: "2026-02-24T00:00:05.500Z",
            implementationThreadId: ThreadId.makeUnsafe("thread-2"),
            createdAt: "2026-02-24T00:00:05.000Z",
            updatedAt: "2026-02-24T00:00:05.500Z",
          },
        ],
        activities: [
          {
            id: asEventId("activity-1"),
            tone: "info",
            kind: "runtime.note",
            summary: "provider started",
            payload: { stage: "start" },
            turnId: asTurnId("turn-1"),
            createdAt: "2026-02-24T00:00:06.000Z",
          },
        ],
        checkpoints: [
          {
            turnId: asTurnId("turn-1"),
            checkpointTurnCount: 1,
            checkpointRef: asCheckpointRef("checkpoint-1"),
            status: "ready",
            files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
            assistantMessageId: asMessageId("message-1"),
            completedAt: "2026-02-24T00:00:08.000Z",
          },
        ],
        snapshotCoverage: {
          messageCount: 1,
          messageLimit: 200,
          messagesTruncated: false,
          proposedPlanCount: 1,
          proposedPlanLimit: 50,
          proposedPlansTruncated: false,
          activityCount: 1,
          activityLimit: 100,
          activitiesTruncated: false,
          checkpointCount: 1,
          checkpointLimit: 50,
          checkpointsTruncated: false,
          warnings: [],
        },
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: "2026-02-24T00:00:07.000Z",
        },
        orchestratorProjectId: undefined,
        orchestratorThreadId: undefined,
        parentThreadId: undefined,
        spawnRole: undefined,
        spawnedBy: undefined,
        workflowId: undefined,
        programId: undefined,
        executiveProjectId: undefined,
        executiveThreadId: undefined,
      });
      assert.equal(snapshot.threads[1]?.archivedAt, "2026-02-24T00:00:09.500Z");
      assert.equal(snapshot.threads[1]?.messages.length, 0);

      const commandStateSnapshot = yield* snapshotQuery.getSnapshot({ profile: "command-state" });
      assert.equal(commandStateSnapshot.snapshotProfile, "command-state");
      assert.deepEqual(commandStateSnapshot.snapshotCoverage, {
        includeArchivedThreads: true,
        wakeItemCount: 1,
        wakeItemLimit: 100,
        wakeItemsTruncated: false,
        warnings: [],
      });
      assert.deepEqual(
        commandStateSnapshot.threads.map((thread) => thread.id),
        [asThreadId("thread-1"), asThreadId("thread-archived")],
      );
      const commandThread = commandStateSnapshot.threads.find((thread) => thread.id === "thread-1");
      assert.equal(commandThread?.messages.length, 0);
      assert.deepEqual(
        commandThread?.proposedPlans.map((plan) => plan.id),
        ["plan-1"],
      );
      assert.equal(commandThread?.activities.length, 0);
      assert.equal(commandThread?.checkpoints.length, 0);

      const debugSnapshot = yield* snapshotQuery.getSnapshot({ profile: "debug-export" });
      assert.equal(debugSnapshot.snapshotProfile, "debug-export");
      assert.deepEqual(debugSnapshot.snapshotCoverage, {
        includeArchivedThreads: true,
        wakeItemCount: 1,
        wakeItemLimit: null,
        wakeItemsTruncated: false,
        warnings: [],
      });
      assert.equal(debugSnapshot.threads.length, 2);
      assert.equal(debugSnapshot.threads[1]?.id, ThreadId.makeUnsafe("thread-archived"));
      assert.equal(debugSnapshot.threads[0]?.snapshotCoverage?.messageLimit, null);
      assert.equal(debugSnapshot.updatedAt, "2026-02-24T00:00:09.500Z");

      const activeThreadSnapshot = yield* snapshotQuery.getSnapshot({
        profile: "active-thread",
        threadId: ThreadId.makeUnsafe("thread-1"),
      });
      assert.equal(activeThreadSnapshot.snapshotProfile, "active-thread");
      assert.equal(activeThreadSnapshot.projects.length, 1);
      assert.equal(activeThreadSnapshot.projects[0]?.id, asProjectId("project-1"));
      assert.equal(activeThreadSnapshot.threads.length, 1);
      assert.equal(activeThreadSnapshot.threads[0]?.id, ThreadId.makeUnsafe("thread-1"));
    }),
  );

  it.effect(
    "bounds heavy collections in operational snapshots and preserves full debug exports",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_state`;
        yield* sql`DELETE FROM projection_orchestrator_wakes`;
        yield* sql`DELETE FROM projection_thread_proposed_plans`;
        yield* sql`DELETE FROM projection_turns`;
        yield* sql`DELETE FROM projection_thread_messages`;
        yield* sql`DELETE FROM projection_thread_activities`;
        yield* sql`DELETE FROM projection_thread_sessions`;
        yield* sql`DELETE FROM projection_threads`;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          'turn-205',
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

        for (let index = 1; index <= 205; index += 1) {
          const createdAt = new Date(Date.UTC(2026, 1, 24, 0, 0, index)).toISOString();
          yield* sql`
          INSERT INTO projection_thread_messages (
            message_id,
            thread_id,
            turn_id,
            role,
            text,
            is_streaming,
            created_at,
            updated_at
          )
          VALUES (
            ${`message-${index}`},
            'thread-1',
            ${`turn-${index}`},
            'assistant',
            ${`message ${index}`},
            0,
            ${createdAt},
            ${createdAt}
          )
        `;
        }

        for (let index = 1; index <= 55; index += 1) {
          const createdAt = new Date(Date.UTC(2026, 1, 24, 0, 10, index)).toISOString();
          yield* sql`
          INSERT INTO projection_thread_proposed_plans (
            plan_id,
            thread_id,
            turn_id,
            plan_markdown,
            implemented_at,
            implementation_thread_id,
            created_at,
            updated_at
          )
          VALUES (
            ${`plan-${index}`},
            'thread-1',
            ${`turn-${index}`},
            ${`# Plan ${index}`},
            NULL,
            NULL,
            ${createdAt},
            ${createdAt}
          )
        `;
        }

        for (let index = 1; index <= 105; index += 1) {
          const createdAt = new Date(Date.UTC(2026, 1, 24, 0, 20, index)).toISOString();
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
          VALUES (
            ${`activity-${index}`},
            'thread-1',
            ${`turn-${index}`},
            'info',
            'runtime.note',
            ${`activity ${index}`},
            '{"stage":"test"}',
            ${index},
            ${createdAt}
          )
        `;
        }

        for (let index = 1; index <= 55; index += 1) {
          const completedAt = new Date(Date.UTC(2026, 1, 24, 0, 30, index)).toISOString();
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
            'thread-1',
            ${`turn-${index}`},
            NULL,
            NULL,
            NULL,
            ${`message-${index}`},
            'completed',
            ${completedAt},
            ${completedAt},
            ${completedAt},
            ${index},
            ${`checkpoint-${index}`},
            'ready',
            '[]'
          )
        `;
        }

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
          'thread-1',
          'ready',
          'codex',
          NULL,
          NULL,
          'full-access',
          'turn-205',
          NULL,
          '2026-02-24T00:59:00.000Z'
        )
      `;

        for (let index = 1; index <= 105; index += 1) {
          const queuedAt = new Date(Date.UTC(2026, 1, 24, 0, 40, index)).toISOString();
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
            ${`wake-${index}`},
            'thread-1',
            'project-1',
            ${`worker-thread-${index}`},
            ${`worker-project-${index}`},
            ${`turn-${index}`},
            NULL,
            ${`Worker ${index}`},
            'completed',
            ${`Wake ${index}`},
            ${queuedAt},
            'delivered',
            NULL,
            NULL,
            NULL,
            NULL
          )
        `;
        }

        let sequence = 10;
        for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
          yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-02-24T01:00:00.000Z'
          )
        `;
          sequence += 1;
        }

        const snapshot = yield* snapshotQuery.getSnapshot();
        const thread = snapshot.threads[0];
        assert.isDefined(thread);
        assert.equal(snapshot.snapshotProfile, "operational");
        assert.deepEqual(snapshot.snapshotCoverage, {
          includeArchivedThreads: true,
          wakeItemCount: 105,
          wakeItemLimit: 100,
          wakeItemsTruncated: true,
          warnings: [],
        });
        assert.equal(snapshot.orchestratorWakeItems.length, 100);
        assert.equal(snapshot.orchestratorWakeItems[0]?.wakeId, "wake-6");
        assert.equal(snapshot.orchestratorWakeItems[99]?.wakeId, "wake-105");
        assert.equal(thread?.messages.length, 200);
        assert.equal(thread?.messages[0]?.id, asMessageId("message-6"));
        assert.equal(thread?.messages[199]?.id, asMessageId("message-205"));
        assert.equal(thread?.proposedPlans.length, 50);
        assert.equal(thread?.proposedPlans[0]?.id, "plan-6");
        assert.equal(thread?.proposedPlans[49]?.id, "plan-55");
        assert.equal(thread?.activities.length, 100);
        assert.equal(thread?.activities[0]?.id, asEventId("activity-6"));
        assert.equal(thread?.activities[99]?.id, asEventId("activity-105"));
        assert.equal(thread?.checkpoints.length, 50);
        assert.equal(thread?.checkpoints[0]?.checkpointRef, asCheckpointRef("checkpoint-6"));
        assert.equal(thread?.checkpoints[49]?.checkpointRef, asCheckpointRef("checkpoint-55"));
        assert.deepEqual(thread?.snapshotCoverage, {
          messageCount: 205,
          messageLimit: 200,
          messagesTruncated: true,
          proposedPlanCount: 55,
          proposedPlanLimit: 50,
          proposedPlansTruncated: true,
          activityCount: 105,
          activityLimit: 100,
          activitiesTruncated: true,
          checkpointCount: 55,
          checkpointLimit: 50,
          checkpointsTruncated: true,
          warnings: [],
        });

        const debugSnapshot = yield* snapshotQuery.getSnapshot({ profile: "debug-export" });
        const debugThread = debugSnapshot.threads[0];
        assert.isDefined(debugThread);
        assert.deepEqual(debugSnapshot.snapshotCoverage, {
          includeArchivedThreads: true,
          wakeItemCount: 105,
          wakeItemLimit: null,
          wakeItemsTruncated: false,
          warnings: [],
        });
        assert.equal(debugSnapshot.orchestratorWakeItems.length, 105);
        assert.equal(debugThread?.messages.length, 205);
        assert.equal(debugThread?.proposedPlans.length, 55);
        assert.equal(debugThread?.activities.length, 105);
        assert.equal(debugThread?.checkpoints.length, 55);
        assert.deepEqual(debugThread?.snapshotCoverage, {
          messageCount: 205,
          messageLimit: null,
          messagesTruncated: false,
          proposedPlanCount: 55,
          proposedPlanLimit: null,
          proposedPlansTruncated: false,
          activityCount: 105,
          activityLimit: null,
          activitiesTruncated: false,
          checkpointCount: 55,
          checkpointLimit: null,
          checkpointsTruncated: false,
          warnings: [],
        });
      }),
  );
});
