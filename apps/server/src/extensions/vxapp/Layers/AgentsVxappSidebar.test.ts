import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProgramId, ProgramNotificationId, ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as fs from "node:fs";
import { vi } from "vitest";

import { AgentsVxappControlPlane } from "../Services/AgentsVxappControlPlane.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { AgentsVxappSidebar } from "../Services/AgentsVxappSidebar.ts";
import { AgentsVxappSidebarLive } from "./AgentsVxappSidebar.ts";

const ownerDbPath = vi.hoisted(() => "/tmp/t3-vxapp-sidebar.sqlite");
fs.writeFileSync(ownerDbPath, "");

const ownerThreadLink = {
  thread_id: "thread-local",
  project_id: "project-owner",
  workspace_root: "/tmp/workspace-local",
  worktree_path: "/tmp/worktree-local",
  title: "Local thread",
  spawn_role: "worker",
  spawned_by: "founder",
  parent_thread_id: null,
  workflow_id: null,
  program_id: null,
  executive_project_id: null,
  executive_thread_id: null,
  orchestrator_thread_id: null,
  labels_json: "[]",
  session_json: null,
  latest_turn_json: null,
  metadata_json: null,
  created_at: "2026-05-12T00:00:00.000Z",
  updated_at: "2026-05-12T00:00:01.000Z",
  archived_at: null,
  deleted_at: null,
};

const ownerWake = {
  wake_id: "wake-local",
  orchestrator_thread_id: "thread-local",
  program_id: "program-owner",
  state: "open",
  reason: "test",
  payload_json: "{}",
  created_at: "2026-05-12T00:00:00.000Z",
  updated_at: "2026-05-12T00:00:01.000Z",
  settled_at: null,
};

const ownerBindingAuthority = {
  authorityStore: "vx_agents_sqlite",
  authoritySource: "binding",
  legacyFallbackUsed: false,
  diagnostics: null,
  jasper: {
    currentThread: {
      id: ThreadId.makeUnsafe("binding-authoritative-thread"),
      programId: ProgramId.makeUnsafe("program-owner"),
      projectId: ProjectId.makeUnsafe("project-owner"),
    },
    project: {
      currentSessionRootThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
    },
  },
} as const;

const ownerNotificationSummary = {
  authorityStore: "vx_agents_sqlite",
  authoritySource: "local_program_projection",
  legacyFallbackUsed: false,
  notifications: [
    {
      notificationId: ProgramNotificationId.makeUnsafe("notif-owner"),
      programId: ProgramId.makeUnsafe("program-owner"),
      executiveProjectId: ProjectId.makeUnsafe("project-owner"),
      executiveThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
      orchestratorThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
      kind: "status_update" as const,
      severity: "info" as const,
      summary: "Owner notifications win",
      evidence: {},
      state: "pending" as const,
      queuedAt: "2026-05-12T00:00:02.000Z",
      deliveredAt: null,
      consumedAt: null,
      droppedAt: null,
      consumeReason: undefined,
      dropReason: undefined,
      createdAt: "2026-05-12T00:00:02.000Z",
      updatedAt: "2026-05-12T00:00:03.000Z",
    },
  ],
  attention: [],
} as const;

const ownerAttentionSummary = {
  authorityStore: "vx_agents_sqlite",
  authoritySource: "local_attention_projection",
  legacyFallbackUsed: false,
  attention: [
    {
      attentionId: "att-owner",
      attentionKey: "att-owner",
      notificationId: ProgramNotificationId.makeUnsafe("notif-owner"),
      programId: ProgramId.makeUnsafe("program-owner"),
      executiveProjectId: ProjectId.makeUnsafe("project-owner"),
      executiveThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
      sourceThreadId: ThreadId.makeUnsafe("thread-local"),
      sourceRole: "worker",
      kind: "blocked" as const,
      severity: "warning" as const,
      summary: "Owner attention wins",
      evidence: {},
      state: "required" as const,
      queuedAt: "2026-05-12T00:00:02.000Z",
      acknowledgedAt: null,
      resolvedAt: null,
      droppedAt: null,
      createdAt: "2026-05-12T00:00:02.000Z",
      updatedAt: "2026-05-12T00:00:03.000Z",
    },
  ],
  resolvedAttention: [],
  passiveNotifications: [],
} as const;

const ownerWatchSummary = {
  authorityStore: "vx_agents_sqlite",
  authoritySource: "local_owner_truth",
  legacyFallbackUsed: false,
  enabledPrograms: ["program-owner"],
  state: {
    enabled: true,
    classification: "nothing_to_do",
    reason: "select_next_ready_work",
    recommendedAction: "select_next_ready_work",
    signature: "signature-owner",
    suppression: null,
    metadata: {
      localAuthoritySource: "local_owner_truth",
    },
    last_evaluated_at: "2026-05-12T00:00:03.000Z",
    updated_at: "2026-05-12T00:00:03.000Z",
  },
  classification: "nothing_to_do",
  recommendedAction: "select_next_ready_work",
  program: {
    id: "program-owner",
    title: "Owner program",
  },
  currentOrchestratorThread: {
    id: "binding-authoritative-thread",
  },
  wakeDecision: {
    classification: "nothing_to_do",
    recommendedAction: "select_next_ready_work",
    reason: "select_next_ready_work",
    wouldWake: false,
  },
} as const;

const vxappControlPlaneMock = {
  getBindingAuthorityExport: () => Effect.succeed(ownerBindingAuthority),
  getProgramAuthorityExport: () =>
    Effect.die("unexpected getProgramAuthorityExport in AgentsVxappSidebar test"),
  getAttentionSummaryExport: () => Effect.succeed(ownerAttentionSummary),
  getNotificationSummaryExport: () => Effect.succeed(ownerNotificationSummary),
  getWatchSummaryExport: () => Effect.succeed(ownerWatchSummary),
  getProjectionAuthoritySnapshot: () =>
    Effect.die("unexpected getProjectionAuthoritySnapshot in AgentsVxappSidebar test"),
  getSnapshot: () => Effect.die("unexpected getSnapshot in AgentsVxappSidebar test"),
  createProgram: () => Effect.die("unexpected createProgram in AgentsVxappSidebar test"),
  updateProgram: () => Effect.die("unexpected updateProgram in AgentsVxappSidebar test"),
  deleteProgram: () => Effect.die("unexpected deleteProgram in AgentsVxappSidebar test"),
  setProgramLifecycle: () =>
    Effect.die("unexpected setProgramLifecycle in AgentsVxappSidebar test"),
  createTodo: () => Effect.die("unexpected createTodo in AgentsVxappSidebar test"),
  updateTodo: () => Effect.die("unexpected updateTodo in AgentsVxappSidebar test"),
  deleteTodo: () => Effect.die("unexpected deleteTodo in AgentsVxappSidebar test"),
};

vi.mock("../agentsVxappSqlite.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../agentsVxappSqlite.ts")>("../agentsVxappSqlite.ts");
  return {
    ...actual,
    AGENTS_VXAPP_DB_PATH: ownerDbPath,
    withAgentsVxappSqliteReadonly: (handler: (queryAll: (sql: string) => unknown[]) => unknown) =>
      handler((sql) => {
        if (sql.includes("t3_thread_links")) {
          return [ownerThreadLink];
        }
        if (sql.includes("t3_wake_items")) {
          return [ownerWake];
        }
        return [];
      }),
  };
});

const projectionSidebarLayer = it.layer(
  AgentsVxappSidebarLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

projectionSidebarLayer("AgentsVxappSidebar", (it) => {
  it.effect("uses owner exports for watch, notifications, and attention", () =>
    Effect.gen(function* () {
      const sidebar = yield* AgentsVxappSidebar;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;

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
          'project-owner',
          'Owner project',
          '/home/gizmo/agents-vxapp/Owner',
          '{"provider":"codex","model":"gpt-5.4"}',
          '[]',
          '[]',
          '2026-05-12T00:00:00.000Z',
          '2026-05-12T00:00:01.000Z',
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
          'thread-local',
          'project-owner',
          'Owner thread',
          '[]',
          '{"provider":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          NULL,
          '/tmp/worktree-local',
          NULL,
          '2026-05-12T00:00:00.000Z',
          '2026-05-12T00:00:01.000Z',
          NULL,
          NULL
        )
      `;

      const graph = yield* sidebar.getGraph({});

      assert.equal(graph.source, "sqlite");
      assert.deepEqual(
        graph.threadLinks.map((threadLink) => threadLink.threadId),
        ["thread-local"],
      );
      assert.deepEqual(
        graph.openWakes.map((wake) => wake.wakeId),
        ["wake-local"],
      );
      assert.deepEqual(graph.watchProjections, [
        {
          programId: ProgramId.makeUnsafe("program-owner"),
          enabled: true,
          classification: "nothing_to_do",
          reason: "select_next_ready_work",
          signature: "signature-owner",
          suppression: null,
          metadata: { localAuthoritySource: "local_owner_truth" },
          lastEvaluatedAt: "2026-05-12T00:00:03.000Z",
          updatedAt: "2026-05-12T00:00:03.000Z",
        },
      ]);
      assert.deepEqual(graph.notifications, [
        {
          notificationId: ProgramNotificationId.makeUnsafe("notif-owner"),
          programId: ProgramId.makeUnsafe("program-owner"),
          executiveProjectId: ProjectId.makeUnsafe("project-owner"),
          executiveThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
          orchestratorThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
          kind: "status_update",
          severity: "info",
          summary: "Owner notifications win",
          evidence: {},
          state: "pending",
          queuedAt: "2026-05-12T00:00:02.000Z",
          deliveredAt: null,
          consumedAt: null,
          droppedAt: null,
          consumeReason: null,
          dropReason: null,
          createdAt: "2026-05-12T00:00:02.000Z",
          updatedAt: "2026-05-12T00:00:03.000Z",
        },
      ]);
      assert.deepEqual(graph.attentionItems, [
        {
          attentionId: "att-owner",
          attentionKey: "att-owner",
          notificationId: ProgramNotificationId.makeUnsafe("notif-owner"),
          programId: ProgramId.makeUnsafe("program-owner"),
          executiveProjectId: ProjectId.makeUnsafe("project-owner"),
          executiveThreadId: ThreadId.makeUnsafe("binding-authoritative-thread"),
          sourceThreadId: ThreadId.makeUnsafe("thread-local"),
          sourceRole: "worker",
          kind: "blocked",
          severity: "warning",
          summary: "Owner attention wins",
          evidence: {},
          state: "required",
          queuedAt: "2026-05-12T00:00:02.000Z",
          acknowledgedAt: null,
          resolvedAt: null,
          droppedAt: null,
          createdAt: "2026-05-12T00:00:02.000Z",
          updatedAt: "2026-05-12T00:00:03.000Z",
        },
      ]);
      assert.equal(graph.mirrorDiagnostics.staleMirror, false);
    }).pipe(
      Effect.provideService(AgentsVxappControlPlane, vxappControlPlaneMock),
      Effect.provideService(AgentsVxappExternalRoleAuthority, {
        getSnapshot: () => Effect.succeed({ projects: [], threadSummaries: [] }),
      }),
    ),
  );
});
