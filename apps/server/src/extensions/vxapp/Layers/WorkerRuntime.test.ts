import { ThreadId } from "@t3tools/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentsVxappOwnerClient.ts", () => ({
  fetchAgentsVxappWorkerRuntimeSnapshot: vi.fn(),
}));

import { fetchAgentsVxappWorkerRuntimeSnapshot } from "../agentsVxappOwnerClient.ts";
import { WorkerRuntime } from "../Services/WorkerRuntime.ts";
import { WorkerRuntimeLive } from "./WorkerRuntime.ts";

const mockedWorkerSnapshot = vi.mocked(fetchAgentsVxappWorkerRuntimeSnapshot);

const ownerWorkerSnapshot = {
  threadId: ThreadId.makeUnsafe("thread-worker"),
  runtimeKind: "worker-contract" as const,
  agentKind: "worker" as const,
  workspace: "/tmp/owner-worktree",
  availability: "inspectable" as const,
  reasonCode: null,
  runtimeDir: "/tmp/owner-worktree/.agents/runtime",
  runtimeRoot: "/tmp/owner-worktree/.agents",
  stateRoot: "/tmp/owner-worktree",
  workspaceResolution: "thread-worktree" as const,
  sourceFiles: {
    contextPlan: {
      status: "loaded",
      failureCode: null,
      failureMessage: null,
    },
    dispatchContract: {
      status: "loaded",
      failureCode: null,
      failureMessage: null,
    },
    installedPacks: {
      status: "loaded",
      failureCode: null,
      failureMessage: null,
    },
  },
  audit: {
    schema_version: "1.0.0",
    repo: "owner-repo",
    taskClass: "owner-task-class",
    contextMode: "owner-context-mode",
    closeoutAuthority: "owner-closeout-authority",
    workspace: "/tmp/owner-worktree",
    runtimeDir: "/tmp/owner-worktree/.agents/runtime",
    skillsDir: null,
    agentsSkillsDir: null,
    instructionStackStatus: "clean",
    packAuditStatus: "clean",
    status: "clean",
    issues: [],
  },
  contextPlan: {
    schema_version: "1.0.0",
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
    workspace: "/tmp/owner-worktree",
    runtimeDir: "/tmp/owner-worktree/.agents/runtime",
    skillsDir: null,
    agentsSkillsDir: null,
    repoClaude: null,
    legacyGlobalSkills: false,
  },
  dispatchContract: {
    schema_version: "1.0.0",
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
    workspace: "/tmp/owner-worktree",
    runtimeFiles: {},
  },
  installedPacks: {
    schema_version: "1.0.0",
    repo: "owner-repo",
    taskClass: "owner-task-class",
    contextMode: "owner-context-mode",
    closeoutAuthority: "owner-closeout-authority",
    workspace: "/tmp/owner-worktree",
    runtimeDir: "/tmp/owner-worktree/.agents/runtime",
    skillsDir: null,
    agentsSkillsDir: null,
    packs: [],
  },
  instructionStack: {
    schema_version: "1.0.0",
    repo: "owner-repo",
    taskClass: "owner-task-class",
    contextMode: "owner-context-mode",
    closeoutAuthority: "owner-closeout-authority",
    workspace: "/tmp/owner-worktree",
    status: "clean",
    findings: [],
    packAudit: {},
  },
  findings: [],
  issues: [],
} as const;

afterEach(() => {
  mockedWorkerSnapshot.mockReset();
});

describe("WorkerRuntimeLive", () => {
  it("uses owner runtime snapshot results instead of direct runtime-file reads", async () => {
    mockedWorkerSnapshot.mockResolvedValueOnce(ownerWorkerSnapshot);

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const workerRuntime = yield* WorkerRuntime;
        return yield* workerRuntime.getSnapshot({
          threadId: ThreadId.makeUnsafe("thread-worker"),
          workspace: "/tmp/owner-worktree",
        });
      }).pipe(Effect.provide(WorkerRuntimeLive)),
    );

    expect(mockedWorkerSnapshot).toHaveBeenCalledWith({
      threadId: ThreadId.makeUnsafe("thread-worker"),
      workspace: "/tmp/owner-worktree",
    });
    expect(snapshot.contextPlan?.repo).toBe("owner-repo");
    expect(snapshot.workspace).toBe("/tmp/owner-worktree");
  });
});
