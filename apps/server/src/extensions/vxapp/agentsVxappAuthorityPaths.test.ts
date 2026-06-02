import { describe, expect, it } from "vitest";

import type { AgentsVxappRoleSessionRuntimePaths } from "./Services/AgentsVxappExternalRoleAuthority.ts";
import {
  isAgentsVxappWorkspaceRoot,
  isAgentsVxappWorktreePath,
} from "./agentsVxappAuthorityPaths.ts";

function makeRuntimePaths(): AgentsVxappRoleSessionRuntimePaths {
  return {
    runtimeRoot: "/tmp/.agents-vxapp-runtime",
    roleSessionsRoot: "/tmp/.agents-vxapp-runtime/role-sessions",
    roleStateRoot: "/tmp/.agents-vxapp-runtime/role-state",
    workspaceRuntimeMetadataDir: ".agents/runtime",
    env: {
      runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
      stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
    },
    roles: {
      cto: {
        role: "cto",
        generatedWorkspaceRoot: "/tmp/.agents-vxapp-runtime/role-sessions/cto",
        stateRoot: "/tmp/.agents-vxapp-runtime/role-state/cto",
        sessionsRoot: "/tmp/.agents-vxapp-runtime/role-state/cto/sessions",
        reservationsRoot: "/tmp/.agents-vxapp-runtime/role-state/cto/reservations",
      },
      jasper: {
        role: "jasper",
        generatedWorkspaceRoot: "/tmp/.agents-vxapp-runtime/role-sessions/jasper",
        stateRoot: "/tmp/.agents-vxapp-runtime/role-state/jasper",
        sessionsRoot: "/tmp/.agents-vxapp-runtime/role-state/jasper/sessions",
        reservationsRoot: "/tmp/.agents-vxapp-runtime/role-state/jasper/reservations",
      },
    },
  };
}

describe("agentsVxappAuthorityPaths", () => {
  it("classifies standalone role-session runtime workspace paths as vxapp-backed", () => {
    const runtimePaths = makeRuntimePaths();

    expect(
      isAgentsVxappWorkspaceRoot(
        "/tmp/.agents-vxapp-runtime/role-sessions/jasper/session-1/workspace",
        runtimePaths,
      ),
    ).toBe(true);
    expect(
      isAgentsVxappWorktreePath(
        "/tmp/.agents-vxapp-runtime/role-sessions/cto/session-2/workspace",
        {
          runtimePaths,
        },
      ),
    ).toBe(true);
  });

  it("does not classify owner thread worktree paths outside the role-session root", () => {
    const runtimePaths = makeRuntimePaths();
    const ownerWorktreePath = "/tmp/custom-vxapp/thread-7/worktree";

    expect(
      isAgentsVxappWorktreePath(ownerWorktreePath, {
        runtimePaths,
      }),
    ).toBe(false);
  });

  it("does not classify unrelated repo-root paths as vxapp-backed", () => {
    const runtimePaths = makeRuntimePaths();

    expect(isAgentsVxappWorkspaceRoot("/home/gizmo/agents-vxapp/apps/server", runtimePaths)).toBe(
      false,
    );
    expect(
      isAgentsVxappWorktreePath("/home/gizmo/agents-vxapp/worktrees/thread-1", {
        runtimePaths,
      }),
    ).toBe(false);
  });

  it("returns false when runtime paths are missing", () => {
    expect(
      isAgentsVxappWorkspaceRoot(
        "/tmp/.agents-vxapp-runtime/role-sessions/jasper/session-1/workspace",
        null,
      ),
    ).toBe(false);
    expect(
      isAgentsVxappWorktreePath(
        "/tmp/.agents-vxapp-runtime/role-sessions/jasper/session-1/workspace",
        undefined,
      ),
    ).toBe(false);
    expect(
      isAgentsVxappWorktreePath("/tmp/custom-vxapp/thread-7/worktree", {
        runtimePaths: null,
      }),
    ).toBe(false);
  });
});
