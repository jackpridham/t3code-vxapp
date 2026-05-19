import { ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../processRunner.ts", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner.ts";
import {
  bootstrapAgentsVxappOwnerManifest,
  fetchAgentsVxappSidebarGraphSnapshot,
  fetchAgentsVxappWorkerRuntimeSnapshot,
  fetchAgentsVxappRoleSessionRuntimePaths,
  requestAgentsVxappApprovalRequest,
  requestAgentsVxappApprovalResponse,
  requestAgentsVxappProjectEventIngest,
  requestAgentsVxappThreadEventIngest,
  requestAgentsVxappThreadStatus,
  requestAgentsVxappUserInputResponse,
  resetAgentsVxappOwnerManifestForTests,
} from "./agentsVxappOwnerClient.ts";

const mockedRunProcess = vi.mocked(runProcess);

const FULL_MANIFEST_ROWS = `
t3code-contract-manifest	contract_manifest
t3code-bootstrap-snapshot	bootstrap_snapshot
t3code-control-plane-snapshot	control_plane_snapshot
t3code-programs-todos-snapshot	programs_todos_snapshot
t3code-sidebar-graph-snapshot	sidebar_graph_snapshot
t3code-cto-status	cto
t3code-cto-ensure	cto
t3code-cto-request-orchestration	cto
t3code-cto-attention-list	cto
t3code-cto-attention-lifecycle	cto
t3code-cto-notifications-list	cto
t3code-cto-notification-lifecycle	cto
t3code-cto-validate-first-task	cto
t3code-cto-operate-status	cto_operate
t3code-cto-operate-once	cto_operate
t3code-cto-operate-schedule	cto_operate
t3code-cto-operate-action-result	cto_operate
t3code-cto-yacht-watch-status	cto_yacht_watch
t3code-cto-yacht-watch-inspect	cto_yacht_watch
t3code-cto-yacht-watch-enable	cto_yacht_watch
t3code-cto-yacht-watch-disable	cto_yacht_watch
t3code-cto-yacht-watch-periodic-check	cto_yacht_watch
programs-selection	program_selection
programs-autocontinue-context	program_autocontinue_context
programs-todo-view	program_todo_view
programs-runtime-view	program_runtime_view
t3code-program-mutate	programs
t3code-todo-mutate	todos
t3code-notification-mutate	notifications
t3code-attention-mutate	attention
t3code-wake-mutate	wakes
t3code-program-notifications-snapshot	program_residuals
t3code-program-attention-snapshot	program_residuals
t3code-program-runtime-allocations	program_residuals
t3code-program-role-session-context	program_residuals
t3code-program-autocontinue-run	program_residuals
t3code-program-autocontinue-all-run	program_residuals
programs-review-refresh	program_review_refresh
t3code-thread-status	threads
t3code-thread-event-ingest	threads
t3code-threads-list	threads
t3code-threads-current	threads
t3code-threads-watch	threads
t3code-threads-create	threads
t3code-threads-start	threads
t3code-threads-interrupt	threads
t3code-threads-stop	threads
t3code-threads-revert	threads
t3code-threads-archive	threads
t3code-threads-delete	threads
t3code-threads-lineage-update	threads
t3code-threads-evidence-links	threads
t3code-threads-diff-request	threads
t3code-approval-request	approvals
t3code-approval-respond	approvals
t3code-user-input-respond	user_input
t3code-projects-event-ingest	projects
t3code-projects-list	projects
t3code-projects-inspect	projects
t3code-projects-resolve	projects
t3code-projects-ensure	projects
t3code-projects-create	projects
t3code-projects-update	projects
t3code-projects-delete	projects
t3code-projects-alias	projects
t3code-agent-runtime-snapshot	agent_runtime
t3code-worker-runtime-snapshot	worker_runtime
t3code-worker-context-plan	workers
t3code-worker-context-audit	workers
t3code-worker-prepare-context	workers
t3code-worker-prompt	workers
t3code-worker-model-selection	workers
t3code-worker-dispatch	workers
t3code-worker-continue	workers
t3code-worker-doctor	workers
t3code-worker-recover	workers
t3code-supervision-snapshot	supervision
t3code-supervision-recheck	supervision
t3code-supervision-recover	supervision
t3code-rate-limit-classify	supervision
t3code-stall-detect	supervision
t3code-model-tracker-status	supervision
t3code-model-tracker-record	supervision
t3code-provider-snapshot-request	provider_transport
t3code-provider-events-request	provider_transport
t3code-provider-ws-request	provider_transport
t3code-provider-git-request	provider_transport
t3code-provider-workspace-request	provider_transport
t3code-orchestrator-status	orchestrator_dashboard
t3code-orchestrator-branch-status	orchestrator_dashboard
t3code-workspace-sync-status	workspace_sync
t3code-workspace-sync-next-actions	workspace_sync
t3code-agent-thread-context	agent_utilities
t3code-artifact-linkage-validate	agent_utilities
t3code-plan-linkage-validate	agent_utilities
t3code-knowledge-thread-export-request	agent_utilities
t3code-legacy-agent-retired	agent_utilities
t3code-worker-prompt-template	prompt_templates
t3code-provider-model-resolve	provider_model
`.trim();

function manifestPayload() {
  const ownerCommandManifest = FULL_MANIFEST_ROWS.split("\n").map((line) => {
    const [command = "", surface = ""] = line.split("\t");
    return { command, surface, implemented: true };
  });
  return {
    ownerCommandManifest,
    callerContractManifest: ownerCommandManifest.map(({ command, surface }) => ({
      command,
      surface,
      toolFamily: "control-plane",
      wrapperKey: command.replace(/^t3code-/, "").replaceAll("-", "_"),
    })),
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
  it("parses owner and caller contract manifest arrays and keeps commands addressable by name", async () => {
    mockedRunProcess.mockResolvedValueOnce(
      processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
    );

    const manifest = await bootstrapAgentsVxappOwnerManifest();

    expect([...manifest.commandsByName.keys()]).toEqual(
      expect.arrayContaining([
        "t3code-contract-manifest",
        "t3code-cto-status",
        "t3code-projects-list",
        "t3code-sidebar-graph-snapshot",
        "t3code-worker-dispatch",
        "t3code-provider-ws-request",
        "t3code-orchestrator-status",
        "t3code-thread-status",
        "t3code-thread-event-ingest",
        "t3code-approval-request",
        "t3code-approval-respond",
        "t3code-user-input-respond",
      ]),
    );
    expect(manifest.commandsByName.get("t3code-thread-status")?.surface).toBe("threads");
    expect(manifest.commandsByName.get("t3code-thread-event-ingest")?.surface).toBe("threads");
    expect(manifest.commandsByName.get("t3code-sidebar-graph-snapshot")?.surface).toBe(
      "sidebar_graph_snapshot",
    );
    expect(manifest.commandsByName.get("t3code-contract-manifest")?.surface).toBe(
      "contract_manifest",
    );
    expect(manifest.commandsByName.get("t3code-worker-dispatch")?.surface).toBe("workers");
  });

  it("bootstraps the manifest before later owner commands", async () => {
    mockedRunProcess
      .mockResolvedValueOnce(
        processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
      )
      .mockResolvedValueOnce(
        processResult(
          envelope("t3code-worker-runtime-snapshot", "worker_runtime", {
            threadId: "thread-worker",
            runtimeKind: "worker-contract",
            agentKind: "worker",
            workspace: "/tmp/worktree",
            availability: "inspectable",
            reasonCode: null,
            runtimeDir: "/tmp/worktree/.agents/runtime",
            runtimeRoot: "/tmp/worktree/.agents",
            stateRoot: "/tmp/worktree",
            workspaceResolution: "thread-worktree",
            sourceFiles: {
              contextPlan: {
                status: "missing",
                failureCode: null,
                failureMessage: null,
              },
              dispatchContract: {
                status: "missing",
                failureCode: null,
                failureMessage: null,
              },
              installedPacks: {
                status: "missing",
                failureCode: null,
                failureMessage: null,
              },
            },
            audit: {
              schema_version: "1.0.0",
              repo: "",
              taskClass: "",
              contextMode: "",
              closeoutAuthority: "",
              workspace: "/tmp/worktree",
              runtimeDir: "/tmp/worktree/.agents/runtime",
              skillsDir: null,
              agentsSkillsDir: null,
              instructionStackStatus: "error",
              packAuditStatus: "error",
              status: "warning",
              issues: [],
            },
            contextPlan: null,
            dispatchContract: null,
            installedPacks: null,
            instructionStack: {
              schema_version: "1.0.0",
              repo: "",
              taskClass: "",
              contextMode: "",
              closeoutAuthority: "",
              workspace: "/tmp/worktree",
              status: "error",
              findings: [],
              packAudit: {},
            },
            findings: [],
            issues: [],
          }),
        ),
      );

    await fetchAgentsVxappWorkerRuntimeSnapshot({
      threadId: ThreadId.makeUnsafe("thread-worker"),
      workspace: "/tmp/worktree",
    });

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
        "t3code-worker-runtime-snapshot",
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
      .mockResolvedValueOnce(
        processResult(envelope("t3code-projects-event-ingest", "projects", {})),
      )
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
    await requestAgentsVxappProjectEventIngest({
      projectId: "project-1",
      action: "create",
      createdAt: "2026-05-18T00:00:00Z",
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
        "t3code-projects-event-ingest",
        "--json",
        "--payload-json",
        expect.stringContaining('"projectId":"project-1"'),
      ],
      expect.objectContaining({}),
    );
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      5,
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
      6,
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
      7,
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

  it("routes the sidebar graph helper through the dedicated startup-safe owner command", async () => {
    mockedRunProcess
      .mockResolvedValueOnce(
        processResult(envelope("t3code-contract-manifest", "contract_manifest", manifestPayload())),
      )
      .mockResolvedValueOnce(
        processResult(
          envelope("t3code-sidebar-graph-snapshot", "sidebar_graph_snapshot", {
            source: "sqlite",
            dbPath: "/tmp/vx_agents.sqlite3",
            fallbackReason: null,
            threadLinks: [],
            openWakes: [],
            watchProjections: [],
            notifications: [],
            attentionItems: [],
          }),
        ),
      );

    await fetchAgentsVxappSidebarGraphSnapshot();

    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/t3-control-plane-owner$/),
      ["t3code-sidebar-graph-snapshot", "--json"],
      expect.objectContaining({}),
    );
  });

  it("keeps role-session runtime paths on the separate role-session owner surface", async () => {
    mockedRunProcess.mockResolvedValueOnce(
      processResult({
        ok: true,
        command: "runtime-paths",
        contract_family: "role-session",
        contract_version: "v1",
        result: {
          runtimeRoot: "/runtime",
          roleSessionsRoot: "/runtime/role-sessions",
        },
      }),
    );

    const payload = await fetchAgentsVxappRoleSessionRuntimePaths<Record<string, unknown>>();

    expect(payload).toMatchObject({
      runtimeRoot: "/runtime",
      roleSessionsRoot: "/runtime/role-sessions",
    });
    expect(mockedRunProcess).toHaveBeenCalledWith(
      expect.stringMatching(/role-session-owner$/),
      ["runtime-paths"],
      expect.objectContaining({ allowNonZeroExit: true }),
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
      processResult({
        ok: true,
        contract_family: "agents-vxapp-t3code-authority",
        contract_version: "v1",
        command: "t3code-contract-manifest",
        result: {
          contractFamily: "agents-vxapp-t3code-authority",
          contractVersion: "v1",
          authorityStore: "owner-store",
          authoritySource: "owner-source",
          legacyFallbackUsed: false,
          surface: "contract_manifest",
          payload: {
            commands: {
              "t3code-thread-status": {
                command: "t3code-thread-status",
                surface: "threads",
                implemented: true,
              },
            },
          },
        },
      }),
    );
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      message: "Owner manifest must provide ownerCommandManifest[].",
      authorityStore: "owner-store",
      authoritySource: "owner-source",
      contractFamily: "agents-vxapp-t3code-authority",
      contractVersion: "v1",
    });

    resetAgentsVxappOwnerManifestForTests();
    mockedRunProcess.mockReset();
    mockedRunProcess.mockResolvedValueOnce(
      processResult(
        envelope("t3code-contract-manifest", "contract_manifest", {
          ...manifestPayload(),
          callerContractManifest: manifestPayload().callerContractManifest.map((entry) => {
            if (entry.command !== "t3code-thread-status") {
              return entry;
            }
            return Object.assign({}, entry, { surface: "approvals" });
          }),
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
          ...manifestPayload(),
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
    mockedRunProcess.mockResolvedValueOnce(
      processResult(
        envelope("t3code-contract-manifest", "contract_manifest", {
          ...manifestPayload(),
          ownerCommandManifest: manifestPayload().ownerCommandManifest.map((entry) =>
            entry.command === "t3code-thread-status"
              ? { command: entry.command, surface: "threads" }
              : entry,
          ),
        }),
      ),
    );
    await expect(bootstrapAgentsVxappOwnerManifest()).rejects.toMatchObject({
      message: expect.stringContaining("invalid ownerCommandManifest entry"),
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
      ownerCommand: "wrong-command",
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
      ownerErrorCode: null,
    });
  });
});
