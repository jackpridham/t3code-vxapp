import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { ProjectionBootstrapSummaryQuery } from "../Services/ProjectionBootstrapSummaryQuery.ts";
import { OrchestrationProjectionBootstrapSummaryQueryLive } from "./ProjectionBootstrapSummaryQuery.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionBootstrapSummaryQuery.ts"), "utf8");

describe("ProjectionBootstrapSummaryQuery authority boundary", () => {
  it("uses owner-backed Program and notification truth for vxapp bootstrap rows", () => {
    expect(source).toContain("controlPlane.getProgramsProjectionSnapshot()");
    expect(source).toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toContain("ownerPrograms ??");
    expect(source).toContain(
      "vxapp projection boundary requires external role authority runtime paths.",
    );
  });

  it("does not expose local wake rows as vxapp-backed bootstrap truth", () => {
    expect(source).toMatch(
      /const orchestratorWakeItems: ReadonlyArray<OrchestratorWakeItem> =[\s\S]*vxappBacked[\s\S]*\?\s*\[\]/,
    );
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
                kind: "project",
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
});
