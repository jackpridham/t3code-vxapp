import { existsSync, readFileSync } from "node:fs";

import type { PerformanceBudget } from "./budgetConfig.ts";
import type { PerfErrorCode } from "./errorContract.ts";
import { PerfContractError } from "./errorContract.ts";
import {
  extractOutboundMethod,
  getPath,
  type BrowserWsFrame,
  type RpcExchange,
} from "./wsEvidence.ts";

export interface GateResult {
  readonly id: string;
  readonly status: "pass" | "fail";
  readonly code?: PerfErrorCode;
  readonly observed?: unknown;
  readonly limit?: unknown;
  readonly evidence?: Record<string, unknown>;
}

export function hasGateFailures(gates: readonly GateResult[]): boolean {
  return gates.some((gate) => gate.status === "fail");
}

export function firstFailedGateCode(gates: readonly GateResult[]): PerfErrorCode | null {
  return gates.find((gate) => gate.status === "fail")?.code ?? null;
}

export function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((rank / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function gateForbiddenRpc(
  budget: PerformanceBudget,
  frames: readonly BrowserWsFrame[],
): readonly GateResult[] {
  const forbidden = budget.hard_forbidden_frames ?? [];
  if (forbidden.length === 0) {
    return [];
  }
  const observed = frames.flatMap((frame) => {
    const method = extractOutboundMethod(frame);
    return method ? [method] : [];
  });
  return forbidden.map((method) => {
    const count = observed.filter((entry) => entry === method).length;
    return count === 0
      ? { id: `forbidden-rpc:${method}`, status: "pass" }
      : {
          id: `forbidden-rpc:${method}`,
          status: "fail",
          code: "PERF_GATE_FORBIDDEN_RPC",
          observed: count,
          limit: 0,
          evidence: { method },
        };
  });
}

export function gatePayloadBytes(budget: PerformanceBudget, exchanges: readonly RpcExchange[]) {
  const gates: GateResult[] = [];
  if (budget.max_payload_bytes !== undefined) {
    for (const exchange of exchanges) {
      const bytes = exchange.responseBytes ?? 0;
      gates.push(
        bytes <= budget.max_payload_bytes
          ? {
              id: `payload:${exchange.method}`,
              status: "pass",
              observed: bytes,
              limit: budget.max_payload_bytes,
            }
          : {
              id: `payload:${exchange.method}`,
              status: "fail",
              code: "PERF_GATE_PAYLOAD_BYTES",
              observed: bytes,
              limit: budget.max_payload_bytes,
              evidence: { method: exchange.method, id: exchange.id },
            },
      );
    }
  }
  if (budget.max_bootstrap_payload_bytes !== undefined) {
    for (const exchange of exchanges.filter(
      (entry) => entry.method === "orchestration.getBootstrapSummary",
    )) {
      const bytes = exchange.responseBytes ?? 0;
      gates.push(
        bytes <= budget.max_bootstrap_payload_bytes
          ? {
              id: "payload:bootstrap",
              status: "pass",
              observed: bytes,
              limit: budget.max_bootstrap_payload_bytes,
            }
          : {
              id: "payload:bootstrap",
              status: "fail",
              code: "PERF_GATE_PAYLOAD_BYTES",
              observed: bytes,
              limit: budget.max_bootstrap_payload_bytes,
              evidence: { method: exchange.method, id: exchange.id },
            },
      );
    }
  }
  if (budget.max_targeted_hydration_payload_bytes !== undefined) {
    const targeted = exchanges.filter(
      (entry) =>
        entry.method.startsWith("orchestration.") &&
        entry.method !== "orchestration.getBootstrapSummary",
    );
    for (const exchange of targeted) {
      const bytes = exchange.responseBytes ?? 0;
      gates.push(
        bytes <= budget.max_targeted_hydration_payload_bytes
          ? {
              id: `payload:targeted:${exchange.method}`,
              status: "pass",
              observed: bytes,
              limit: budget.max_targeted_hydration_payload_bytes,
            }
          : {
              id: `payload:targeted:${exchange.method}`,
              status: "fail",
              code: "PERF_GATE_PAYLOAD_BYTES",
              observed: bytes,
              limit: budget.max_targeted_hydration_payload_bytes,
              evidence: { method: exchange.method, id: exchange.id },
            },
      );
    }
  }
  return gates;
}

export function gateRowCaps(budget: PerformanceBudget, exchanges: readonly RpcExchange[]) {
  const caps = budget.row_caps ?? {};
  const gates: GateResult[] = [];
  for (const [capKey, limit] of Object.entries(caps)) {
    const matching = exchanges.filter((exchange) => capKey.startsWith(`${exchange.method}.`));
    if (matching.length === 0) {
      gates.push({ id: `row-cap:${capKey}`, status: "pass", observed: 0, limit });
      continue;
    }
    for (const exchange of matching) {
      const path = capKey.slice(exchange.method.length + 1);
      const value = getPath({ result: exchange.result }, path);
      const count = Array.isArray(value)
        ? value.length
        : value === undefined || value === null
          ? 0
          : 1;
      gates.push(
        count <= limit
          ? { id: `row-cap:${capKey}`, status: "pass", observed: count, limit }
          : {
              id: `row-cap:${capKey}`,
              status: "fail",
              code: "PERF_GATE_ROW_CAP",
              observed: count,
              limit,
              evidence: { method: exchange.method, path, id: exchange.id },
            },
      );
    }
  }
  return gates;
}

export function gateQueryBounds(budget: PerformanceBudget, exchanges: readonly RpcExchange[]) {
  const bounds = budget.query_bounds ?? {};
  const gates: GateResult[] = [];
  for (const [boundKey, limit] of Object.entries(bounds)) {
    const matching = exchanges.filter((exchange) => boundKey.startsWith(`${exchange.method}.`));
    if (matching.length === 0) {
      gates.push({ id: `query-bound:${boundKey}`, status: "pass", observed: null, limit });
      continue;
    }
    for (const exchange of matching) {
      const fieldPath = boundKey.slice(exchange.method.length + 1);
      const value = getPath(exchange.requestBody, fieldPath);
      const passed = typeof value === "number" && Number.isFinite(value) && value <= limit;
      gates.push(
        passed
          ? { id: `query-bound:${boundKey}`, status: "pass", observed: value, limit }
          : {
              id: `query-bound:${boundKey}`,
              status: "fail",
              code: "PERF_GATE_QUERY_BOUND",
              observed: value ?? null,
              limit,
              evidence: { method: exchange.method, fieldPath, id: exchange.id },
            },
      );
    }
  }
  return gates;
}

function countSubprocessTraceEntries(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.subprocesses)) {
        return record.subprocesses.length;
      }
      if (Array.isArray(record.processes)) {
        return record.processes.length;
      }
    }
  } catch {
    return trimmed
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .filter((line) => {
        try {
          const entry = JSON.parse(line) as unknown;
          return typeof entry === "object" && entry !== null;
        } catch {
          return false;
        }
      }).length;
  }
  return 0;
}

export function gateSubprocessCount(budget: PerformanceBudget): readonly GateResult[] {
  if (budget.max_subprocess_count === undefined) {
    return [];
  }
  const tracePath = process.env.T3_PERF_TRACE_PATH;
  if (!tracePath || !existsSync(tracePath)) {
    throw new PerfContractError("PERF_TRACE_REQUIRED_UNAVAILABLE", {
      budgetId: budget.id,
      env: "T3_PERF_TRACE_PATH",
      tracePath: tracePath ?? null,
    });
  }
  const observed = countSubprocessTraceEntries(readFileSync(tracePath, "utf8"));
  return [
    observed <= budget.max_subprocess_count
      ? {
          id: "subprocess-count",
          status: "pass",
          observed,
          limit: budget.max_subprocess_count,
          evidence: { tracePath },
        }
      : {
          id: "subprocess-count",
          status: "fail",
          code: "PERF_GATE_SUBPROCESS_COUNT",
          observed,
          limit: budget.max_subprocess_count,
          evidence: { tracePath },
        },
  ];
}

export function gateWallClock(budget: PerformanceBudget, sampleDurationsMs: readonly number[]) {
  const gates: GateResult[] = [];
  if (budget.hard_ms !== undefined) {
    const max = Math.max(...sampleDurationsMs, 0);
    gates.push(
      max <= budget.hard_ms
        ? { id: "wall-clock:hard-ms", status: "pass", observed: max, limit: budget.hard_ms }
        : {
            id: "wall-clock:hard-ms",
            status: "fail",
            code: "PERF_GATE_WALL_CLOCK",
            observed: max,
            limit: budget.hard_ms,
          },
    );
  }
  if (budget.warm_p95_ms !== undefined) {
    const observed = percentile(sampleDurationsMs, 95) ?? 0;
    gates.push(
      observed <= budget.warm_p95_ms
        ? { id: "wall-clock:warm-p95-ms", status: "pass", observed, limit: budget.warm_p95_ms }
        : {
            id: "wall-clock:warm-p95-ms",
            status: "fail",
            code: "PERF_GATE_WALL_CLOCK",
            observed,
            limit: budget.warm_p95_ms,
          },
    );
  }
  return gates;
}

export function gatePipelineMilestones(
  budget: PerformanceBudget,
  deltasMs: Record<string, number | null>,
) {
  const caps = budget.pipeline_milestone_caps_ms ?? {};
  return Object.entries(caps).map(([name, limit]): GateResult => {
    const observed = deltasMs[name];
    return typeof observed === "number" && observed <= limit
      ? { id: `pipeline:${name}`, status: "pass", observed, limit }
      : {
          id: `pipeline:${name}`,
          status: "fail",
          code: "PERF_GATE_PIPELINE_MILESTONE",
          observed: observed ?? null,
          limit,
        };
  });
}
