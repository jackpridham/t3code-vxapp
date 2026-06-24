import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AgentsVxappControlPlane } from "../../extensions/vxapp/Services/AgentsVxappControlPlane.ts";
import { AgentsVxappExternalRoleAuthority } from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionSnapshotQuery.ts"), "utf8");

describe("ProjectionSnapshotQuery authority boundary", () => {
  it("consumes owner-backed Program, notification, attention, and binding truth for vxapp rows", () => {
    expect(source).toContain("getProgramsAuthoritySnapshot()");
    expect(source).toContain("getNotificationSummaryExport()");
    expect(source).toContain("getAttentionSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toContain("getBindingAuthorityForVxappProjects");
    expect(source).toMatch(/const programs: ReadonlyArray<OrchestrationProgram> =\s*ownerPrograms/);
  });

  it("omits owner programs missing executive ids instead of mapping them directly", () => {
    expect(source).toContain(
      "filterOwnerProgramsWithExecutiveIds(snapshot.programs).map(mapOwnerProgram)",
    );
    expect(source).not.toContain("snapshot.programs.map(mapOwnerProgram)");
  });

  it("does not expose local wake rows as vxapp-backed current truth", () => {
    expect(source).toMatch(
      /vxappBackedProjectRows\.length > 0\s*\?\s*\[\]\s*:\s*orchestratorWakeRows/,
    );
    expect(source).toMatch(
      /vxappBackedProjectRows\.length > 0\s*\?\s*0\s*:\s*orchestratorWakeCountRow\.count/,
    );
  });

  it("omits malformed owner programs instead of throwing during snapshot queries", async () => {
    const layer = Layer.mergeAll(
      OrchestrationProjectionSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      Layer.succeed(AgentsVxappExternalRoleAuthority, {
        getSnapshot: () =>
          Effect.succeed({
            projects: [],
            threadSummaries: [],
          }),
        getRuntimePaths: () =>
          Effect.succeed({
            runtimeRoot: "/runtime",
            roleSessionsRoot: "/runtime/role-sessions",
            roleStateRoot: "/runtime/role-state",
            workspaceRuntimeMetadataDir: ".agents/runtime",
            env: {
              runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
              stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
            },
            roles: {
              cto: {
                role: "cto" as const,
                generatedWorkspaceRoot: "/runtime/role-sessions/cto",
                stateRoot: "/runtime/role-state/cto",
                sessionsRoot: "/runtime/role-state/cto/sessions",
                reservationsRoot: "/runtime/role-state/cto/reservations",
              },
              jasper: {
                role: "jasper" as const,
                generatedWorkspaceRoot: "/runtime/role-sessions/jasper",
                stateRoot: "/runtime/role-state/jasper",
                sessionsRoot: "/runtime/role-state/jasper/sessions",
                reservationsRoot: "/runtime/role-state/jasper/reservations",
              },
            },
          }),
      }),
      Layer.succeed(AgentsVxappControlPlane, {
        getBindingAuthorityExport: () => Effect.die("unexpected control-plane call"),
        getProgramAuthorityExport: () => Effect.die("unexpected control-plane call"),
        getAttentionSummaryExport: () =>
          Effect.succeed({
            authorityStore: "sqlite",
            authoritySource: "owner-command",
            legacyFallbackUsed: false as const,
            attention: [],
            resolvedAttention: [],
            passiveNotifications: [],
          }),
        getNotificationSummaryExport: () =>
          Effect.succeed({
            authorityStore: "sqlite",
            authoritySource: "owner-command",
            legacyFallbackUsed: false as const,
            notifications: [],
            attention: [],
          }),
        getWatchSummaryExport: () => Effect.die("unexpected control-plane call"),
        getProjectionAuthoritySnapshot: () => Effect.die("unexpected control-plane call"),
        getProgramsAuthoritySnapshot: () =>
          Effect.succeed({
            programs: [
              {
                id: ProgramId.makeUnsafe("program-good"),
                title: "Good",
                objective: null,
                status: "awaiting_founder",
                executiveProjectId: ProjectId.makeUnsafe("project-cto"),
                executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
                currentOrchestratorThreadId: null,
                createdAt: "2026-06-09T00:00:00.000Z",
                updatedAt: "2026-06-09T00:00:00.000Z",
                completedAt: null,
                deletedAt: null,
              },
              {
                id: ProgramId.makeUnsafe("program-bad"),
                title: "Bad",
                objective: null,
                status: "awaiting_founder",
                executiveProjectId: null,
                executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
                currentOrchestratorThreadId: null,
                createdAt: "2026-06-09T00:00:00.000Z",
                updatedAt: "2026-06-09T00:00:00.000Z",
                completedAt: null,
                deletedAt: null,
              },
            ],
            pagination: { page: 1, limit: 20, total: 2, hasMore: false },
            authority: {
              source: "vx_sqlite_program_authority",
              legacyFallbackUsed: false,
            },
            hints: [],
          }),
        getProgramsTodosSnapshot: () => Effect.die("unexpected control-plane call"),
        createProgram: () => Effect.die("unexpected control-plane call"),
        updateProgram: () => Effect.die("unexpected control-plane call"),
        deleteProgram: () => Effect.die("unexpected control-plane call"),
        setProgramLifecycle: () => Effect.die("unexpected control-plane call"),
        createTodo: () => Effect.die("unexpected control-plane call"),
        updateTodo: () => Effect.die("unexpected control-plane call"),
        deleteTodo: () => Effect.die("unexpected control-plane call"),
      }),
    );

    const readModel = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* ProjectionSnapshotQuery;
        return yield* query.getSnapshot();
      }).pipe(Effect.provide(layer)),
    );

    expect(readModel.programs?.map((program) => program.id) ?? []).toEqual(["program-good"]);
  });
});
