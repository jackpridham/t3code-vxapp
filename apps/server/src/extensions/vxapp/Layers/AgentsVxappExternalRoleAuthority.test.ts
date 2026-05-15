import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../processRunner.ts", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../../processRunner.ts";
import { AgentsVxappExternalRoleAuthority } from "../Services/AgentsVxappExternalRoleAuthority.ts";
import { AgentsVxappExternalRoleAuthorityLive } from "./AgentsVxappExternalRoleAuthority.ts";

const mockedRunProcess = vi.mocked(runProcess);

afterEach(() => {
  mockedRunProcess.mockReset();
});

describe("AgentsVxappExternalRoleAuthorityLive", () => {
  it("loads validated runtime paths from role-session-owner", async () => {
    mockedRunProcess.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        result: {
          runtime_root: "/runtime",
          role_sessions_root: "/runtime/role-sessions",
          role_state_root: "/runtime/role-state",
          workspace_runtime_metadata_dir: ".agents/runtime",
          env: {
            runtime_root: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
            state_root: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
          },
          roles: {
            cto: {
              generated_workspace_root: "/runtime/role-sessions/cto",
              reservations_root: "/runtime/role-state/cto/reservations",
              role: "cto",
              sessions_root: "/runtime/role-state/cto/sessions",
              state_root: "/runtime/role-state/cto",
            },
            jasper: {
              generated_workspace_root: "/runtime/role-sessions/jasper",
              reservations_root: "/runtime/role-state/jasper/reservations",
              role: "jasper",
              sessions_root: "/runtime/role-state/jasper/sessions",
              state_root: "/runtime/role-state/jasper",
            },
          },
        },
      }),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const effect = Effect.gen(function* () {
      const authority = yield* AgentsVxappExternalRoleAuthority;
      return yield* authority.getRuntimePaths();
    }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive));

    await expect(Effect.runPromise(effect)).resolves.toMatchObject({
      runtimeRoot: "/runtime",
      roleSessionsRoot: "/runtime/role-sessions",
      roles: {
        cto: {
          sessionsRoot: "/runtime/role-state/cto/sessions",
        },
        jasper: {
          reservationsRoot: "/runtime/role-state/jasper/reservations",
        },
      },
    });
    expect(mockedRunProcess).toHaveBeenCalledWith(
      expect.stringMatching(/scripts\/tools\/role-session-owner$/),
      ["runtime-paths"],
      expect.objectContaining({
        cwd: expect.any(String),
      }),
    );
  });

  it("fails closed when agents-vxapp omits authoritative error presentation fields", async () => {
    mockedRunProcess.mockResolvedValueOnce({
      stdout: JSON.stringify({
        result: {
          cto: {
            workspaceRoot: "/home/gizmo/agents-vxapp/CTOv2",
            project: {
              id: "external-cto-project",
              title: "CTOv2",
              workspaceRoot: "/home/gizmo/agents-vxapp/CTOv2",
              kind: "executive",
              createdAt: "2026-05-12T00:00:00.000Z",
              updatedAt: "2026-05-12T00:00:01.000Z",
            },
            currentThread: {
              id: "external-cto-thread",
              projectId: "external-cto-project",
              title: "Review Jasper blocker and yacht watch",
              labels: ["cto-autonomous"],
              createdAt: "2026-05-12T00:00:02.000Z",
              updatedAt: "2026-05-12T00:00:03.000Z",
              archivedAt: null,
              deletedAt: null,
              session: {
                status: "ready",
                providerName: "codex",
                activeTurnId: null,
                lastError: "raw external session error",
                updatedAt: "2026-05-12T00:00:03.000Z",
              },
            },
          },
        },
      }),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const effect = Effect.gen(function* () {
      const authority = yield* AgentsVxappExternalRoleAuthority;
      return yield* authority.getSnapshot();
    }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive));

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
      detail: expect.stringContaining("missing authoritative error presentation fields"),
    });
  });

  it("fails closed when runtime-paths omits required fields", async () => {
    mockedRunProcess.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        result: {
          runtime_root: "/runtime",
        },
      }),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const effect = Effect.gen(function* () {
      const authority = yield* AgentsVxappExternalRoleAuthority;
      return yield* authority.getRuntimePaths();
    }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive));

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      operation: "AgentsVxappExternalRoleAuthority.getRuntimePaths",
      detail: expect.stringContaining("result.role_sessions_root"),
    });
  });

  it("fails closed when runtime-paths returns invalid JSON", async () => {
    mockedRunProcess.mockResolvedValueOnce({
      stdout: "{not-json",
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const effect = Effect.gen(function* () {
      const authority = yield* AgentsVxappExternalRoleAuthority;
      return yield* authority.getRuntimePaths();
    }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive));

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      operation: "AgentsVxappExternalRoleAuthority.getRuntimePaths",
      detail: expect.stringContaining("JSON"),
    });
  });

  it("fails closed when runtime-paths exits nonzero", async () => {
    mockedRunProcess.mockResolvedValueOnce({
      stdout: JSON.stringify({
        error: {
          message: "owner command failed hard",
        },
      }),
      stderr: "",
      code: 2,
      signal: null,
      timedOut: false,
    });

    const effect = Effect.gen(function* () {
      const authority = yield* AgentsVxappExternalRoleAuthority;
      return yield* authority.getRuntimePaths();
    }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive));

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      operation: "AgentsVxappExternalRoleAuthority.getRuntimePaths",
      detail: "owner command failed hard",
    });
  });

  it("fails closed when runtime-paths reports ok false", async () => {
    mockedRunProcess.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: false,
        error: {
          message: "owner refused runtime-paths",
        },
      }),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const effect = Effect.gen(function* () {
      const authority = yield* AgentsVxappExternalRoleAuthority;
      return yield* authority.getRuntimePaths();
    }).pipe(Effect.provide(AgentsVxappExternalRoleAuthorityLive));

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      operation: "AgentsVxappExternalRoleAuthority.getRuntimePaths",
      detail: "owner refused runtime-paths",
    });
  });
});
