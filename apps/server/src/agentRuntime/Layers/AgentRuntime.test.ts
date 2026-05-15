import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { beforeEach } from "vitest";

import { AgentsVxappExternalRoleAuthority } from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import { AgentsVxappExternalRoleAuthorityError } from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import { OrchestrationProjectionOperationalQueryLive } from "../../orchestration/Layers/ProjectionOperationalQuery.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkerRuntimeLive } from "../../workerRuntime/Layers/WorkerRuntime.ts";
import { AgentRuntime } from "../Services/AgentRuntime.ts";
import { AgentRuntimeLive } from "./AgentRuntime.ts";

const projectionLayer = OrchestrationProjectionOperationalQueryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const defaultRuntimePaths = {
  runtimeRoot: "/tmp/unused-runtime-root",
  roleSessionsRoot: "/tmp/unused-runtime-root/role-sessions",
  roleStateRoot: "/tmp/unused-runtime-root/role-state",
  workspaceRuntimeMetadataDir: ".agents/runtime",
  env: {
    runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
    stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
  },
  roles: {
    cto: {
      role: "cto" as const,
      generatedWorkspaceRoot: "/tmp/unused-runtime-root/role-sessions/cto",
      stateRoot: "/tmp/unused-runtime-root/role-state/cto",
      sessionsRoot: "/tmp/unused-runtime-root/role-state/cto/sessions",
      reservationsRoot: "/tmp/unused-runtime-root/role-state/cto/reservations",
    },
    jasper: {
      role: "jasper" as const,
      generatedWorkspaceRoot: "/tmp/unused-runtime-root/role-sessions/jasper",
      stateRoot: "/tmp/unused-runtime-root/role-state/jasper",
      sessionsRoot: "/tmp/unused-runtime-root/role-state/jasper/sessions",
      reservationsRoot: "/tmp/unused-runtime-root/role-state/jasper/reservations",
    },
  },
};

let runtimePathsOverride = defaultRuntimePaths;
let runtimePathsFailure: AgentsVxappExternalRoleAuthorityError | null = null;

beforeEach(() => {
  runtimePathsOverride = defaultRuntimePaths;
  runtimePathsFailure = null;
});

const agentRuntimeLayer = it.layer(
  AgentRuntimeLive.pipe(
    Layer.provideMerge(WorkerRuntimeLive.pipe(Layer.provideMerge(projectionLayer))),
    Layer.provideMerge(projectionLayer),
    Layer.provide(
      Layer.succeed(AgentsVxappExternalRoleAuthority, {
        getRuntimePaths: () =>
          runtimePathsFailure === null
            ? Effect.succeed(runtimePathsOverride)
            : Effect.fail(runtimePathsFailure),
        getSnapshot: () => Effect.succeed({ projects: [], threadSummaries: [] }),
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

agentRuntimeLayer("AgentRuntime", (it) => {
  function insertProjectionThread(input: {
    projectId: string;
    projectWorkspaceRoot: string;
    spawnRole: "worker" | "orchestrator";
    threadId: string;
    threadWorktreePath: string | null;
  }) {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
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
          ${input.projectId},
          'Projection Project',
          ${input.projectWorkspaceRoot},
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '[]',
          '2026-05-10T00:00:00.000Z',
          '2026-05-10T00:00:01.000Z',
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
          spawn_role,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          ${input.threadId},
          ${input.projectId},
          'Projection Thread',
          '[]',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          ${input.threadWorktreePath},
          NULL,
          ${input.spawnRole},
          '2026-05-10T00:00:02.000Z',
          '2026-05-10T00:00:03.000Z',
          NULL,
          NULL
        )
      `;
    });
  }

  it.effect(
    "preserves worker runtime details and workspace provenance on the unified snapshot",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const agentRuntime = yield* AgentRuntime;
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-agent-runtime-"));
        const runtimeDir = path.join(workspaceRoot, ".agents", "runtime");
        fs.mkdirSync(runtimeDir, { recursive: true });

        fs.writeFileSync(
          path.join(runtimeDir, "dispatch-contract.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            repo: "worker-runtime-repo",
            taskClass: "source-editing-implementation",
            contextMode: "isolated",
            closeoutAuthority: "code_tests",
            validationProfile: "strict",
            selectedPacks: ["pack.one"],
            allowedCapabilities: ["edit"],
            forbiddenCapabilities: ["deploy"],
            conflicts: ["repo-lock"],
            warnings: ["needs follow-up"],
          }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(runtimeDir, "installed-packs.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            repo: "worker-runtime-repo",
            taskClass: "source-editing-implementation",
            contextMode: "isolated",
            closeoutAuthority: "code_tests",
            workspace: workspaceRoot,
            runtimeDir,
            skillsDir: path.join(workspaceRoot, ".agents", "skills"),
            agentsSkillsDir: path.join(workspaceRoot, ".agents", "agents-skills"),
            packs: [
              {
                id: "pack.one",
                slug: "pack-one",
                link: "file:///packs/one",
                manifest: {
                  name: "Pack One",
                  repo: "agents-vxapp",
                  scope: "repo",
                },
              },
            ],
          }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(runtimeDir, "instruction-stack-audit.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            repo: "worker-runtime-repo",
            status: "warning",
            findings: [
              {
                code: "PACK_CONFLICT",
                detail: "Conflicting pack ordering detected.",
                kind: "packs",
                severity: "warning",
              },
            ],
            packAudit: {
              status: "warning",
              issues: [{ id: "issue-1" }],
            },
          }),
          "utf8",
        );

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
          'project-agent-runtime',
          'Agent Runtime Project',
          ${workspaceRoot},
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '[]',
          '2026-05-10T00:00:00.000Z',
          '2026-05-10T00:00:01.000Z',
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
          spawn_role,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-agent-runtime',
          'project-agent-runtime',
          'Worker Runtime Thread',
          '[]',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          'worker',
          '2026-05-10T00:00:02.000Z',
          '2026-05-10T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

        const snapshot = yield* agentRuntime.getSnapshot({
          agentKind: "worker",
          threadId: ThreadId.makeUnsafe("thread-agent-runtime"),
        });

        assert.equal(snapshot.runtimeKind, "worker-contract");
        assert.equal(snapshot.workspaceRoot, workspaceRoot);
        assert.deepStrictEqual(snapshot.workspaceResolution, {
          detail: "Falling back to the worker project's workspace root.",
          kind: "project-workspace-root",
        });
        assert.equal(snapshot.summary.repo, "worker-runtime-repo");
        assert.equal(snapshot.workerDetails?.validationProfile, "strict");
        assert.deepStrictEqual(snapshot.workerDetails?.allowedCapabilities, ["edit"]);
        assert.deepStrictEqual(snapshot.workerDetails?.forbiddenCapabilities, ["deploy"]);
        assert.deepStrictEqual(snapshot.workerDetails?.warnings, ["needs follow-up"]);
        assert.equal(snapshot.workerDetails?.auditStatus, "warning");
        assert.equal(snapshot.workerDetails?.packAuditIssueCount, 1);
        assert.equal(snapshot.workerDetails?.packs[0]?.id, "pack.one");
        assert.equal(snapshot.roleDetails, null);
      }),
  );

  it.effect("fails closed when owner runtime-paths disagree with the thread worktree", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const agentRuntime = yield* AgentRuntime;
      const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-role-runtime-"));
      const workspaceRoot = path.join(
        runtimeRoot,
        "role-sessions",
        "jasper",
        "session-123",
        "workspace",
      );
      const runtimeDir = path.join(workspaceRoot, ".agents", "runtime");
      const sessionsRoot = path.join(runtimeRoot, "role-state", "jasper", "sessions");
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.mkdirSync(sessionsRoot, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsRoot, "session-123.json"),
        JSON.stringify({ workspace_path: workspaceRoot }),
        "utf8",
      );

      runtimePathsOverride = {
        runtimeRoot,
        roleSessionsRoot: path.join(runtimeRoot, "role-sessions"),
        roleStateRoot: path.join(runtimeRoot, "role-state"),
        workspaceRuntimeMetadataDir: ".agents/runtime",
        env: {
          runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
          stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
        },
        roles: {
          cto: {
            role: "cto" as const,
            generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "cto"),
            stateRoot: path.join(runtimeRoot, "role-state", "cto"),
            sessionsRoot: path.join(runtimeRoot, "role-state", "cto", "sessions"),
            reservationsRoot: path.join(runtimeRoot, "role-state", "cto", "reservations"),
          },
          jasper: {
            role: "jasper" as const,
            generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "jasper"),
            stateRoot: path.join(runtimeRoot, "role-state", "jasper"),
            sessionsRoot,
            reservationsRoot: path.join(runtimeRoot, "role-state", "jasper", "reservations"),
          },
        },
      };

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json, hooks_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-orch', 'Orchestrator Project', '/tmp/orch', '{"provider":"codex","model":"gpt-5-codex"}',
          '[]', '[]', '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, labels_json, model_selection_json, runtime_mode,
          interaction_mode, branch, worktree_path, latest_turn_id, spawn_role,
          created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'thread-orch', 'project-orch', 'Orchestrator Thread', '[]', '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access', 'default', NULL, '/tmp/repo-local/Jasper', NULL, 'orchestrator',
          '2026-05-10T00:00:02.000Z', '2026-05-10T00:00:03.000Z', NULL, NULL
        )
      `;

      const snapshot = yield* agentRuntime.getSnapshot({
        agentKind: "orchestrator",
        threadId: ThreadId.makeUnsafe("thread-orch"),
      });

      assert.equal(snapshot.workspaceRoot, null);
      assert.equal(snapshot.runtimeDir, null);
      assert.deepStrictEqual(snapshot.workspaceResolution, {
        kind: "input-worktree-fallback",
        detail:
          "Owner runtime-paths authority unavailable: thread worktree disagrees with owner runtime-paths workspace (/tmp/repo-local/Jasper != " +
          workspaceRoot +
          ").",
      });
    }),
  );

  it.effect("returns an unavailable role snapshot when owner runtime-paths lookup fails", () =>
    Effect.gen(function* () {
      const agentRuntime = yield* AgentRuntime;
      runtimePathsFailure = new AgentsVxappExternalRoleAuthorityError({
        operation: "AgentsVxappExternalRoleAuthority.getRuntimePaths",
        detail: "mocked owner runtime-paths failure",
      });

      yield* insertProjectionThread({
        projectId: "project-runtime-failure",
        projectWorkspaceRoot: "/tmp/project-runtime-failure",
        spawnRole: "orchestrator",
        threadId: "thread-runtime-failure",
        threadWorktreePath: null,
      });

      const snapshot = yield* agentRuntime.getSnapshot({
        agentKind: "orchestrator",
        threadId: ThreadId.makeUnsafe("thread-runtime-failure"),
      });

      assert.equal(snapshot.runtimeKind, "role-runtime");
      assert.equal(snapshot.workspaceRoot, null);
      assert.equal(snapshot.runtimeDir, null);
      assert.deepStrictEqual(snapshot.workspaceResolution, {
        kind: "input-worktree-fallback",
        detail: "Owner runtime-paths authority unavailable: mocked owner runtime-paths failure",
      });
    }),
  );

  it.effect("reads jasper role sessions from the owner-provided sessionsRoot", () =>
    Effect.gen(function* () {
      const agentRuntime = yield* AgentRuntime;
      const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-role-runtime-owner-"));
      const ownerWorkspaceRoot = path.join(
        runtimeRoot,
        "role-sessions",
        "jasper",
        "session-777",
        "workspace",
      );
      const ownerRuntimeDir = path.join(ownerWorkspaceRoot, ".agents", "runtime");
      const ownerSessionsRoot = path.join(runtimeRoot, "role-state", "jasper", "sessions");
      fs.mkdirSync(ownerRuntimeDir, { recursive: true });
      fs.mkdirSync(ownerSessionsRoot, { recursive: true });
      fs.writeFileSync(
        path.join(ownerSessionsRoot, "session-777.json"),
        JSON.stringify({ workspace_path: ownerWorkspaceRoot }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(ownerRuntimeDir, "selected-profile.json"),
        JSON.stringify({ selected_profile: "jasper-owner-profile" }),
        "utf8",
      );

      runtimePathsOverride = {
        runtimeRoot,
        roleSessionsRoot: path.join(runtimeRoot, "role-sessions"),
        roleStateRoot: path.join(runtimeRoot, "role-state"),
        workspaceRuntimeMetadataDir: ".agents/runtime",
        env: {
          runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
          stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
        },
        roles: {
          cto: {
            role: "cto" as const,
            generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "cto"),
            stateRoot: path.join(runtimeRoot, "role-state", "cto"),
            sessionsRoot: path.join(runtimeRoot, "role-state", "cto", "sessions"),
            reservationsRoot: path.join(runtimeRoot, "role-state", "cto", "reservations"),
          },
          jasper: {
            role: "jasper" as const,
            generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "jasper"),
            stateRoot: path.join(runtimeRoot, "role-state", "jasper"),
            sessionsRoot: ownerSessionsRoot,
            reservationsRoot: path.join(runtimeRoot, "role-state", "jasper", "reservations"),
          },
        },
      };

      yield* insertProjectionThread({
        projectId: "project-owner-session",
        projectWorkspaceRoot: "/tmp/project-owner-session",
        spawnRole: "orchestrator",
        threadId: "thread-owner-session",
        threadWorktreePath: ownerWorkspaceRoot,
      });

      const snapshot = yield* agentRuntime.getSnapshot({
        agentKind: "orchestrator",
        threadId: ThreadId.makeUnsafe("thread-owner-session"),
      });

      assert.equal(snapshot.workspaceRoot, ownerWorkspaceRoot);
      assert.equal(snapshot.runtimeDir, ownerRuntimeDir);
      assert.deepStrictEqual(snapshot.workspaceResolution, {
        kind: "latest-role-session",
        detail: "Using the latest owner-managed jasper role-session workspace.",
      });
      assert.equal(snapshot.summary.profile, "jasper-owner-profile");
    }),
  );

  it.effect("ignores repo-local role runtime directories when owner sessionsRoot is missing", () =>
    Effect.gen(function* () {
      const agentRuntime = yield* AgentRuntime;
      const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-role-runtime-missing-"));
      const repoLocalWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-repo-local-"));
      const repoLocalRuntimeDir = path.join(repoLocalWorkspace, ".agents", "runtime");
      const repoLocalSessionsRoot = path.join(
        repoLocalWorkspace,
        ".agents",
        "runtime",
        "role-state",
        "jasper",
        "sessions",
      );
      fs.mkdirSync(repoLocalRuntimeDir, { recursive: true });
      fs.mkdirSync(repoLocalSessionsRoot, { recursive: true });
      fs.writeFileSync(
        path.join(repoLocalSessionsRoot, "session-local.json"),
        JSON.stringify({ workspace_path: repoLocalWorkspace }),
        "utf8",
      );

      runtimePathsOverride = {
        runtimeRoot,
        roleSessionsRoot: path.join(runtimeRoot, "role-sessions"),
        roleStateRoot: path.join(runtimeRoot, "role-state"),
        workspaceRuntimeMetadataDir: ".agents/runtime",
        env: {
          runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
          stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
        },
        roles: {
          cto: {
            role: "cto" as const,
            generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "cto"),
            stateRoot: path.join(runtimeRoot, "role-state", "cto"),
            sessionsRoot: path.join(runtimeRoot, "role-state", "cto", "sessions"),
            reservationsRoot: path.join(runtimeRoot, "role-state", "cto", "reservations"),
          },
          jasper: {
            role: "jasper" as const,
            generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "jasper"),
            stateRoot: path.join(runtimeRoot, "role-state", "jasper"),
            sessionsRoot: path.join(runtimeRoot, "role-state", "jasper", "sessions"),
            reservationsRoot: path.join(runtimeRoot, "role-state", "jasper", "reservations"),
          },
        },
      };

      yield* insertProjectionThread({
        projectId: "project-repo-local-ignore",
        projectWorkspaceRoot: repoLocalWorkspace,
        spawnRole: "orchestrator",
        threadId: "thread-repo-local-ignore",
        threadWorktreePath: repoLocalWorkspace,
      });

      const snapshot = yield* agentRuntime.getSnapshot({
        agentKind: "orchestrator",
        threadId: ThreadId.makeUnsafe("thread-repo-local-ignore"),
      });

      assert.equal(snapshot.workspaceRoot, null);
      assert.equal(snapshot.runtimeDir, null);
      assert.deepStrictEqual(snapshot.workspaceResolution, {
        kind: "input-worktree-fallback",
        detail: "Owner runtime-paths authority unavailable: missing owner role session record.",
      });
    }),
  );

  it.effect(
    "does not fall back to canonical Jasper or CTOv2 folders when owner sessions are absent",
    () =>
      Effect.gen(function* () {
        const agentRuntime = yield* AgentRuntime;
        const runtimeRoot = fs.mkdtempSync(
          path.join(os.tmpdir(), "t3code-role-runtime-canonical-"),
        );
        const canonicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-canonical-like-"));
        const jasperWorkspace = path.join(canonicalRoot, "Jasper");
        const ctoWorkspace = path.join(canonicalRoot, "CTOv2");
        fs.mkdirSync(path.join(jasperWorkspace, ".agents", "runtime"), { recursive: true });
        fs.mkdirSync(path.join(ctoWorkspace, ".agents", "runtime"), { recursive: true });

        runtimePathsOverride = {
          runtimeRoot,
          roleSessionsRoot: path.join(runtimeRoot, "role-sessions"),
          roleStateRoot: path.join(runtimeRoot, "role-state"),
          workspaceRuntimeMetadataDir: ".agents/runtime",
          env: {
            runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
            stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
          },
          roles: {
            cto: {
              role: "cto" as const,
              generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "cto"),
              stateRoot: path.join(runtimeRoot, "role-state", "cto"),
              sessionsRoot: path.join(runtimeRoot, "role-state", "cto", "sessions"),
              reservationsRoot: path.join(runtimeRoot, "role-state", "cto", "reservations"),
            },
            jasper: {
              role: "jasper" as const,
              generatedWorkspaceRoot: path.join(runtimeRoot, "role-sessions", "jasper"),
              stateRoot: path.join(runtimeRoot, "role-state", "jasper"),
              sessionsRoot: path.join(runtimeRoot, "role-state", "jasper", "sessions"),
              reservationsRoot: path.join(runtimeRoot, "role-state", "jasper", "reservations"),
            },
          },
        };

        yield* insertProjectionThread({
          projectId: "project-no-canonical-fallback",
          projectWorkspaceRoot: jasperWorkspace,
          spawnRole: "orchestrator",
          threadId: "thread-no-canonical-fallback",
          threadWorktreePath: jasperWorkspace,
        });

        const snapshot = yield* agentRuntime.getSnapshot({
          agentKind: "orchestrator",
          threadId: ThreadId.makeUnsafe("thread-no-canonical-fallback"),
        });

        assert.equal(snapshot.workspaceRoot, null);
        assert.equal(snapshot.runtimeDir, null);
        assert.deepStrictEqual(snapshot.workspaceResolution, {
          kind: "input-worktree-fallback",
          detail: "Owner runtime-paths authority unavailable: missing owner role session record.",
        });
      }),
  );
});
