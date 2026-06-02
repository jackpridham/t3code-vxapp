import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ProjectionProjectRepositoryLive } from "../../../persistence/Layers/ProjectionProjects.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { ProjectionProjectRepository } from "../../../persistence/Services/ProjectionProjects.ts";
import {
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneError,
} from "../Services/AgentsVxappControlPlane.ts";
import {
  AgentsVxappExternalRoleAuthority,
  type AgentsVxappExternalRoleAuthoritySnapshot,
} from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { ProjectionBootstrapSummaryQuery } from "../Services/ProjectionBootstrapSummaryQuery.ts";
import { OrchestrationProjectionBootstrapSummaryQueryLive } from "./ProjectionBootstrapSummaryQuery.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionBootstrapSummaryQuery.ts"), "utf8");

describe("ProjectionBootstrapSummaryQuery authority boundary", () => {
  it("uses owner-backed Program truth while keeping residual notifications out of bootstrap rows", () => {
    expect(source).toContain("controlPlane.getProgramsAuthoritySnapshot()");
    expect(source).not.toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toMatch(/const programs: ReadonlyArray<OrchestrationProgram> =\s*ownerPrograms/);
    expect(source).toContain("programNotifications: []");
    expect(source).toContain("ctoAttentionItems: []");
    expect(source).toContain(
      "vxapp projection boundary requires external role authority runtime paths.",
    );
  });

  it("does not expose local wake rows as vxapp-backed bootstrap truth", () => {
    expect(source).not.toContain("ProjectionOrchestratorWake");
    expect(source).toContain("orchestratorWakeItems: []");
    expect(source).toContain("wakeItemsTruncated: true");
  });

  it("validates external-role authority before merging startup projects and threads", () => {
    expect(source).toContain("validateExternalRoleAuthoritySnapshot(snapshot)");
    expect(source).toContain("ProjectionBootstrapSummaryQuery.externalRoleAuthority:validate");
  });

  it("returns startup-safe external projects even when local projection project rows are empty", async () => {
    const projectId = ProjectId.makeUnsafe("project-external");
    const threadId = ThreadId.makeUnsafe("thread-external");
    const layer = Layer.mergeAll(
      OrchestrationProjectionBootstrapSummaryQueryLive.pipe(
        Layer.provideMerge(SqlitePersistenceMemory),
      ),
      Layer.succeed(AgentsVxappExternalRoleAuthority, {
        getSnapshot: () =>
          Effect.succeed({
            projects: [
              {
                id: projectId,
                title: "External Project",
                workspaceRoot: "/runtime/role-sessions/jasper/workspace/project-external",
                kind: "workspace",
                currentSessionRootThreadId: threadId,
                defaultModelSelection: null,
                scripts: [],
                hooks: [],
                createdAt: "2026-05-18T04:00:00.000Z",
                updatedAt: "2026-05-18T04:02:00.000Z",
                deletedAt: null,
              },
            ],
            threadSummaries: [
              {
                id: threadId,
                projectId,
                title: "External Thread",
                labels: [],
                modelSelection: { provider: "codex", model: "gpt-5.4" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: "/runtime/role-sessions/jasper/workspace/project-external",
                latestTurn: null,
                createdAt: "2026-05-18T04:00:00.000Z",
                updatedAt: "2026-05-18T04:03:00.000Z",
                archivedAt: null,
                deletedAt: null,
                session: null,
                hasActiveError: false,
                activeError: null,
                historicalError: null,
                errorPresentationSource: "none",
              },
            ],
          } as unknown as AgentsVxappExternalRoleAuthoritySnapshot),
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
        getAttentionSummaryExport: () => Effect.die("unexpected control-plane call"),
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
        const query = yield* ProjectionBootstrapSummaryQuery;
        return yield* query.getBootstrapSummary();
      }).pipe(Effect.provide(layer)),
    );

    expect(readModel.snapshotProfile).toBe("bootstrap-summary");
    expect(readModel.projects).toEqual([
      expect.objectContaining({
        id: projectId,
        title: "External Project",
        workspaceRoot: "/runtime/role-sessions/jasper/workspace/project-external",
        kind: "project",
        currentSessionRootThreadId: threadId,
      }),
    ]);
    expect(readModel.threads).toEqual([
      expect.objectContaining({
        id: threadId,
        projectId,
        title: "External Thread",
      }),
    ]);
    expect(readModel.orchestratorWakeItems).toEqual([]);
  });

  it("does not synthesize vxapp-backed bootstrap projects from local projection rows", async () => {
    const sqliteBackedLayer = Layer.mergeAll(
      ProjectionProjectRepositoryLive,
      OrchestrationProjectionBootstrapSummaryQueryLive,
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
        getAttentionSummaryExport: () => Effect.die("unexpected control-plane call"),
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
        const query = yield* ProjectionBootstrapSummaryQuery;
        return yield* query.getBootstrapSummary();
      }).pipe(Effect.provide(layer)),
    );

    expect(readModel.projects).toEqual([]);
  });

  it("surfaces owner command diagnostics clearly when bootstrap startup authority fails", async () => {
    const sqliteBackedLayer = Layer.mergeAll(
      ProjectionProjectRepositoryLive,
      OrchestrationProjectionBootstrapSummaryQueryLive,
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
        getAttentionSummaryExport: () => Effect.die("unexpected control-plane call"),
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
          Effect.fail(
            new AgentsVxappControlPlaneError({
              operation: "ownerControlPlane.programsAuthority.getSnapshot",
              detail: "bootstrap owner snapshot failed",
              ownerCommand: "t3code-programs-authority-snapshot",
              authoritySurface: "programs_authority_snapshot",
              ownerErrorCode: "program_authority_failed",
              authorityStore: "sqlite",
              authoritySource: "owner-command",
              contractFamily: "agents-vxapp-t3code-authority",
              contractVersion: "v1",
              exitCode: 17,
              stdout: '{"ok":false}',
              stderr: "stderr detail",
            }),
          ),
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
        const query = yield* ProjectionBootstrapSummaryQuery;
        return yield* query.getBootstrapSummary();
      }).pipe(Effect.provide(layer), Effect.runPromise),
    ).rejects.toMatchObject({
      operation: "ProjectionBootstrapSummaryQuery.getBootstrapSummary:query",
      detail: expect.stringContaining("bootstrap owner snapshot failed"),
      cause: expect.objectContaining({
        ownerCommand: "t3code-programs-authority-snapshot",
        authoritySurface: "programs_authority_snapshot",
        ownerErrorCode: "program_authority_failed",
      }),
    });
  });
});
