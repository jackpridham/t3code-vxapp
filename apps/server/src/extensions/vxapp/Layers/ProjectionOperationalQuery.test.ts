import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectionProjectRepositoryLive } from "../../../persistence/Layers/ProjectionProjects.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { ProjectionProjectRepository } from "../../../persistence/Services/ProjectionProjects.ts";
import {
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneError,
} from "../Services/AgentsVxappControlPlane.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { ProjectionOperationalQuery } from "../Services/ProjectionOperationalQuery.ts";
import { OrchestrationProjectionOperationalQueryLive } from "./ProjectionOperationalQuery.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionOperationalQuery.ts"), "utf8");

describe("ProjectionOperationalQuery authority boundary", () => {
  it("uses owner-backed current Program, notification, attention, and binding truth for vxapp rows", () => {
    expect(source).toContain("controlPlane.getProgramsAuthoritySnapshot()");
    expect(source).toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("controlPlane.getAttentionSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toContain("getBindingAuthorityForVxappProjectRows");
    expect(source).toContain("filterOwnerProgramsWithExecutiveIds");
    expect(source).toContain(
      "vxapp projection boundary requires external role authority runtime paths.",
    );
  });

  it("does not query retired local Program projection tables", () => {
    expect(source).not.toContain("listProgramRows");
    expect(source).not.toContain("projection_programs");
    expect(source).not.toContain("projection_program_notifications");
    expect(source).not.toContain("projection_cto_attention");
  });

  it("validates external-role authority before merging operational projects and threads", () => {
    expect(source).toContain("validateExternalRoleAuthoritySnapshot(snapshot)");
    expect(source).toContain("ProjectionOperationalQuery.externalRoleAuthority:validate");
  });

  it("does not synthesize vxapp-backed current-state projects from local projection rows", async () => {
    const sqliteBackedLayer = Layer.mergeAll(
      ProjectionProjectRepositoryLive,
      OrchestrationProjectionOperationalQueryLive,
    ).pipe(Layer.provide(SqlitePersistenceMemory));
    const layer = Layer.mergeAll(
      sqliteBackedLayer,
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
        getBindingAuthorityExport: () =>
          Effect.succeed({
            authorityStore: "sqlite",
            authoritySource: "owner-command",
            legacyFallbackUsed: false as const,
            diagnostics: null,
            jasper: {
              currentThread: {
                id: "thread-owner",
                programId: "program-owner",
                projectId: "project-owner",
              },
              project: {
                currentSessionRootThreadId: "thread-owner",
              },
            },
          }),
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
            programs: [],
            pagination: { page: 1, limit: 20, total: 0, hasMore: false },
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
        const repository = yield* ProjectionProjectRepository;
        yield* repository.upsert({
          projectId: ProjectId.makeUnsafe("project-local-vxapp"),
          title: "Local vxapp Projection",
          workspaceRoot: "/runtime/role-sessions/jasper/session-1/workspace",
          kind: "project",
          sidebarParentProjectId: null,
          currentSessionRootThreadId: null,
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: "2026-05-18T04:00:00.000Z",
          updatedAt: "2026-05-18T04:02:00.000Z",
          deletedAt: null,
        });
        const query = yield* ProjectionOperationalQuery;
        return yield* query.getCurrentState();
      }).pipe(Effect.provide(layer)),
    );

    expect(readModel.projects).toEqual([]);
  });

  it("omits malformed owner programs instead of throwing during current-state queries", async () => {
    const layer = Layer.mergeAll(
      OrchestrationProjectionOperationalQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
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
        const query = yield* ProjectionOperationalQuery;
        return yield* query.getCurrentState();
      }).pipe(Effect.provide(layer)),
    );

    expect(readModel.programs?.map((program) => program.id) ?? []).toEqual(["program-good"]);
  });

  it("surfaces owner command diagnostics clearly when current-state startup authority fails", async () => {
    const sqliteBackedLayer = Layer.mergeAll(
      ProjectionProjectRepositoryLive,
      OrchestrationProjectionOperationalQueryLive,
    ).pipe(Layer.provide(SqlitePersistenceMemory));
    const layer = Layer.mergeAll(
      sqliteBackedLayer,
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
        getBindingAuthorityExport: () =>
          Effect.fail(
            new AgentsVxappControlPlaneError({
              operation: "ownerControlPlane.bindingAuthority.getSnapshot",
              detail: "current-state owner binding failed",
              ownerCommand: "t3code-control-plane-snapshot",
              authoritySurface: "binding_authority",
              ownerErrorCode: "binding_authority_failed",
              authorityStore: "sqlite",
              authoritySource: "owner-command",
              contractFamily: "agents-vxapp-t3code-authority",
              contractVersion: "v1",
              exitCode: 21,
              stdout: '{"ok":false}',
              stderr: "stderr detail",
            }),
          ),
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
            programs: [],
            pagination: { page: 1, limit: 20, total: 0, hasMore: false },
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

    await expect(
      Effect.gen(function* () {
        const repository = yield* ProjectionProjectRepository;
        yield* repository.upsert({
          projectId: ProjectId.makeUnsafe("project-external"),
          title: "External Project",
          workspaceRoot: "/runtime/role-sessions/jasper/workspace/project-external",
          kind: "project",
          sidebarParentProjectId: null,
          currentSessionRootThreadId: null,
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: "2026-05-18T04:00:00.000Z",
          updatedAt: "2026-05-18T04:02:00.000Z",
          deletedAt: null,
        });
        const query = yield* ProjectionOperationalQuery;
        return yield* query.getCurrentState();
      }).pipe(Effect.provide(layer), Effect.runPromise),
    ).rejects.toMatchObject({
      operation: "ProjectionOperationalQuery.getCurrentState:query",
      detail: expect.stringContaining("current-state owner binding failed"),
      cause: expect.objectContaining({
        ownerCommand: "t3code-control-plane-snapshot",
        authoritySurface: "binding_authority",
        ownerErrorCode: "binding_authority_failed",
      }),
    });
  });
});
