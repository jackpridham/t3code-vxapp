import { ThreadId } from "@t3tools/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../extensions/vxapp/agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappAgentRuntimeSnapshot: vi.fn(),
}));

import { fetchAgentsVxappAgentRuntimeSnapshot } from "../../extensions/vxapp/agentsVxappOwnerClient.ts";
import { AgentRuntime } from "../Services/AgentRuntime.ts";
import { AgentRuntimeLive } from "./AgentRuntime.ts";

const mockedAgentSnapshot = vi.mocked(fetchAgentsVxappAgentRuntimeSnapshot);

const ownerAgentSnapshot = {
  threadId: ThreadId.makeUnsafe("thread-agent"),
  agentKind: "orchestrator",
  runtimeKind: "role-runtime",
  workspaceRoot: "/tmp/owner-role-workspace",
  runtimeDir: "/tmp/owner-role-workspace/.agents/runtime",
  workspaceResolution: {
    kind: "owner-runtime-snapshot",
    detail: "Owner supplied runtime snapshot.",
  },
  sourceFiles: [
    {
      key: "selectedProfile",
      label: "profile",
      fileName: "selected-profile.json",
      absolutePath: "/tmp/owner-role-workspace/.agents/runtime/selected-profile.json",
      status: "loaded",
      detail: null,
    },
  ],
  summary: {
    repo: "owner-repo",
    role: "jasper",
    profile: "owner-profile",
    taskClass: null,
    contextMode: null,
    closeoutAuthority: null,
    generatedAt: null,
    selectedPacks: [],
    installedSkills: [],
    packCount: 0,
    skillCount: 0,
  },
  workerDetails: null,
  roleDetails: {
    selectionReason: "owner-selected",
  },
};

afterEach(() => {
  mockedAgentSnapshot.mockReset();
});

describe("AgentRuntimeLive", () => {
  it("uses owner agent runtime snapshot results instead of runtime path/file inspection", async () => {
    mockedAgentSnapshot.mockResolvedValueOnce(ownerAgentSnapshot);

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const agentRuntime = yield* AgentRuntime;
        return yield* agentRuntime.getSnapshot({
          threadId: ThreadId.makeUnsafe("thread-agent"),
          agentKind: "orchestrator",
        });
      }).pipe(Effect.provide(AgentRuntimeLive)),
    );

    expect(mockedAgentSnapshot).toHaveBeenCalledWith({
      threadId: "thread-agent",
      agentKind: "orchestrator",
    });
    expect(snapshot.summary.repo).toBe("owner-repo");
    expect(snapshot.workspaceRoot).toBe("/tmp/owner-role-workspace");
  });
});
