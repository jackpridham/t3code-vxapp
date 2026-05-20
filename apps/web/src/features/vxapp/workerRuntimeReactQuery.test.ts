import { ThreadId, type NativeApi } from "@t3tools/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWorkerRuntimeRepoLabel,
  workerRuntimeRepoQueryOptions,
  workerRuntimeQueryKeys,
  workerRuntimeSnapshotQueryOptions,
} from "./workerRuntimeReactQuery";
import * as nativeApi from "~/nativeApi";

const threadId = ThreadId.makeUnsafe("worker-thread");

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    threadId,
    runtimeKind: "worker-contract",
    agentKind: "worker",
    workspace: "/fixtures/worktrees/worker-thread",
    availability: "inspectable",
    reasonCode: null,
    runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
    runtimeRoot: "/fixtures/worktrees/worker-thread/.agents",
    stateRoot: "/fixtures/worktrees/worker-thread",
    workspaceResolution: "thread-worktree",
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
      repo: "vue-vxapp",
      taskClass: "review-only",
      contextMode: "isolated",
      closeoutAuthority: "code_tests",
      workspace: "/fixtures/worktrees/worker-thread",
      runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
      skillsDir: null,
      agentsSkillsDir: null,
      instructionStackStatus: "clean",
      packAuditStatus: "clean",
      status: "clean",
      issues: [],
    },
    contextPlan: {
      schema_version: "1.0.0",
      repo: "vue-vxapp",
      taskClass: "review-only",
      contextMode: "isolated",
      closeoutAuthority: "code_tests",
      validationProfile: null,
      selectedPacks: [],
      allowedCapabilities: [],
      forbiddenCapabilities: [],
      conflicts: [],
      warnings: [],
      workspace: "/fixtures/worktrees/worker-thread",
      runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
      skillsDir: null,
      agentsSkillsDir: null,
      repoClaude: null,
      legacyGlobalSkills: false,
    },
    dispatchContract: {
      schema_version: "1.0.0",
      repo: "vue-vxapp",
      taskClass: "review-only",
      contextMode: "isolated",
      closeoutAuthority: "code_tests",
      validationProfile: null,
      selectedPacks: [],
      allowedCapabilities: [],
      forbiddenCapabilities: [],
      conflicts: [],
      warnings: [],
      workspace: "/fixtures/worktrees/worker-thread",
      runtimeFiles: {},
    },
    installedPacks: {
      schema_version: "1.0.0",
      repo: "vue-vxapp",
      taskClass: "review-only",
      contextMode: "isolated",
      closeoutAuthority: "code_tests",
      workspace: "/fixtures/worktrees/worker-thread",
      runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
      skillsDir: null,
      agentsSkillsDir: null,
      packs: [],
    },
    instructionStack: {
      schema_version: "1.0.0",
      repo: "vue-vxapp",
      taskClass: "review-only",
      contextMode: "isolated",
      closeoutAuthority: "code_tests",
      workspace: "/fixtures/worktrees/worker-thread",
      status: "clean",
      findings: [],
      packAudit: {},
    },
    findings: [],
    issues: [],
    ...overrides,
  } as const;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workerRuntimeQueryKeys.snapshot", () => {
  it("keys snapshots by thread id", () => {
    expect(workerRuntimeQueryKeys.snapshot(threadId, null)).not.toEqual(
      workerRuntimeQueryKeys.snapshot(ThreadId.makeUnsafe("other-worker-thread"), null),
    );
  });
});

describe("workerRuntimeSnapshotQueryOptions", () => {
  it("disables the query when no worker thread is selected", () => {
    const options = workerRuntimeSnapshotQueryOptions({ threadId: null });
    expect(options.enabled).toBe(false);
  });

  it("forwards the thread id and workspace to the server runtime API", async () => {
    const workspace = "/fixtures/worktrees/worker-thread";
    const getWorkerRuntimeSnapshot = vi.fn().mockResolvedValue(makeSnapshot({ workspace }));
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      server: {
        getWorkerRuntimeSnapshot,
      },
    } as unknown as NativeApi);

    const options = workerRuntimeSnapshotQueryOptions({ threadId, workspace });
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(options);

    expect(getWorkerRuntimeSnapshot).toHaveBeenCalledWith({ threadId, workspace });
  });

  it("can derive the repo label from the worker runtime snapshot", () => {
    expect(
      getWorkerRuntimeRepoLabel(
        makeSnapshot({ contextPlan: { ...makeSnapshot().contextPlan, repo: "api-vxapp" } }) as any,
      ),
    ).toBe("api-vxapp");
    expect(
      getWorkerRuntimeRepoLabel(
        makeSnapshot({
          contextPlan: null,
          dispatchContract: { ...makeSnapshot().dispatchContract, repo: "" },
          installedPacks: { ...makeSnapshot().installedPacks, repo: "stores-vxapp" },
        }) as any,
      ),
    ).toBe("stores-vxapp");
    expect(getWorkerRuntimeRepoLabel(null)).toBeNull();
  });

  it("exposes a repo-selecting query helper built on the snapshot query", () => {
    const options = workerRuntimeRepoQueryOptions({
      threadId,
      workspace: "/fixtures/worktrees/worker-thread",
    });

    expect(options.queryKey).toEqual(
      workerRuntimeQueryKeys.snapshot(threadId, "/fixtures/worktrees/worker-thread"),
    );
    expect(typeof options.select).toBe("function");
  });
});
