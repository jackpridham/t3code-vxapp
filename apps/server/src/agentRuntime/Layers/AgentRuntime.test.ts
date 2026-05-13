import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationProjectionOperationalQueryLive } from "../../orchestration/Layers/ProjectionOperationalQuery.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkerRuntimeLive } from "../../workerRuntime/Layers/WorkerRuntime.ts";
import { AgentRuntime } from "../Services/AgentRuntime.ts";
import { AgentRuntimeLive } from "./AgentRuntime.ts";

const projectionLayer = OrchestrationProjectionOperationalQueryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const agentRuntimeLayer = it.layer(
  AgentRuntimeLive.pipe(
    Layer.provideMerge(WorkerRuntimeLive.pipe(Layer.provideMerge(projectionLayer))),
    Layer.provideMerge(projectionLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

agentRuntimeLayer("AgentRuntime", (it) => {
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
});
