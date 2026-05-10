import { ThreadId, type NativeApi } from "@t3tools/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWorkerRuntimeRepoLabel,
  workerRuntimeRepoQueryOptions,
  workerRuntimeQueryKeys,
  workerRuntimeSnapshotQueryOptions,
} from "./workerRuntimeReactQuery";
import * as nativeApi from "../nativeApi";

const threadId = ThreadId.makeUnsafe("worker-thread");

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

  it("forwards the thread id and worktree path hint to the server runtime API", async () => {
    const worktreePath = "/fixtures/worktrees/worker-thread";
    const getWorkerRuntimeSnapshot = vi.fn().mockResolvedValue({
      threadId,
      worktreePath,
      runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
      sourceFiles: {
        contextPlan: {
          absolutePath: "/fixtures/worktrees/worker-thread/.agents/runtime/context-plan.json",
          detail: null,
          fileName: "context-plan.json",
          status: "loaded",
        },
        dispatchContract: {
          absolutePath: "/fixtures/worktrees/worker-thread/.agents/runtime/dispatch-contract.json",
          detail: null,
          fileName: "dispatch-contract.json",
          status: "loaded",
        },
        installedPacks: {
          absolutePath: "/fixtures/worktrees/worker-thread/.agents/runtime/installed-packs.json",
          detail: null,
          fileName: "installed-packs.json",
          status: "loaded",
        },
        instructionStackAudit: {
          absolutePath:
            "/fixtures/worktrees/worker-thread/.agents/runtime/instruction-stack-audit.json",
          detail: null,
          fileName: "instruction-stack-audit.json",
          status: "loaded",
        },
      },
      summary: {
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
        repoClaude: null,
        legacyGlobalSkills: false,
        workspace: "/fixtures/worktrees/worker-thread",
        runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
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
    });
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      server: {
        getWorkerRuntimeSnapshot,
      },
    } as unknown as NativeApi);

    const options = workerRuntimeSnapshotQueryOptions({ threadId, worktreePath });
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(options);

    expect(getWorkerRuntimeSnapshot).toHaveBeenCalledWith({ threadId, worktreePath });
  });

  it("can derive the repo label from the runtime snapshot summary", () => {
    const snapshot = {
      threadId,
      worktreePath: "/fixtures/worktrees/worker-thread",
      runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
      sourceFiles: {
        contextPlan: {
          absolutePath: "/fixtures/worktrees/worker-thread/.agents/runtime/context-plan.json",
          detail: null,
          fileName: "context-plan.json",
          status: "loaded",
        },
        dispatchContract: {
          absolutePath: "/fixtures/worktrees/worker-thread/.agents/runtime/dispatch-contract.json",
          detail: null,
          fileName: "dispatch-contract.json",
          status: "loaded",
        },
        installedPacks: {
          absolutePath: "/fixtures/worktrees/worker-thread/.agents/runtime/installed-packs.json",
          detail: null,
          fileName: "installed-packs.json",
          status: "loaded",
        },
        instructionStackAudit: {
          absolutePath:
            "/fixtures/worktrees/worker-thread/.agents/runtime/instruction-stack-audit.json",
          detail: null,
          fileName: "instruction-stack-audit.json",
          status: "loaded",
        },
      },
      summary: {
        repo: "api-vxapp",
        taskClass: "review-only",
        contextMode: "isolated",
        closeoutAuthority: "code_tests",
        validationProfile: null,
        selectedPacks: [],
        allowedCapabilities: [],
        forbiddenCapabilities: [],
        conflicts: [],
        warnings: [],
        repoClaude: null,
        legacyGlobalSkills: false,
        workspace: "/fixtures/worktrees/worker-thread",
        runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
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
    } as const;

    expect(getWorkerRuntimeRepoLabel(snapshot as any)).toBe("api-vxapp");
    expect(getWorkerRuntimeRepoLabel(null)).toBeNull();
  });

  it("exposes a repo-selecting query helper built on the snapshot query", () => {
    const options = workerRuntimeRepoQueryOptions({
      threadId,
      worktreePath: "/fixtures/worktrees/worker-thread",
    });

    expect(options.queryKey).toEqual(
      workerRuntimeQueryKeys.snapshot(threadId, "/fixtures/worktrees/worker-thread"),
    );
    expect(typeof options.select).toBe("function");
  });
});
