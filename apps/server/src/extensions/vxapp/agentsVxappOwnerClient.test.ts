import { ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../processRunner.ts", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner.ts";
import {
  bootstrapAgentsVxappOwnerManifest,
  fetchAgentsVxappWorkerRuntimeSnapshot,
  requestAgentsVxappApprovalRequest,
  requestAgentsVxappApprovalResponse,
  requestAgentsVxappThreadEventIngest,
  requestAgentsVxappThreadStatus,
  requestAgentsVxappUserInputResponse,
  resetAgentsVxappOwnerManifestForTests,
} from "./agentsVxappOwnerClient.ts";

const mockedRunProcess = vi.mocked(runProcess);

function manifestPayload() {
  return {
    ownerCommandManifest: [
      { command: "owner-bootstrap", surface: "bootstrap_snapshot", implemented: true },
      { command: "owner-control", surface: "control_plane_snapshot", implemented: true },
      {
        command: "owner-programs-todos",
        surface: "programs_todos_snapshot",
        implemented: true,
      },
      { command: "owner-program-mutate", surface: "programs", implemented: true },
      { command: "owner-todo-mutate", surface: "todos", implemented: true },
      { command: "owner-agent-runtime", surface: "agent_runtime", implemented: true },
      { command: "owner-worker-runtime", surface: "worker_runtime", implemented: true },
      {
        command: "owner-role-paths",
        surface: "role_session_runtime_paths",
        implemented: true,
        tool: "role-session",
      },
      { command: "t3code-thread-status", surface: "threads", implemented: true },
      { command: "t3code-thread-event-ingest", surface: "threads", implemented: true },
      { command: "t3code-approval-request", surface: "approvals", implemented: true },
      { command: "t3code-approval-respond", surface: "approvals", implemented: true },
      { command: "t3code-user-input-respond", surface: "user_input", implemented: true },
    ],
  };
}

function envelope(command: string, surface: string, payload: unknown) {
  return {
    ok: true,
    contract_family: "agents-vxapp-t3code-authority",
    contract_version: "v1",
    command,
    result: {
      contractFamily: "agents-vxapp-t3code-authority",
      contractVersion: "v1",
      authorityStore: "owner",
      authoritySource: "owner",
      legacyFallbackUsed: false,
      surface,
      payload,
      display: {},
      options: {},
    },
  };
}

function processResult(stdout: unknown, code = 0) {
  return {
    stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
    stderr: code === 0 ? "" : "stderr detail",
    code,
    signal: null,
    timedOut: false,
  };
}

afterEach(() => {
  mockedRunProcess.mockReset();
  resetAgentsVxappOwnerManifestForTests();
});

describe("agentsVxappOwnerClient", () => {
  it("parses ownerCommandManifest arrays and keeps commands addressable by command name", async () => {
    mockedRunProcess.mockResolvedValueOnce(
      processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
    );

    const manifest = await bootstrapAgentsVxappOwnerManifest();

    expect([...manifest.commandsByName.keys()]).toEqual(
      expect.arrayContaining([
        "t3code-thread-status",
        "t3code-thread-event-ingest",
        "t3code-approval-request",
        "t3code-approval-respond",
        "t3code-user-input-respond",
      ]),
    );
    expect(manifest.commandsByName.get("t3code-thread-status")?.surface).toBe("threads");
    expect(manifest.commandsByName.get("t3code-thread-event-ingest")?.surface).toBe("threads");
  });

  it("bootstraps the manifest before later owner commands", async () => {
    mockedRunProcess
      .mockResolvedValueOnce(
        processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
      )
      .mockResolvedValueOnce(
        processResult(
          envelope("owner-worker-runtime", "worker_runtime", {
            threadId: "thread-worker",
            worktreePath: "/tmp/worktree",
            runtimeDir: "/tmp/worktree/.agents/runtime",
            sourceFiles: {
              contextPlan: {
                fileName: "context-plan.json",
                absolutePath: "/tmp/context-plan.json",
                status: "missing",
                detail: null,
              },
              dispatchContract: {
                fileName: "dispatch-contract.json",
                absolutePath: "/tmp/dispatch-contract.json",
                status: "missing",
                detail: null,
              },
              installedPacks: {
                fileName: "installed-packs.json",
                absolutePath: "/tmp/installed-packs.json",
                status: "missing",
                detail: null,
              },
              instructionStackAudit: {
                fileName: "instruction-stack-audit.json",
                absolutePath: "/tmp/instruction-stack-audit.json",
                status: "missing",
                detail: null,
              },
            },
            summary: {
              repo: null,
              taskClass: null,
              contextMode: null,
              closeoutAuthority: null,
              validationProfile: null,
              selectedPacks: [],
              allowedCapabilities: [],
              forbiddenCapabilities: [],
              conflicts: [],
              warnings: [],
              repoClaude: null,
              legacyGlobalSkills: null,
              workspace: "/tmp/worktree",
              runtimeDir: "/tmp/worktree/.agents/runtime",
              skillsDir: null,
              agentsSkillsDir: null,
              auditStatus: "missing",
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
          }),
        ),
      );

    await fetchAgentsVxappWorkerRuntimeSnapshot({ threadId: ThreadId.makeUnsafe("thread-worker") });

    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/t3-control-plane-owner$/),
      ["t3code-contract-manifest", "--json"],
      expect.objectContaining({ allowNonZeroExit: true }),
    );
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/t3-control-plane-owner$/),
      [
        "owner-worker-runtime",
        "--json",
        "--payload-json",
        expect.stringContaining("thread-worker"),
      ],
      expect.objectContaining({}),
    );
  });

  it("routes new authority helpers through the manifest-selected commands", async () => {
    mockedRunProcess
      .mockResolvedValueOnce(
        processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
      )
      .mockResolvedValueOnce(processResult(envelope("t3code-thread-status", "threads", {})))
      .mockResolvedValueOnce(processResult(envelope("t3code-thread-event-ingest", "threads", {})))
      .mockResolvedValueOnce(processResult(envelope("t3code-approval-request", "approvals", {})))
      .mockResolvedValueOnce(processResult(envelope("t3code-approval-respond", "approvals", {})))
      .mockResolvedValueOnce(
        processResult(envelope("t3code-user-input-respond", "user_input", {})),
      );

    await requestAgentsVxappThreadStatus({ threadId: "thread-1" });
    await requestAgentsVxappThreadEventIngest({
      threadId: "thread-1",
      eventType: "tool_user_input",
      state: "pending",
    });
    await requestAgentsVxappApprovalRequest({
      threadId: "thread-1",
      requestId: "req-approval",
    });
    await requestAgentsVxappApprovalResponse({
      threadId: "thread-1",
      requestId: "req-approval",
      decision: "accept",
    });
    await requestAgentsVxappUserInputResponse({
      threadId: "thread-1",
      requestId: "req-user-input",
      answers: {
        sandbox_mode: "workspace-write",
      },
    });

    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/t3-control-plane-owner$/),
      ["t3code-thread-status", "--json", "--thread", "thread-1"],
      expect.objectContaining({}),
    );
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/t3-control-plane-owner$/),
      [
        "t3code-thread-event-ingest",
        "--json",
        "--payload-json",
        expect.stringContaining('"eventType":"tool_user_input"'),
      ],
      expect.objectContaining({}),
    );
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      4,
      expect.stringMatching(/t3-control-plane-owner$/),
      [
        "t3code-approval-request",
        "--json",
        "--payload-json",
        expect.stringContaining('"requestId":"req-approval"'),
      ],
      expect.objectContaining({}),
    );
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      5,
      expect.stringMatching(/t3-control-plane-owner$/),
      [
        "t3code-approval-respond",
        "--json",
        "--payload-json",
        expect.stringContaining('"decision":"accept"'),
      ],
      expect.objectContaining({}),
    );
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      6,
      expect.stringMatching(/t3-control-plane-owner$/),
      [
        "t3code-user-input-respond",
        "--json",
        "--payload-json",
        expect.stringContaining('"sandbox_mode":"workspace-write"'),
      ],
      expect.objectContaining({}),
    );
  });

  it("rejects invalid manifests, command mismatches, legacy fallback, and failed owner commands", async () => {
    mockedRunProcess.mockResolvedValueOnce(processResult("{not-json"));
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      ownerCommand: "t3code-contract-manifest",
      authoritySurface: "contract_manifest",
      stdout: "{not-json",
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    mockedRunProcess.mockResolvedValueOnce(
      processResult({
        ok: false,
        contract_family: "agents-vxapp-t3code-authority",
        contract_version: "v1",
        command: "t3code-contract-manifest",
        error: { message: "owner refused" },
      }),
    );
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      message: "owner refused",
      ownerCommand: "t3code-contract-manifest",
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    const legacyResponse = envelope(
      "t3code-contract-manifest",
      "contract_manifest",
      manifestPayload(),
    );
    legacyResponse.result.legacyFallbackUsed = true as false;
    mockedRunProcess.mockResolvedValueOnce(processResult(legacyResponse));
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      message: expect.stringContaining("legacy fallback"),
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    mockedRunProcess.mockResolvedValueOnce(
      processResult(
        envelope("t3code-contract-manifest", "contract_manifest", {
          ownerCommandManifest: [
            { command: "t3code-thread-status", surface: "approvals", implemented: true },
          ],
        }),
      ),
    );
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      message: expect.stringContaining("must use surface 'threads'"),
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    mockedRunProcess.mockResolvedValueOnce(
      processResult(
        envelope("t3code-contract-manifest", "contract_manifest", {
          ownerCommandManifest: [
            { command: "t3code-thread-status", surface: "threads", implemented: true },
            { command: "t3code-thread-status", surface: "threads", implemented: true },
          ],
        }),
      ),
    );
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      message: expect.stringContaining("duplicate command"),
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    mockedRunProcess
      .mockResolvedValueOnce(
        processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
      )
      .mockResolvedValueOnce(
        processResult(
          {
            ok: true,
            contract_family: "agents-vxapp-t3code-authority",
            contract_version: "v1",
            command: "wrong-command",
            result: {
              contractFamily: "agents-vxapp-t3code-authority",
              contractVersion: "v1",
              authorityStore: "owner",
              authoritySource: "owner",
              legacyFallbackUsed: false,
              surface: "threads",
              payload: {},
              display: {},
              options: {},
            },
          },
          0,
        ),
      );
    await expect(requestAgentsVxappThreadStatus({ threadId: "thread-1" })).rejects.toMatchObject({
      message: expect.stringContaining("did not match"),
      ownerCommand: "t3code-thread-status",
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    mockedRunProcess
      .mockResolvedValueOnce(
        processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
      )
      .mockResolvedValueOnce(
        processResult(
          {
            ok: false,
            contract_family: "agents-vxapp-t3code-authority",
            contract_version: "v1",
            command: "t3code-approval-request",
            error: { message: "owner failure" },
          },
          1,
        ),
      );
    await expect(
      requestAgentsVxappApprovalRequest({ threadId: "thread-1", requestId: "req-owner-fail" }),
    ).rejects.toMatchObject({
      message: "owner failure",
      ownerCommand: "t3code-approval-request",
    });
  });
});
