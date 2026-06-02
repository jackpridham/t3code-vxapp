import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PerfContractError } from "./errorContract.ts";
import { parseYaml } from "./yaml.ts";

export type BudgetProbeId =
  | "t3.direct_thread_hard_refresh"
  | "agents.sidebar_authority_snapshot"
  | "agents.control_plane_snapshot"
  | "t3.live_turn_pipeline";

export interface BudgetRequest {
  method: string;
  input: Record<string, unknown>;
}

export interface PerformanceBudget {
  id: string;
  probe: BudgetProbeId;
  requiredArgs: readonly string[];
  request?: BudgetRequest;
  hard_forbidden_frames?: readonly string[];
  max_bootstrap_payload_bytes?: number;
  max_targeted_hydration_payload_bytes?: number;
  max_payload_bytes?: number;
  row_caps?: Record<string, number>;
  query_bounds?: Record<string, number>;
  max_subprocess_count?: number;
  warmups?: number;
  samples?: number;
  warm_p95_ms?: number;
  hard_ms?: number;
  pipeline_milestone_caps_ms?: Record<string, number>;
}

export interface PerformanceBudgetConfig {
  readonly schemaVersion: "1.0.0";
  readonly documentKind: "vx_performance_budgets";
  readonly repo: string;
  readonly budgets: Record<string, PerformanceBudget>;
}

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SUPPORTED_PROBES = new Set<BudgetProbeId>([
  "t3.direct_thread_hard_refresh",
  "agents.sidebar_authority_snapshot",
  "agents.control_plane_snapshot",
  "t3.live_turn_pipeline",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] | null {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    return null;
  }
  return value;
}

function readNumberRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, number> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", { field: key });
  }
  const output: Record<string, number> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "number" || !Number.isFinite(entryValue)) {
      throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
        field: `${key}.${entryKey}`,
      });
    }
    output[entryKey] = entryValue;
  }
  return output;
}

function readRequest(record: Record<string, unknown>, budgetId: string): BudgetRequest | undefined {
  const value = record.request;
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      budgetId,
      field: "request",
    });
  }
  const method = readString(value, "method");
  const input = value.input;
  if (method === null || !isRecord(input)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      budgetId,
      field: "request.method/input",
    });
  }
  return { method, input };
}

function requiresTimingFields(budget: PerformanceBudget): boolean {
  return (
    budget.warm_p95_ms !== undefined ||
    budget.hard_ms !== undefined ||
    budget.pipeline_milestone_caps_ms !== undefined
  );
}

function validateTimingFields(budget: PerformanceBudget) {
  if (!requiresTimingFields(budget)) {
    return;
  }
  if (budget.samples === undefined || budget.warmups === undefined) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      budgetId: budget.id,
      field: "samples/warmups",
    });
  }
}

function parseBudget(id: string, value: unknown): PerformanceBudget {
  if (!isRecord(value)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", { budgetId: id });
  }

  const probe = readString(value, "probe");
  const requiredArgs = readStringArray(value, "requiredArgs");
  if (probe === null || !SUPPORTED_PROBES.has(probe as BudgetProbeId) || requiredArgs === null) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      budgetId: id,
      field: "probe/requiredArgs",
    });
  }

  const budget: PerformanceBudget = { id, probe: probe as BudgetProbeId, requiredArgs };
  const request = readRequest(value, id);
  const hardForbiddenFrames = readStringArray(value, "hard_forbidden_frames");
  const rowCaps = readNumberRecord(value, "row_caps");
  const queryBounds = readNumberRecord(value, "query_bounds");
  const pipelineMilestoneCaps = readNumberRecord(value, "pipeline_milestone_caps_ms");
  const maxBootstrapPayloadBytes = readNumber(value, "max_bootstrap_payload_bytes");
  const maxTargetedHydrationPayloadBytes = readNumber(
    value,
    "max_targeted_hydration_payload_bytes",
  );
  const maxPayloadBytes = readNumber(value, "max_payload_bytes");
  const maxSubprocessCount = readNumber(value, "max_subprocess_count");
  const warmups = readNumber(value, "warmups");
  const samples = readNumber(value, "samples");
  const warmP95Ms = readNumber(value, "warm_p95_ms");
  const hardMs = readNumber(value, "hard_ms");
  if (request) budget.request = request;
  if (hardForbiddenFrames) budget.hard_forbidden_frames = hardForbiddenFrames;
  if (maxBootstrapPayloadBytes !== undefined)
    budget.max_bootstrap_payload_bytes = maxBootstrapPayloadBytes;
  if (maxTargetedHydrationPayloadBytes !== undefined) {
    budget.max_targeted_hydration_payload_bytes = maxTargetedHydrationPayloadBytes;
  }
  if (maxPayloadBytes !== undefined) budget.max_payload_bytes = maxPayloadBytes;
  if (rowCaps) budget.row_caps = rowCaps;
  if (queryBounds) budget.query_bounds = queryBounds;
  if (maxSubprocessCount !== undefined) budget.max_subprocess_count = maxSubprocessCount;
  if (warmups !== undefined) budget.warmups = warmups;
  if (samples !== undefined) budget.samples = samples;
  if (warmP95Ms !== undefined) budget.warm_p95_ms = warmP95Ms;
  if (hardMs !== undefined) budget.hard_ms = hardMs;
  if (pipelineMilestoneCaps) budget.pipeline_milestone_caps_ms = pipelineMilestoneCaps;

  validateTimingFields(budget);
  return budget;
}

export function loadPerformanceBudgetConfig(
  path = resolve(repoRoot, ".vx/performance-budgets.yaml"),
): PerformanceBudgetConfig {
  if (!existsSync(path)) {
    throw new PerfContractError("PERF_BUDGET_CONFIG_MISSING", { path });
  }

  const parsed = parseYaml(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", { path, field: "root" });
  }
  if (
    parsed.schemaVersion !== "1.0.0" ||
    parsed.documentKind !== "vx_performance_budgets" ||
    typeof parsed.repo !== "string" ||
    parsed.repo.length === 0 ||
    !isRecord(parsed.budgets)
  ) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      path,
      field: "schemaVersion/documentKind/repo/budgets",
    });
  }

  const budgets: Record<string, PerformanceBudget> = {};
  for (const [id, value] of Object.entries(parsed.budgets)) {
    budgets[id] = parseBudget(id, value);
  }

  return {
    schemaVersion: "1.0.0",
    documentKind: "vx_performance_budgets",
    repo: parsed.repo,
    budgets,
  };
}

export function getBudget(config: PerformanceBudgetConfig, budgetId: string): PerformanceBudget {
  const budget = config.budgets[budgetId];
  if (!budget) {
    throw new PerfContractError("PERF_BUDGET_UNKNOWN", { budgetId });
  }
  return budget;
}

export function assertProbeSupported(budget: PerformanceBudget, expected: BudgetProbeId) {
  if (budget.probe !== expected) {
    throw new PerfContractError("PERF_PROBE_UNSUPPORTED", {
      budgetId: budget.id,
      expected,
      actual: budget.probe,
    });
  }
}
