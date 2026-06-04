import { createRequire } from "node:module";

import type { PerformanceBudget } from "./budgetConfig.ts";
import { PerfContractError } from "./errorContract.ts";
import {
  extractDomainEvents,
  makeRecorderInitScript,
  normalizeBrowserWsFrames,
  pairRpcExchanges,
  type BrowserWsFrame,
  type RpcExchange,
} from "./wsEvidence.ts";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));

interface PlaywrightModule {
  readonly chromium: {
    launch: (options: { headless: boolean }) => Promise<Browser>;
  };
}

interface Browser {
  newPage: (options?: { viewport?: { width: number; height: number } }) => Promise<Page>;
  close: () => Promise<void>;
}

interface Locator {
  fill: (value: string, options?: { timeout?: number }) => Promise<void>;
  click: (options?: { timeout?: number }) => Promise<void>;
  evaluate: <T>(fn: (element: unknown) => T | Promise<T>) => Promise<T>;
  waitFor: (options?: { state?: "attached" | "visible"; timeout?: number }) => Promise<void>;
}

interface Page {
  addInitScript: (script: string | { content: string }) => Promise<void>;
  goto: (
    url: string,
    options?: { waitUntil?: "domcontentloaded" | "networkidle"; timeout?: number },
  ) => Promise<unknown>;
  locator: (selector: string) => Locator;
  evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
  waitForTimeout: (timeout: number) => Promise<void>;
  close: () => Promise<void>;
}

export interface HardRefreshSample {
  readonly durationMs: number;
  readonly frames: readonly BrowserWsFrame[];
  readonly exchanges: readonly RpcExchange[];
}

export interface LiveTurnMilestones {
  browser_submit: number | null;
  dispatch_sent: number | null;
  dispatch_ack: number | null;
  user_message_sent: number | null;
  turn_start_requested: number | null;
  session_running: number | null;
  provider_turn_started: number | null;
  first_thinking: number | null;
  final_assistant_message: number | null;
  turn_settled: number | null;
}

export interface LiveTurnResult {
  readonly frames: readonly BrowserWsFrame[];
  readonly exchanges: readonly RpcExchange[];
  readonly milestones: LiveTurnMilestones;
  readonly deltasMs: Record<string, number | null>;
  readonly correlation: {
    readonly commandId: string;
    readonly messageId: string;
    readonly turnId: string | null;
  };
}

function loadPlaywright(): PlaywrightModule {
  return webRequire("playwright") as PlaywrightModule;
}

function threadUrl(baseUrl: string, threadId: string): string {
  return new URL(threadId, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readFrames(page: Page): Promise<readonly BrowserWsFrame[]> {
  const rawFrames = await page.evaluate<readonly unknown[]>(
    () => (globalThis as unknown as { __t3PerfWsLog?: readonly unknown[] }).__t3PerfWsLog ?? [],
  );
  return normalizeBrowserWsFrames(rawFrames);
}

export async function collectHardRefreshSamples(input: {
  readonly budget: PerformanceBudget;
  readonly baseUrl: string;
  readonly threadId: string;
}): Promise<readonly HardRefreshSample[]> {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  const samples: HardRefreshSample[] = [];
  const totalRuns = (input.budget.warmups ?? 0) + (input.budget.samples ?? 0);
  try {
    for (let index = 0; index < totalRuns; index += 1) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      try {
        await page.addInitScript({ content: makeRecorderInitScript() });
        const startedAt = Date.now();
        await page.goto(threadUrl(input.baseUrl, input.threadId), {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await page.locator('[data-testid="composer-editor"]').waitFor({
          state: "visible",
          timeout: 60_000,
        });
        await page.waitForTimeout(500);
        const durationMs = Date.now() - startedAt;
        if (index >= (input.budget.warmups ?? 0)) {
          const frames = await readFrames(page);
          samples.push({ durationMs, frames, exchanges: pairRpcExchanges(frames) });
        }
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    throw new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", {
      message: error instanceof Error ? error.message : String(error),
      baseUrl: input.baseUrl,
      threadId: input.threadId,
    });
  } finally {
    await browser.close();
  }
  return samples;
}

function findDispatchExchange(
  exchanges: readonly RpcExchange[],
  threadId: string,
): RpcExchange | null {
  return (
    exchanges.find((exchange) => {
      if (exchange.method !== "orchestration.dispatchCommand") {
        return false;
      }
      const command = exchange.requestBody.command;
      return (
        isRecord(command) && command.type === "thread.turn.start" && command.threadId === threadId
      );
    }) ?? null
  );
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function analyzeLiveTurn(input: {
  readonly frames: readonly BrowserWsFrame[];
  readonly threadId: string;
  readonly browserSubmit: number;
}): LiveTurnResult | null {
  const exchanges = pairRpcExchanges(input.frames);
  const dispatch = findDispatchExchange(exchanges, input.threadId);
  if (!dispatch || dispatch.receivedAt === null || !isRecord(dispatch.requestBody.command)) {
    return null;
  }

  const command = dispatch.requestBody.command;
  const commandId = getString(command, "commandId");
  const message = command.message;
  const messageId = isRecord(message) ? getString(message, "messageId") : null;
  if (!commandId || !messageId) {
    return null;
  }

  let turnId: string | null = null;
  const milestones: LiveTurnMilestones = {
    browser_submit: input.browserSubmit,
    dispatch_sent: dispatch.sentAt,
    dispatch_ack: dispatch.receivedAt,
    user_message_sent: null,
    turn_start_requested: null,
    session_running: null,
    provider_turn_started: null,
    first_thinking: null,
    final_assistant_message: null,
    turn_settled: null,
  };

  const events = extractDomainEvents(input.frames);
  for (const { frame, event } of events) {
    if (
      event.commandId !== commandId &&
      event.correlationId !== commandId &&
      event.aggregateId !== input.threadId
    ) {
      continue;
    }
    if (!isRecord(event.payload)) {
      continue;
    }
    if (event.payload.threadId !== input.threadId) {
      continue;
    }

    if (event.type === "thread.message-sent" && event.payload.messageId === messageId) {
      milestones.user_message_sent ??= frame.wallTime;
      continue;
    }
    if (event.type === "thread.turn-start-requested") {
      milestones.turn_start_requested ??= frame.wallTime;
      if (typeof event.payload.messageId === "string" && event.payload.messageId !== messageId) {
        continue;
      }
      continue;
    }
    if (event.type === "thread.session-set" && isRecord(event.payload.session)) {
      const session = event.payload.session;
      const activeTurnId = typeof session.activeTurnId === "string" ? session.activeTurnId : null;
      if (activeTurnId) {
        turnId ??= activeTurnId;
        if (session.status === "running") {
          milestones.session_running ??= frame.wallTime;
        }
      } else if (turnId !== null) {
        milestones.turn_settled ??= frame.wallTime;
      }
    }
    if (isRecord(event.metadata) && typeof event.metadata.providerTurnId === "string") {
      milestones.provider_turn_started ??= frame.wallTime;
    }
    if (event.type === "thread.activity-appended" && isRecord(event.payload.activity)) {
      const activityTurnId = event.payload.activity.turnId;
      if (turnId === null || activityTurnId === turnId) {
        turnId = typeof activityTurnId === "string" ? activityTurnId : turnId;
        milestones.first_thinking ??= frame.wallTime;
      }
    }
    if (event.type === "thread.proposed-plan-upserted") {
      milestones.first_thinking ??= frame.wallTime;
    }
    if (
      event.type === "thread.message-sent" &&
      event.payload.role === "assistant" &&
      typeof event.payload.turnId === "string"
    ) {
      turnId ??= event.payload.turnId;
      if (event.payload.streaming === true) {
        milestones.first_thinking ??= frame.wallTime;
      } else if (turnId === event.payload.turnId) {
        milestones.final_assistant_message =
          milestones.final_assistant_message === null
            ? frame.wallTime
            : Math.max(milestones.final_assistant_message, frame.wallTime);
      }
    }
  }

  milestones.provider_turn_started ??= milestones.session_running;
  milestones.first_thinking ??= milestones.provider_turn_started;

  return {
    frames: input.frames,
    exchanges,
    milestones,
    deltasMs: {
      submit_to_ack: delta(milestones.browser_submit, milestones.dispatch_ack),
      turn_start_requested_to_running: delta(
        milestones.turn_start_requested,
        milestones.session_running,
      ),
      running_to_first_thinking: delta(milestones.session_running, milestones.first_thinking),
      final_to_settled: delta(milestones.final_assistant_message, milestones.turn_settled),
      total_turn_duration: delta(milestones.browser_submit, milestones.turn_settled),
    },
    correlation: { commandId, messageId, turnId },
  };
}

function delta(start: number | null, end: number | null): number | null {
  return typeof start === "number" && typeof end === "number" ? Math.max(0, end - start) : null;
}

function hasRequiredMilestones(result: LiveTurnResult): boolean {
  return Object.entries(result.milestones).every(([, value]) => typeof value === "number");
}

export async function watchLiveTurnPipeline(input: {
  readonly budget: PerformanceBudget;
  readonly baseUrl: string;
  readonly threadId: string;
  readonly message: string;
}): Promise<LiveTurnResult> {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    try {
      await page.addInitScript({ content: makeRecorderInitScript() });
      await page.goto(threadUrl(input.baseUrl, input.threadId), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const composer = page.locator('[data-testid="composer-editor"]');
      await composer.waitFor({ state: "visible", timeout: 60_000 });
      await composer.click({ timeout: 10_000 });
      await composer.fill(input.message, { timeout: 10_000 });
      const browserSubmit = Date.now();
      await page.locator('[data-chat-composer-form="true"]').evaluate((element) => {
        const candidate = element as { requestSubmit?: () => void };
        candidate.requestSubmit?.();
      });

      const timeoutMs = input.budget.hard_ms ?? 120_000;
      const startedAt = Date.now();
      let latest: LiveTurnResult | null = null;
      while (Date.now() - startedAt < timeoutMs) {
        const frames = await readFrames(page);
        latest = analyzeLiveTurn({ frames, threadId: input.threadId, browserSubmit });
        if (latest && hasRequiredMilestones(latest)) {
          return latest;
        }
        await page.waitForTimeout(250);
      }
      if (!latest) {
        throw new PerfContractError("PERF_WATCHER_CORRELATION_LOST", {
          threadId: input.threadId,
        });
      }
      throw new PerfContractError("PERF_WATCHER_MILESTONE_MISSING", {
        threadId: input.threadId,
        milestones: latest.milestones,
      });
    } finally {
      await page.close();
    }
  } catch (error) {
    if (error instanceof PerfContractError) {
      throw error;
    }
    throw new PerfContractError("PERF_PROBE_TARGET_UNAVAILABLE", {
      message: error instanceof Error ? error.message : String(error),
      baseUrl: input.baseUrl,
      threadId: input.threadId,
    });
  } finally {
    await browser.close();
  }
}
