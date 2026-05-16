import { ThreadId, type ServerGetWorkerRuntimeSnapshotResult } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { deriveWorkerRuntimeDialogState } from "./workerRuntimeDialogState";

const threadId = ThreadId.makeUnsafe("worker-thread");

function makeSnapshot(
  overrides?: Partial<ServerGetWorkerRuntimeSnapshotResult>,
): ServerGetWorkerRuntimeSnapshotResult {
  return {
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
      taskClass: "source-editing-implementation",
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
    ...overrides,
  };
}

describe("deriveWorkerRuntimeDialogState", () => {
  it("surfaces worker-unavailable detail when all runtime files are missing", () => {
    const state = deriveWorkerRuntimeDialogState({
      data: makeSnapshot({
        sourceFiles: {
          contextPlan: {
            absolutePath: "runtime-unavailable/context-plan.json",
            detail: "Worker thread 'worker-thread' has no worktree path yet.",
            fileName: "context-plan.json",
            status: "missing",
          },
          dispatchContract: {
            absolutePath: "runtime-unavailable/dispatch-contract.json",
            detail: "Worker thread 'worker-thread' has no worktree path yet.",
            fileName: "dispatch-contract.json",
            status: "missing",
          },
          installedPacks: {
            absolutePath: "runtime-unavailable/installed-packs.json",
            detail: "Worker thread 'worker-thread' has no worktree path yet.",
            fileName: "installed-packs.json",
            status: "missing",
          },
          instructionStackAudit: {
            absolutePath: "runtime-unavailable/instruction-stack-audit.json",
            detail: "Worker thread 'worker-thread' has no worktree path yet.",
            fileName: "instruction-stack-audit.json",
            status: "missing",
          },
        },
      }),
      error: null,
      isError: false,
      isLoading: false,
      threadId,
    });

    expect(state).toEqual({
      mode: "ready",
      message: null,
    });
  });

  it("surfaces invalid runtime file detail", () => {
    const state = deriveWorkerRuntimeDialogState({
      data: makeSnapshot({
        sourceFiles: {
          ...makeSnapshot().sourceFiles,
          dispatchContract: {
            absolutePath:
              "/fixtures/worktrees/worker-thread/.agents/runtime/dispatch-contract.json",
            detail: "Schema validation failed.",
            fileName: "dispatch-contract.json",
            status: "schema-error",
          },
        },
      }),
      error: null,
      isError: false,
      isLoading: false,
      threadId,
    });

    expect(state).toEqual({
      mode: "ready",
      message: null,
    });
  });

  it("surfaces transient worker detail before attempting runtime lookup", () => {
    const state = deriveWorkerRuntimeDialogState({
      data: null,
      error: null,
      isError: false,
      isLoading: false,
      threadId,
      unavailableHint: {
        kind: "transient",
        message:
          "This worker row appears to be a transient dispatch/runtime entry with no prepared worktree or runtime bundle.",
      },
    });

    expect(state).toEqual({
      mode: "transient",
      message:
        "This worker row appears to be a transient dispatch/runtime entry with no prepared worktree or runtime bundle.",
    });
  });

  it("surfaces stale-lineage worker detail before attempting runtime lookup", () => {
    const state = deriveWorkerRuntimeDialogState({
      data: null,
      error: null,
      isError: false,
      isLoading: false,
      threadId,
      unavailableHint: {
        kind: "stale-lineage",
        message:
          "This worker row is only present in fallback sqlite lineage data and is unavailable in the current T3 projection.",
      },
    });

    expect(state).toEqual({
      mode: "stale-lineage",
      message:
        "This worker row is only present in fallback sqlite lineage data and is unavailable in the current T3 projection.",
    });
  });

  it("returns ready when runtime files are available", () => {
    expect(
      deriveWorkerRuntimeDialogState({
        data: makeSnapshot(),
        error: null,
        isError: false,
        isLoading: false,
        threadId,
        unavailableHint: null,
      }),
    ).toEqual({
      mode: "ready",
      message: null,
    });
  });
});
