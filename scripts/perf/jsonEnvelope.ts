import type { PerformanceBudget } from "./budgetConfig.ts";
import type { GateResult } from "./gates.ts";
import type { PerfErrorCode, PerfErrorContract } from "./errorContract.ts";

export type PerfEnvelopeStatus = "pass" | "fail" | "error";

export interface PerfEnvelope {
  readonly schemaVersion: "1.0.0";
  readonly contractVersion: string;
  readonly repo: string;
  readonly budgetId: string | null;
  readonly status: PerfEnvelopeStatus;
  readonly metrics: Record<string, unknown>;
  readonly gates: readonly GateResult[];
  readonly evidence: Record<string, unknown>;
  readonly error?: {
    readonly code: PerfErrorCode;
    readonly message: string;
    readonly severity: "error";
    readonly details: Record<string, unknown>;
  };
}

export function makePerfEnvelope(input: {
  readonly contract: PerfErrorContract;
  readonly repo: string;
  readonly budget?: PerformanceBudget;
  readonly budgetId?: string | null;
  readonly status: PerfEnvelopeStatus;
  readonly metrics?: Record<string, unknown>;
  readonly gates?: readonly GateResult[];
  readonly evidence?: Record<string, unknown>;
  readonly error?: {
    readonly code: PerfErrorCode;
    readonly details?: Record<string, unknown>;
  };
}): PerfEnvelope {
  const errorDefinition = input.error ? input.contract.errors[input.error.code] : undefined;
  return {
    schemaVersion: "1.0.0",
    contractVersion: input.contract.contractVersion,
    repo: input.repo,
    budgetId: input.budget?.id ?? input.budgetId ?? null,
    status: input.status,
    metrics: input.metrics ?? {},
    gates: input.gates ?? [],
    evidence: input.evidence ?? {},
    ...(input.error && errorDefinition
      ? {
          error: {
            code: input.error.code,
            message: errorDefinition.message,
            severity: errorDefinition.severity,
            details: input.error.details ?? {},
          },
        }
      : {}),
  };
}

export function writeJsonEnvelope(envelope: PerfEnvelope) {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}
