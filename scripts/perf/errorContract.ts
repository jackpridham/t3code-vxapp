import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./yaml.ts";

export const REQUIRED_PERF_ERROR_CODES = [
  "PERF_BUDGET_CONFIG_MISSING",
  "PERF_BUDGET_UNKNOWN",
  "PERF_BUDGET_REQUIRED_FIELD_MISSING",
  "PERF_PROBE_REQUIRED_ARG_MISSING",
  "PERF_PROBE_UNSUPPORTED",
  "PERF_PROBE_TARGET_UNAVAILABLE",
  "PERF_TRACE_REQUIRED_UNAVAILABLE",
  "PERF_WATCHER_CORRELATION_LOST",
  "PERF_WATCHER_MILESTONE_MISSING",
  "PERF_GATE_FORBIDDEN_RPC",
  "PERF_GATE_PAYLOAD_BYTES",
  "PERF_GATE_ROW_CAP",
  "PERF_GATE_QUERY_BOUND",
  "PERF_GATE_SUBPROCESS_COUNT",
  "PERF_GATE_WALL_CLOCK",
  "PERF_GATE_PIPELINE_MILESTONE",
] as const;

export type PerfErrorCode = (typeof REQUIRED_PERF_ERROR_CODES)[number];

export interface PerfErrorDefinition {
  readonly message: string;
  readonly severity: "error";
  readonly exitCode: 2 | 3;
}

export interface PerfErrorContract {
  readonly schemaVersion: string;
  readonly documentKind: "vx_performance_error_contract";
  readonly contractVersion: string;
  readonly exitCodes: {
    readonly pass: 0;
    readonly contract: 2;
    readonly gate_failure: 3;
  };
  readonly errors: Record<PerfErrorCode, PerfErrorDefinition>;
}

export class PerfContractError extends Error {
  readonly code: PerfErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: PerfErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "PerfContractError";
    this.code = code;
    this.details = details;
  }
}

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readExitCode(value: unknown): 2 | 3 | null {
  return value === 2 || value === 3 ? value : null;
}

export function loadPerfErrorContract(
  path = resolve(repoRoot, ".vx/performance-error-contract.yaml"),
): PerfErrorContract {
  if (!existsSync(path)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      path,
      field: "performance-error-contract",
    });
  }

  const parsed = parseYaml(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", { path, field: "root" });
  }

  const schemaVersion = readString(parsed, "schemaVersion");
  const documentKind = readString(parsed, "documentKind");
  const contractVersion = readString(parsed, "contractVersion");
  const exitCodes = parsed.exitCodes;
  const errors = parsed.errors;
  if (
    schemaVersion !== "1.0.0" ||
    documentKind !== "vx_performance_error_contract" ||
    contractVersion === null ||
    !isRecord(exitCodes) ||
    exitCodes.pass !== 0 ||
    exitCodes.contract !== 2 ||
    exitCodes.gate_failure !== 3 ||
    !isRecord(errors)
  ) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      path,
      field: "schemaVersion/documentKind/contractVersion/exitCodes/errors",
    });
  }

  const normalizedErrors: Partial<Record<PerfErrorCode, PerfErrorDefinition>> = {};
  for (const code of REQUIRED_PERF_ERROR_CODES) {
    const definition = errors[code];
    if (!isRecord(definition)) {
      throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
        path,
        field: `errors.${code}`,
      });
    }
    const message = readString(definition, "message");
    const severity = definition.severity;
    const exitCode = readExitCode(definition.exitCode);
    if (message === null || severity !== "error" || exitCode === null) {
      throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
        path,
        field: `errors.${code}.message/severity/exitCode`,
      });
    }
    normalizedErrors[code] = { message, severity, exitCode };
  }

  return {
    schemaVersion,
    documentKind,
    contractVersion,
    exitCodes: {
      pass: 0,
      contract: 2,
      gate_failure: 3,
    },
    errors: normalizedErrors as Record<PerfErrorCode, PerfErrorDefinition>,
  };
}

export function assertKnownPerfErrorCode(
  contract: PerfErrorContract,
  code: string,
): asserts code is PerfErrorCode {
  if (!Object.hasOwn(contract.errors, code)) {
    throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
      field: `errors.${code}`,
    });
  }
}

export function resolvePerfExitCode(contract: PerfErrorContract, code: PerfErrorCode): 2 | 3 {
  return contract.errors[code].exitCode;
}
