import { ThreadId } from "@t3tools/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../extensions/vxapp/agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappWorkerRuntimeSnapshot: vi.fn(),
}));

import { fetchAgentsVxappWorkerRuntimeSnapshot } from "../../extensions/vxapp/agentsVxappOwnerClient.ts";
import { WorkerRuntime } from "../Services/WorkerRuntime.ts";
import { WorkerRuntimeLive } from "./WorkerRuntime.ts";

const mockedWorkerSnapshot = vi.mocked(fetchAgentsVxappWorkerRuntimeSnapshot);

const ownerWorkerSnapshot = {
  threadId: ThreadId.makeUnsafe("thread-worker"),
  worktreePath: "/tmp/owner-worktree",
  runtimeDir: "/tmp/owner-worktree/.agents/runtime",
  sourceFiles: {
    contextPlan: {
      fileName: "context-plan.json",
      absolutePath: "/tmp/owner-worktree/.agents/runtime/context-plan.json",
      status: "loaded",
      detail: null,
    },
    dispatchContract: {
      fileName: "dispatch-contract.json",
      absolutePath: "/tmp/owner-worktree/.agents/runtime/dispatch-contract.json",
      status: "loaded",
      detail: null,
    },
    installedPacks: {
      fileName: "installed-packs.json",
      absolutePath: "/tmp/owner-worktree/.agents/runtime/installed-packs.json",
      status: "loaded",
      detail: null,
    },
    instructionStackAudit: {
      fileName: "instruction-stack-audit.json",
      absolutePath: "/tmp/owner-worktree/.agents/runtime/instruction-stack-audit.json",
      status: "loaded",
      detail: null,
    },
  },
  summary: {
    repo: "owner-repo",
    taskClass: "owner-task-class",
    contextMode: "owner-context-mode",
    closeoutAuthority: "owner-closeout-authority",
    validationProfile: null,
    selectedPacks: [],
    allowedCapabilities: [],
    forbiddenCapabilities: [],
    conflicts: [],
    warnings: [],
    repoClaude: null,
    legacyGlobalSkills: null,
    workspace: "/tmp/owner-worktree",
    runtimeDir: "/tmp/owner-worktree/.agents/runtime",
    skillsDir: null,
    agentsSkillsDir: null,
    auditStatus: "clean",
    auditFindings: [],
    packAuditStatus: null,
    packAuditIssueCount: 0,
    packCount: 0,
  },
  packs: [],
  raw: {
    contextPlan: null,
    dispatchContract: null,
    installedPacks: null,
    instructionStackAudit: null,
  },
};

afterEach(() => {
  mockedWorkerSnapshot.mockReset();
});

describe("WorkerRuntimeLive", () => {
  it("uses owner runtime snapshot results instead of direct runtime-file reads", async () => {
    mockedWorkerSnapshot.mockResolvedValueOnce(ownerWorkerSnapshot);

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const workerRuntime = yield* WorkerRuntime;
        return yield* workerRuntime.getSnapshot({ threadId: ThreadId.makeUnsafe("thread-worker") });
      }).pipe(Effect.provide(WorkerRuntimeLive)),
    );

    expect(mockedWorkerSnapshot).toHaveBeenCalledWith({
      threadId: ThreadId.makeUnsafe("thread-worker"),
    });
    expect(snapshot.summary.repo).toBe("owner-repo");
    expect(snapshot.worktreePath).toBe("/tmp/owner-worktree");
  });
});
