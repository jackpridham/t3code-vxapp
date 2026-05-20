import { ThreadId, type ServerGetWorkerRuntimeSnapshotResult } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { deriveWorkerRuntimeDialogState } from "./workerRuntimeDialogState";

const threadId = ThreadId.makeUnsafe("worker-thread");

function makeSnapshot(
  overrides?: Partial<ServerGetWorkerRuntimeSnapshotResult>,
): ServerGetWorkerRuntimeSnapshotResult {
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
      repo: "api-vxapp",
      taskClass: "source-editing-implementation",
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
      workspace: "/fixtures/worktrees/worker-thread",
      runtimeDir: "/fixtures/worktrees/worker-thread/.agents/runtime",
      skillsDir: null,
      agentsSkillsDir: null,
      repoClaude: null,
      legacyGlobalSkills: false,
    },
    dispatchContract: {
      schema_version: "1.0.0",
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
      workspace: "/fixtures/worktrees/worker-thread",
      runtimeFiles: {},
    },
    installedPacks: {
      schema_version: "1.0.0",
      repo: "api-vxapp",
      taskClass: "source-editing-implementation",
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
      repo: "api-vxapp",
      taskClass: "source-editing-implementation",
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
  };
}

describe("deriveWorkerRuntimeDialogState", () => {
  it("treats loaded runtime snapshots as ready", () => {
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

  it("surfaces owner degraded responses instead of transport errors", () => {
    const state = deriveWorkerRuntimeDialogState({
      data: makeSnapshot({
        availability: "degraded",
        reasonCode: "runtime_files_missing",
        sourceFiles: {
          contextPlan: {
            status: "missing",
            failureCode: "missing_runtime_file",
            failureMessage: "Required runtime input is missing.",
          },
          dispatchContract: {
            status: "missing",
            failureCode: "missing_runtime_file",
            failureMessage: "Required runtime input is missing.",
          },
          installedPacks: {
            status: "missing",
            failureCode: "missing_runtime_file",
            failureMessage: "Required runtime input is missing.",
          },
        },
      }),
      error: null,
      isError: false,
      isLoading: false,
      threadId,
    });

    expect(state).toEqual({
      mode: "degraded",
      message: "Runtime files are missing.",
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
});
