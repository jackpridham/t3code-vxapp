import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationProjectionOperationalQueryLive } from "../../orchestration/Layers/ProjectionOperationalQuery.ts";
import { WorkerRuntime } from "../Services/WorkerRuntime.ts";
import { WorkerRuntimeLive } from "./WorkerRuntime.ts";

const workerRuntimeLayer = it.layer(
  WorkerRuntimeLive.pipe(
    Layer.provideMerge(
      OrchestrationProjectionOperationalQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

workerRuntimeLayer("WorkerRuntime", (it) => {
  it.effect(
    "falls back to the worker project's workspace root when thread worktreePath is null",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const workerRuntime = yield* WorkerRuntime;
        const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-worker-project-root-"));
        const runtimeDir = path.join(worktreePath, ".agents", "runtime");
        fs.mkdirSync(runtimeDir, { recursive: true });
        fs.writeFileSync(
          path.join(runtimeDir, "dispatch-contract.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            repo: "project-root-repo",
            taskClass: "source-editing-implementation",
            contextMode: "isolated",
            closeoutAuthority: "code_tests",
            validationProfile: null,
            selectedPacks: [],
            allowedCapabilities: [],
            forbiddenCapabilities: [],
            conflicts: [],
            warnings: [],
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
          'project-worker-runtime-root',
          'Worker Runtime Project Root',
          ${worktreePath},
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
          'thread-worker-runtime-root',
          'project-worker-runtime-root',
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

        const snapshot = yield* workerRuntime.getSnapshot({
          threadId: ThreadId.makeUnsafe("thread-worker-runtime-root"),
        });

        assert.equal(snapshot.worktreePath, worktreePath);
        assert.equal(snapshot.summary.repo, "project-root-repo");
        assert.equal(snapshot.sourceFiles.dispatchContract.status, "loaded");
      }),
  );

  it.effect("prefers the dispatch contract repo over the context plan repo", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const workerRuntime = yield* WorkerRuntime;
      const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-worker-runtime-"));
      const runtimeDir = path.join(worktreePath, ".agents", "runtime");
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(
        path.join(runtimeDir, "context-plan.json"),
        JSON.stringify({
          schema_version: "1.0.0",
          repo: "context-plan-repo",
          taskClass: "source-editing-implementation",
          contextMode: "isolated",
          closeoutAuthority: "code_tests",
          selectedPacks: [],
          allowedCapabilities: [],
          forbiddenCapabilities: [],
          conflicts: [],
          warnings: [],
        }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(runtimeDir, "dispatch-contract.json"),
        JSON.stringify({
          schema_version: "1.0.0",
          repo: "dispatch-contract-repo",
          taskClass: "source-editing-implementation",
          contextMode: "isolated",
          closeoutAuthority: "code_tests",
          validationProfile: null,
          selectedPacks: [],
          allowedCapabilities: [],
          forbiddenCapabilities: [],
          conflicts: [],
          warnings: [],
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
          'project-worker-runtime',
          'Worker Runtime Project',
          ${worktreePath},
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
          'thread-worker-runtime',
          'project-worker-runtime',
          'Worker Runtime Thread',
          '[]',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          ${worktreePath},
          NULL,
          'worker',
          '2026-05-10T00:00:02.000Z',
          '2026-05-10T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      const snapshot = yield* workerRuntime.getSnapshot({
        threadId: ThreadId.makeUnsafe("thread-worker-runtime"),
      });

      assert.equal(snapshot.summary.repo, "dispatch-contract-repo");
      assert.equal(snapshot.sourceFiles.contextPlan.status, "loaded");
      assert.equal(snapshot.sourceFiles.dispatchContract.status, "loaded");
    }),
  );
});
