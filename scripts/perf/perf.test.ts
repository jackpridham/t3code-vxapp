import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getBudget, loadPerformanceBudgetConfig } from "./budgetConfig.ts";
import {
  loadPerfErrorContract,
  PerfContractError,
  REQUIRED_PERF_ERROR_CODES,
} from "./errorContract.ts";
import {
  gateForbiddenRpc,
  gatePayloadBytes,
  gatePipelineMilestones,
  gateQueryBounds,
  gateRowCaps,
  gateSubprocessCount,
  gateWallClock,
} from "./gates.ts";
import { analyzeLiveTurn } from "./playwrightTurnWatcher.ts";
import {
  makeRecorderInitScript,
  pairRpcExchanges,
  utf8ByteLength,
  type BrowserWsFrame,
} from "./wsEvidence.ts";

function frame(dir: "in" | "out", wallTime: number, value: unknown): BrowserWsFrame {
  const raw = JSON.stringify(value);
  return { dir, t: wallTime, wallTime, raw, byteLength: utf8ByteLength(raw) };
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "t3-perf-test-"));
}

describe("performance budget config", () => {
  it("loads all published budgets without defaulting timing fields", () => {
    const config = loadPerformanceBudgetConfig();
    expect(Object.keys(config.budgets).toSorted()).toEqual([
      "agents.control_plane_snapshot",
      "agents.sidebar_authority_snapshot",
      "t3.direct_thread_hard_refresh",
      "t3.live_turn_pipeline",
    ]);
    expect(getBudget(config, "t3.live_turn_pipeline").samples).toBe(1);
    expect(getBudget(config, "t3.live_turn_pipeline").warmups).toBe(0);
  });

  it("rejects timing budgets that omit samples and warmups", () => {
    const dir = tempDir();
    const path = join(dir, "performance-budgets.yaml");
    writeFileSync(
      path,
      `
schemaVersion: 1.0.0
documentKind: vx_performance_budgets
repo: t3
budgets:
  t3.direct_thread_hard_refresh:
    probe: t3.direct_thread_hard_refresh
    requiredArgs: [budget, base-url, thread-id, json]
    hard_ms: 10
`,
    );
    try {
      expect(() => loadPerformanceBudgetConfig(path)).toThrow(PerfContractError);
      try {
        loadPerformanceBudgetConfig(path);
      } catch (error) {
        expect(error).toBeInstanceOf(PerfContractError);
        expect((error as PerfContractError).code).toBe("PERF_BUDGET_REQUIRED_FIELD_MISSING");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("performance error contract", () => {
  it("defines every required code with an exit code", () => {
    const contract = loadPerfErrorContract();
    for (const code of REQUIRED_PERF_ERROR_CODES) {
      expect(contract.errors[code]).toMatchObject({ severity: "error" });
      expect([2, 3]).toContain(contract.errors[code].exitCode);
    }
  });
});

describe("deterministic gates", () => {
  it("fails forbidden outbound RPC frames", () => {
    const gates = gateForbiddenRpc(
      {
        id: "budget",
        probe: "t3.direct_thread_hard_refresh",
        requiredArgs: [],
        hard_forbidden_frames: ["orchestration.getCurrentState"],
      },
      [
        frame("out", 1, {
          id: "1",
          body: { _tag: "orchestration.getCurrentState" },
        }),
      ],
    );
    expect(gates[0]).toMatchObject({
      status: "fail",
      code: "PERF_GATE_FORBIDDEN_RPC",
      observed: 1,
    });
  });

  it("checks payload bytes, row caps, query bounds, and wall-clock limits", () => {
    const frames = [
      frame("out", 1, {
        id: "1",
        body: { _tag: "orchestration.listThreadMessages", limit: 50 },
      }),
      frame("in", 2, {
        id: "1",
        result: Array.from({ length: 3 }, (_, index) => ({ id: `message-${index}` })),
      }),
    ];
    const exchanges = pairRpcExchanges(frames);
    const budget = {
      id: "budget",
      probe: "t3.direct_thread_hard_refresh" as const,
      requiredArgs: [],
      max_payload_bytes: 20,
      row_caps: { "orchestration.listThreadMessages.result": 2 },
      query_bounds: { "orchestration.listThreadMessages.limit": 20 },
      hard_ms: 10,
    };

    expect(gatePayloadBytes(budget, exchanges)[0]).toMatchObject({
      status: "fail",
      code: "PERF_GATE_PAYLOAD_BYTES",
    });
    expect(gateRowCaps(budget, exchanges)[0]).toMatchObject({
      status: "fail",
      code: "PERF_GATE_ROW_CAP",
      observed: 3,
    });
    expect(gateQueryBounds(budget, exchanges)[0]).toMatchObject({
      status: "fail",
      code: "PERF_GATE_QUERY_BOUND",
      observed: 50,
    });
    expect(gateWallClock(budget, [11])[0]).toMatchObject({
      status: "fail",
      code: "PERF_GATE_WALL_CLOCK",
    });
  });

  it("requires and evaluates subprocess traces", () => {
    const previousTracePath = process.env.T3_PERF_TRACE_PATH;
    const dir = tempDir();
    const tracePath = join(dir, "trace.json");
    const budget = {
      id: "budget",
      probe: "agents.sidebar_authority_snapshot" as const,
      requiredArgs: [],
      max_subprocess_count: 1,
    };
    try {
      delete process.env.T3_PERF_TRACE_PATH;
      expect(() => gateSubprocessCount(budget)).toThrow(PerfContractError);
      writeFileSync(tracePath, JSON.stringify({ subprocesses: [{ id: 1 }, { id: 2 }] }));
      process.env.T3_PERF_TRACE_PATH = tracePath;
      expect(gateSubprocessCount(budget)[0]).toMatchObject({
        status: "fail",
        code: "PERF_GATE_SUBPROCESS_COUNT",
        observed: 2,
      });
    } finally {
      if (previousTracePath === undefined) {
        delete process.env.T3_PERF_TRACE_PATH;
      } else {
        process.env.T3_PERF_TRACE_PATH = previousTracePath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails live pipeline milestone caps", () => {
    expect(
      gatePipelineMilestones(
        {
          id: "budget",
          probe: "t3.live_turn_pipeline",
          requiredArgs: [],
          pipeline_milestone_caps_ms: { submit_to_ack: 10 },
        },
        { submit_to_ack: 11 },
      )[0],
    ).toMatchObject({ status: "fail", code: "PERF_GATE_PIPELINE_MILESTONE" });
  });
});

describe("live turn watcher correlation", () => {
  it("correlates a recorded dispatch through settled turn milestones", () => {
    const threadId = "thread-1";
    const commandId = "command-1";
    const messageId = "message-1";
    const turnId = "turn-1";
    const frames = [
      frame("out", 1000, {
        id: "1",
        body: {
          _tag: "orchestration.dispatchCommand",
          command: {
            type: "thread.turn.start",
            commandId,
            threadId,
            message: { messageId, role: "user", text: "abc123", attachments: [] },
          },
        },
      }),
      frame("in", 1100, { id: "1", result: { sequence: 10 } }),
      domainFrame(1120, commandId, threadId, "thread.message-sent", {
        threadId,
        messageId,
        role: "user",
        text: "abc123",
        streaming: false,
        turnId: null,
      }),
      domainFrame(1130, commandId, threadId, "thread.turn-start-requested", {
        threadId,
        messageId,
      }),
      domainFrame(1200, commandId, threadId, "thread.session-set", {
        threadId,
        session: { threadId, status: "running", activeTurnId: turnId },
      }),
      domainFrame(1300, commandId, threadId, "thread.activity-appended", {
        threadId,
        activity: { turnId },
      }),
      domainFrame(1800, commandId, threadId, "thread.message-sent", {
        threadId,
        messageId: "assistant-1",
        role: "assistant",
        text: "done",
        streaming: false,
        turnId,
      }),
      domainFrame(1900, commandId, threadId, "thread.session-set", {
        threadId,
        session: { threadId, status: "ready", activeTurnId: null },
      }),
    ];

    const result = analyzeLiveTurn({ frames, threadId, browserSubmit: 990 });
    expect(result?.correlation).toEqual({ commandId, messageId, turnId });
    expect(result?.deltasMs).toMatchObject({
      submit_to_ack: 110,
      turn_start_requested_to_running: 70,
      running_to_first_thinking: 100,
      final_to_settled: 100,
      total_turn_duration: 910,
    });
  });
});

describe("recorder and selector smoke checks", () => {
  it("publishes the websocket recorder before app boot", () => {
    const script = makeRecorderInitScript();
    expect(script).toContain("__t3PerfWsLog");
    expect(script).toContain("window.WebSocket");
  });

  it("keeps live watcher selectors present in source", () => {
    const composerSource = readFileSync(
      "../apps/web/src/components/ComposerPromptEditor.tsx",
      "utf8",
    );
    const chatSource = readFileSync("../apps/web/src/components/ChatView.tsx", "utf8");
    expect(composerSource).toContain('data-testid="composer-editor"');
    expect(chatSource).toContain('data-chat-composer-form="true"');
  });
});

function domainFrame(
  wallTime: number,
  commandId: string,
  threadId: string,
  type: string,
  payload: Record<string, unknown>,
): BrowserWsFrame {
  return frame("in", wallTime, {
    type: "push",
    sequence: wallTime,
    channel: "orchestration.domainEvent",
    data: {
      sequence: wallTime,
      eventId: `event-${wallTime}`,
      aggregateKind: "thread",
      aggregateId: threadId,
      commandId,
      causationEventId: null,
      correlationId: commandId,
      occurredAt: new Date(wallTime).toISOString(),
      metadata: {},
      type,
      payload,
    },
  });
}
