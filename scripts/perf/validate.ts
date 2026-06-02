import { loadPerformanceBudgetConfig, getBudget, assertProbeSupported } from "./budgetConfig.ts";
import { PerfContractError, loadPerfErrorContract, resolvePerfExitCode } from "./errorContract.ts";
import {
  firstFailedGateCode,
  gateForbiddenRpc,
  gatePayloadBytes,
  gateQueryBounds,
  gateRowCaps,
  gateSubprocessCount,
  gateWallClock,
  hasGateFailures,
  type GateResult,
} from "./gates.ts";
import { makePerfEnvelope, writeJsonEnvelope } from "./jsonEnvelope.ts";
import { collectHardRefreshSamples } from "./playwrightTurnWatcher.ts";
import {
  normalizeBrowserWsFrames,
  pairRpcExchanges,
  summarizeExchanges,
  utf8ByteLength,
  type BrowserWsFrame,
  type RpcExchange,
} from "./wsEvidence.ts";

interface CliArgs {
  readonly budget?: string;
  readonly baseUrl?: string;
  readonly threadId?: string;
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
    ...(output.json === true ? { json: true } : {}),
  };
}

function assertRequiredArgs(args: CliArgs, requiredArgs: readonly string[]) {
  const values: Record<string, unknown> = {
    budget: args.budget,
    "base-url": args.baseUrl,
    "thread-id": args.threadId,
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

function wsUrlFromBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function requestWsExchange(input: {
  readonly baseUrl: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}): Promise<{
  readonly durationMs: number;
  readonly frames: readonly BrowserWsFrame[];
  readonly exchanges: readonly RpcExchange[];
}> {
  const frames: BrowserWsFrame[] = [];
  const url = wsUrlFromBase(input.baseUrl);
  const id = "perf-1";
  const startedAt = Date.now();
  const encoded = JSON.stringify({ id, body: { ...input.body, _tag: input.method } });

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", { baseUrl: input.baseUrl }));
    }, 60_000);

    ws.addEventListener("open", () => {
      frames.push({
        dir: "out",
        t: 0,
        wallTime: Date.now(),
        raw: encoded,
        byteLength: utf8ByteLength(encoded),
      });
      ws.send(encoded);
    });
    ws.addEventListener("message", (event) => {
      const raw = String(event.data);
      frames.push({
        dir: "in",
        t: Date.now() - startedAt,
        wallTime: Date.now(),
        raw,
        byteLength: utf8ByteLength(raw),
      });
      try {
        const parsed = JSON.parse(raw) as { id?: unknown; error?: unknown };
        if (parsed.id !== id) {
          return;
        }
        clearTimeout(timeout);
        ws.close();
        if (parsed.error !== undefined && parsed.error !== null) {
          reject(
            new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", {
              baseUrl: input.baseUrl,
              error: parsed.error,
            }),
          );
          return;
        }
        const normalized = normalizeBrowserWsFrames(frames);
        resolve({
          durationMs: Date.now() - startedAt,
          frames: normalized,
          exchanges: pairRpcExchanges(normalized),
        });
      } catch (error) {
        clearTimeout(timeout);
        ws.close();
        reject(
          new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", {
            baseUrl: input.baseUrl,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", { baseUrl: input.baseUrl }));
    });
  });
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
    assertRequiredArgs(args, budget.requiredArgs);

    const gates: GateResult[] = [];
    const sampleDurationsMs: number[] = [];
    let allFrames: BrowserWsFrame[] = [];
    let allExchanges: RpcExchange[] = [];

    if (budget.probe === "t3.direct_thread_hard_refresh") {
      assertProbeSupported(budget, "t3.direct_thread_hard_refresh");
      if (!args.baseUrl || !args.threadId) {
        throw new PerfContractError("PERF_PROBE_REQUIRED_ARG_MISSING", {
          arg: "base-url/thread-id",
        });
      }
      const samples = await collectHardRefreshSamples({
        budget,
        baseUrl: args.baseUrl,
        threadId: args.threadId,
      });
      for (const sample of samples) {
        sampleDurationsMs.push(sample.durationMs);
        allFrames.push(...sample.frames);
        allExchanges.push(...sample.exchanges);
      }
    } else if (
      budget.probe === "agents.sidebar_authority_snapshot" ||
      budget.probe === "agents.control_plane_snapshot"
    ) {
      if (!args.baseUrl) {
        throw new PerfContractError("PERF_PROBE_REQUIRED_ARG_MISSING", { arg: "base-url" });
      }
      if (!budget.request) {
        throw new PerfContractError("PERF_BUDGET_REQUIRED_FIELD_MISSING", {
          budgetId: budget.id,
          field: "request",
        });
      }
      const totalRuns = (budget.warmups ?? 0) + (budget.samples ?? 0);
      for (let index = 0; index < totalRuns; index += 1) {
        const sample = await requestWsExchange({
          baseUrl: args.baseUrl,
          method: budget.request.method,
          body: budget.request.input,
        });
        if (index < (budget.warmups ?? 0)) {
          continue;
        }
        sampleDurationsMs.push(sample.durationMs);
        allFrames.push(...sample.frames);
        allExchanges.push(...sample.exchanges);
      }
    } else {
      throw new PerfContractError("PERF_PROBE_UNSUPPORTED", {
        budgetId: budget.id,
        probe: budget.probe,
      });
    }

    gates.push(...gateForbiddenRpc(budget, allFrames));
    gates.push(...gatePayloadBytes(budget, allExchanges));
    gates.push(...gateRowCaps(budget, allExchanges));
    gates.push(...gateQueryBounds(budget, allExchanges));
    gates.push(...gateSubprocessCount(budget));
    gates.push(...gateWallClock(budget, sampleDurationsMs));

    const status = hasGateFailures(gates) ? "fail" : "pass";
    writeJsonEnvelope(
      makePerfEnvelope({
        contract,
        repo: config.repo,
        budget,
        status,
        metrics: {
          sampleDurationsMs,
          exchangeCount: allExchanges.length,
          frameCount: allFrames.length,
        },
        gates,
        evidence: {
          exchanges: summarizeExchanges(allExchanges),
        },
        ...(status === "fail"
          ? {
              error: {
                code: firstFailedGateCode(gates) ?? "PERF_GATE_WALL_CLOCK",
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
