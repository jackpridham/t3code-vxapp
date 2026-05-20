import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agentsVxappOwnerClient.ts")>();
  return {
    ...actual,
    fetchAgentsVxappExternalRoleAuthoritySnapshot: vi.fn(),
    fetchAgentsVxappRoleSessionRuntimePaths: vi.fn(),
  };
});

import {
  fetchAgentsVxappExternalRoleAuthoritySnapshot,
  fetchAgentsVxappRoleSessionRuntimePaths,
} from "../agentsVxappOwnerClient.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { AgentsVxappOwnerClientError } from "../agentsVxappOwnerClient.ts";
import { AgentsVxappExternalRoleAuthorityLive } from "./AgentsVxappExternalRoleAuthority.ts";

const mockedExternalRoleAuthoritySnapshot = vi.mocked(
  fetchAgentsVxappExternalRoleAuthoritySnapshot,
);
const mockedRuntimePaths = vi.mocked(fetchAgentsVxappRoleSessionRuntimePaths);

afterEach(() => {
  vi.resetAllMocks();
});

describe("AgentsVxappExternalRoleAuthorityLive", () => {
  it("loads snapshot authority through the owner client", async () => {
    mockedExternalRoleAuthoritySnapshot.mockResolvedValueOnce({
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
    expect(mockedExternalRoleAuthoritySnapshot).toHaveBeenCalledTimes(1);
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

  it("preserves owner diagnostics when the external-role layer maps owner failures", async () => {
    mockedRuntimePaths.mockRejectedValueOnce(
      new AgentsVxappOwnerClientError({
        message: "role-session owner failed",
        ownerCommand: "runtime-paths",
        authoritySurface: "role_session_runtime_paths",
        ownerErrorCode: "runtime_paths_missing",
        authorityStore: "role-session-runtime",
        authoritySource: "role-session-owner",
        contractFamily: "agents-vxapp-role-session-authority",
        contractVersion: "v1",
        exitCode: 4,
        stdout: '{"ok":false}',
        stderr: "stderr detail",
      }),
    );

    await expect(
      Effect.gen(function* () {
        const authority = yield* AgentsVxappExternalRoleAuthority;
        return yield* authority.getRuntimePaths();
      }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive), Effect.runPromise),
    ).rejects.toMatchObject({
      detail: "role-session owner failed",
      ownerCommand: "runtime-paths",
      authoritySurface: "role_session_runtime_paths",
      ownerErrorCode: "runtime_paths_missing",
      authorityStore: "role-session-runtime",
      authoritySource: "role-session-owner",
      contractFamily: "agents-vxapp-role-session-authority",
      contractVersion: "v1",
      exitCode: 4,
      stdout: '{"ok":false}',
      stderr: "stderr detail",
    });
  });
});
