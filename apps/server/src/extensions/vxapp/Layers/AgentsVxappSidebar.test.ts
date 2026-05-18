import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappSidebarGraphSnapshot: vi.fn(),
}));

import { fetchAgentsVxappSidebarGraphSnapshot } from "../agentsVxappOwnerClient.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { AgentsVxappSidebar } from "../Services/AgentsVxappSidebar.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { AgentsVxappSidebarLive } from "./AgentsVxappSidebar.ts";

const mockedSidebarGraphSnapshot = vi.mocked(fetchAgentsVxappSidebarGraphSnapshot);

const ownerGraph = {
  source: "sqlite" as const,
  dbPath: "owner-db",
  fallbackReason: null,
  threadLinks: [
    {
      threadId: ThreadId.makeUnsafe("thread-owner"),
      projectId: ProjectId.makeUnsafe("project-owner"),
      workspaceRoot: "/tmp/workspace",
      worktreePath: "/tmp/worktree",
      roleSession: null,
      title: "Owner thread",
      spawnRole: "invented-owner-role",
      spawnedBy: null,
      parentThreadId: null,
      workflowId: null,
      programId: null,
      executiveProjectId: null,
      executiveThreadId: null,
      orchestratorThreadId: null,
      labels: [],
      session: null,
      latestTurn: null,
      metadata: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:01.000Z",
      archivedAt: null,
      deletedAt: null,
    },
  ],
  openWakes: [
    {
      wakeId: "wake-owner",
      orchestratorThreadId: ThreadId.makeUnsafe("thread-owner"),
      programId: null,
      state: "owner-invented-state",
      reason: "owner reason",
      payload: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:01.000Z",
      settledAt: null,
    },
  ],
  watchProjections: [],
  notifications: [
    {
      notificationId: "notification-owner",
      programId: null,
      executiveProjectId: null,
      executiveThreadId: null,
      orchestratorThreadId: null,
      kind: "owner-new-kind",
      severity: "critical" as const,
      summary: "Owner notification",
      evidence: null,
      state: "owner-new-state",
      queuedAt: "2026-05-16T00:00:00.000Z",
      deliveredAt: null,
      consumedAt: null,
      droppedAt: null,
      consumeReason: null,
      dropReason: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:01.000Z",
    },
  ],
  attentionItems: [],
};

const sidebarLayer = AgentsVxappSidebarLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(
    Layer.succeed(AgentsVxappExternalRoleAuthority, {
      getSnapshot: () => Effect.succeed({ projects: [], threadSummaries: [] }),
      getRuntimePaths: () => Effect.die("unexpected getRuntimePaths"),
    }),
  ),
);

afterEach(() => {
  mockedSidebarGraphSnapshot.mockReset();
});

describe("AgentsVxappSidebarLive", () => {
  it("assembles the graph from owner-backed inputs without normalizing owner vocabularies", async () => {
    mockedSidebarGraphSnapshot.mockResolvedValueOnce(ownerGraph);

    const graph = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        const sidebar = yield* AgentsVxappSidebar;
        return yield* sidebar.getGraph({});
      }).pipe(Effect.provide(sidebarLayer)),
    );

    expect(mockedSidebarGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(graph.threadLinks[0]?.spawnRole).toBe("invented-owner-role");
    expect(graph.openWakes[0]?.state).toBe("owner-invented-state");
    expect(graph.notifications[0]?.kind).toBe("owner-new-kind");
    expect(graph.notifications[0]?.state).toBe("owner-new-state");
    expect(graph.mirrorDiagnostics).toEqual({
      missingProjectIds: ["project-owner"],
      missingThreadIds: ["thread-owner"],
      staleMirror: true,
    });
  });
});
