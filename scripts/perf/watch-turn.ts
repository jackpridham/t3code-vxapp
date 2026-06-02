import { loadPerformanceBudgetConfig, getBudget, assertProbeSupported } from "./budgetConfig.ts";
import { PerfContractError, loadPerfErrorContract, resolvePerfExitCode } from "./errorContract.ts";
import {
  firstFailedGateCode,
  gateForbiddenRpc,
  gatePayloadBytes,
  gatePipelineMilestones,
  gateQueryBounds,
  gateRowCaps,
  gateSubprocessCount,
  gateWallClock,
  hasGateFailures,
} from "./gates.ts";
import { makePerfEnvelope, writeJsonEnvelope } from "./jsonEnvelope.ts";
import { watchLiveTurnPipeline } from "./playwrightTurnWatcher.ts";
import { summarizeExchanges } from "./wsEvidence.ts";

interface CliArgs {
  readonly budget?: string;
  readonly baseUrl?: string;
  readonly threadId?: string;
  readonly message?: string;
  readonly json?: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const output: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    if (key === "json") {
      output.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      continue;
    }
    output[key] = value;
    index += 1;
  }
  return {
    ...(typeof output.budget === "string" ? { budget: output.budget } : {}),
    ...(typeof output["base-url"] === "string" ? { baseUrl: output["base-url"] } : {}),
    ...(typeof output["thread-id"] === "string" ? { threadId: output["thread-id"] } : {}),
    ...(typeof output.message === "string" ? { message: output.message } : {}),
    ...(output.json === true ? { json: true } : {}),
  };
}

function assertRequiredArgs(args: CliArgs, requiredArgs: readonly string[]) {
  const values: Record<string, unknown> = {
    budget: args.budget,
    "base-url": args.baseUrl,
    "thread-id": args.threadId,
    message: args.message,
    json: args.json,
  };
  for (const arg of requiredArgs) {
    const value = values[arg];
    if (
      value === undefined ||
      value === null ||
      value === false ||
      (typeof value === "string" && value.length === 0)
    ) {
      throw new PerfContractError("PERF_PROBE_REQUIRED_ARG_MISSING", { arg });
    }
  }
}

async function main() {
  const contract = loadPerfErrorContract();
  const args = parseArgs(process.argv.slice(2));
  let budgetId = args.budget ?? null;
  try {
    if (!args.budget) {
      throw new PerfContractError("PERF_PROBE_REQUIRED_ARG_MISSING", { arg: "budget" });
    }
    const config = loadPerformanceBudgetConfig();
    const budget = getBudget(config, args.budget);
    budgetId = budget.id;
    assertProbeSupported(budget, "t3.live_turn_pipeline");
    assertRequiredArgs(args, budget.requiredArgs);
    if (!args.baseUrl || !args.threadId || !args.message) {
      throw new PerfContractError("PERF_PROBE_REQUIRED_ARG_MISSING", {
        arg: "base-url/thread-id/message",
      });
    }

    const startedAt = Date.now();
    const result = await watchLiveTurnPipeline({
      budget,
      baseUrl: args.baseUrl,
      threadId: args.threadId,
      message: args.message,
    });
    const durationMs = Date.now() - startedAt;
    const gates = [
      ...gateForbiddenRpc(budget, result.frames),
      ...gatePayloadBytes(budget, result.exchanges),
      ...gateRowCaps(budget, result.exchanges),
      ...gateQueryBounds(budget, result.exchanges),
      ...gateSubprocessCount(budget),
      ...gateWallClock(budget, [durationMs]),
      ...gatePipelineMilestones(budget, result.deltasMs),
    ];
    const status = hasGateFailures(gates) ? "fail" : "pass";
    writeJsonEnvelope(
      makePerfEnvelope({
        contract,
        repo: config.repo,
        budget,
        status,
        metrics: {
          durationMs,
          milestones: result.milestones,
          deltasMs: result.deltasMs,
        },
        gates,
        evidence: {
          correlation: result.correlation,
          exchanges: summarizeExchanges(result.exchanges),
        },
        ...(status === "fail"
          ? {
              error: {
                code: firstFailedGateCode(gates) ?? "PERF_GATE_PIPELINE_MILESTONE",
                details: { failedGates: gates.filter((gate) => gate.status === "fail") },
              },
            }
          : {}),
      }),
    );
    process.exitCode =
      status === "pass" ? contract.exitCodes.pass : contract.exitCodes.gate_failure;
  } catch (error) {
    const perfError =
      error instanceof PerfContractError
        ? error
        : new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", {
            message: error instanceof Error ? error.message : String(error),
          });
    writeJsonEnvelope(
      makePerfEnvelope({
        contract,
        repo: "t3",
        budgetId,
        status: "error",
        error: { code: perfError.code, details: perfError.details },
      }),
    );
    process.exitCode = resolvePerfExitCode(contract, perfError.code);
  }
}

await main();
