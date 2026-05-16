import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappControlPlaneSnapshot: vi.fn(),
  fetchAgentsVxappRoleSessionRuntimePaths: vi.fn(),
}));

import {
  fetchAgentsVxappControlPlaneSnapshot,
  fetchAgentsVxappRoleSessionRuntimePaths,
} from "../agentsVxappOwnerClient.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { AgentsVxappExternalRoleAuthorityLive } from "./AgentsVxappExternalRoleAuthority.ts";

const mockedControlPlaneSnapshot = vi.mocked(fetchAgentsVxappControlPlaneSnapshot);
const mockedRuntimePaths = vi.mocked(fetchAgentsVxappRoleSessionRuntimePaths);

afterEach(() => {
  vi.resetAllMocks();
});

describe("AgentsVxappExternalRoleAuthorityLive", () => {
  it("loads snapshot authority through the owner client", async () => {
    mockedControlPlaneSnapshot.mockResolvedValueOnce({
      externalRoleAuthority: {
        projects: [{ id: "project-owner", workspaceRoot: "/tmp/owner" }],
        threadSummaries: [{ id: "thread-owner", worktreePath: "/tmp/owner" }],
      },
    });

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const authority = yield* AgentsVxappExternalRoleAuthority;
        return yield* authority.getSnapshot();
      }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive)),
    );

    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.threadSummaries).toHaveLength(1);
    expect(mockedControlPlaneSnapshot).toHaveBeenCalledTimes(1);
  });

  it("loads role-session runtime paths through the owner client", async () => {
    const runtimePaths = {
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
    };
    mockedRuntimePaths.mockResolvedValueOnce(runtimePaths);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const authority = yield* AgentsVxappExternalRoleAuthority;
        return yield* authority.getRuntimePaths();
      }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive)),
    );

    expect(result).toBe(runtimePaths);
    expect(mockedRuntimePaths).toHaveBeenCalledTimes(1);
  });
});
