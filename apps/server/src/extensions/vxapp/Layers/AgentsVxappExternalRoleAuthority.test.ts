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
});
