#!/usr/bin/env node
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Ref } from "effect";

import { ORCHESTRATION_WS_CHANNELS, WS_CHANNELS } from "@t3tools/contracts";
import { makeServerPushBus } from "../apps/server/src/wsServer/pushBus.ts";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverRequire = createRequire(new URL("../apps/server/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { WebSocketServer } = serverRequire("ws");
const { chromium } = webRequire("playwright");
const outDir = resolve(
  process.env.T3CODE_LIVE_WS_PROBE_OUT_DIR ?? resolve(repoRoot, ".vx/live-probes/t3code-live-ws"),
);

const html = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>T3Code live WS perf probe</title>
    <style>
      body { font: 13px system-ui, sans-serif; margin: 16px; }
      #stream { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #ccc; min-height: 120px; padding: 8px; }
    </style>
  </head>
  <body>
    <h1>T3Code live WS perf probe</h1>
    <div id="summary"></div>
    <div id="stream"></div>
    <script>
      const params = new URLSearchParams(location.search);
      const client = params.get("client") || "fast";
      const state = {
        client,
        connected: false,
        streamingCount: 0,
        finalCount: 0,
        checkpointCount: 0,
        diffCount: 0,
        activityCount: 0,
        sidebarRefreshCount: 0,
        latencies: [],
        finalLatencies: [],
        lastTextLength: 0,
        finalBursts: [],
      };
      window.__probeState = state;
      const render = () => {
        document.getElementById("summary").textContent = JSON.stringify({
          client,
          streamingCount: state.streamingCount,
          finalCount: state.finalCount,
          checkpointCount: state.checkpointCount,
          diffCount: state.diffCount,
          activityCount: state.activityCount,
          sidebarRefreshCount: state.sidebarRefreshCount,
        });
      };
      const ws = new WebSocket("ws://" + location.host + "/ws?client=" + client);
      ws.addEventListener("open", () => {
        state.connected = true;
        render();
      });
      ws.addEventListener("message", (event) => {
        const envelope = JSON.parse(event.data);
        if (envelope.channel === "server.configUpdated") {
          state.sidebarRefreshCount += 1;
          render();
          return;
        }
        if (envelope.channel !== "orchestration.domainEvent") {
          return;
        }
        const data = envelope.data;
        const latency = Math.max(0, Date.now() - Date.parse(data.occurredAt));
        state.latencies.push(latency);
        if (data.type === "thread.message-sent") {
          if (data.payload.streaming) {
            state.streamingCount += 1;
            state.lastTextLength += data.payload.text.length;
            document.getElementById("stream").textContent = String(state.lastTextLength);
          } else {
            state.finalCount += 1;
            state.finalLatencies.push(latency);
            state.finalBursts.push(data.payload.text);
          }
        } else if (data.type === "thread.turn-checkpoint-recorded") {
          state.checkpointCount += 1;
        } else if (data.type === "thread.turn-diff-completed") {
          state.diffCount += 1;
        } else if (data.type === "thread.activity-appended") {
          state.activityCount += 1;
        }
        render();
      });
    </script>
  </body>
</html>`;

function percentile(values, percentileRank) {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileRank / 100) * sorted.length) - 1);
  return sorted[index];
}

function nowIso() {
  return new Date().toISOString();
}

function baseEvent(sequence, type, payload) {
  return {
    eventId: `probe-event-${sequence}`,
    sequence,
    type,
    aggregateKind: "thread",
    aggregateId: "probe-thread",
    commandId: `probe-command-${sequence}`,
    causationEventId: null,
    correlationId: null,
    occurredAt: nowIso(),
    metadata: {},
    payload,
  };
}

function assistantEvent(sequence, text, streaming, burst) {
  return baseEvent(sequence, "thread.message-sent", {
    threadId: "probe-thread",
    messageId: `assistant:probe-message-${burst}`,
    role: "assistant",
    text,
    turnId: `probe-turn-${burst}`,
    streaming,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

function checkpointEvent(sequence, type, burst) {
  return baseEvent(sequence, type, {
    threadId: "probe-thread",
    turnId: `probe-turn-${burst}`,
    checkpointTurnCount: burst,
    checkpointRef: `refs/t3/checkpoints/probe-thread/turn/${burst}`,
    status: "ready",
    files: [{ path: "probe.txt", kind: "modified", additions: 1, deletions: 0 }],
    assistantMessageId: `assistant:probe-message-${burst}`,
    completedAt: nowIso(),
  });
}

function activityEvent(sequence, burst) {
  return baseEvent(sequence, "thread.activity-appended", {
    threadId: "probe-thread",
    activity: {
      id: `probe-activity-${burst}`,
      tone: "info",
      kind: "tool.progress",
      summary: "tool event delivered during assistant stream",
      payload: { tool: "probe", burst },
      turnId: `probe-turn-${burst}`,
      sequence,
      createdAt: nowIso(),
    },
  });
}

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let sequence = 0;

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clients = yield* Ref.make(new Set());
        const pushBus = yield* makeServerPushBus({
          clients,
          logOutgoingPush: () => {},
        });

        const server = http.createServer((request, response) => {
          if (request.url?.startsWith("/probe")) {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(html);
            return;
          }
          response.writeHead(404);
          response.end("not found");
        });
        const wss = new WebSocketServer({ noServer: true });
        server.on("upgrade", (request, socket, head) => {
          wss.handleUpgrade(request, socket, head, (ws) => {
            const url = new URL(request.url ?? "/ws", "http://127.0.0.1");
            const clientKind = url.searchParams.get("client") ?? "fast";
            if (clientKind === "slow") {
              Object.defineProperty(ws, "bufferedAmount", {
                configurable: true,
                get: () => 2_000_000,
              });
            }
            void Effect.runPromise(Ref.update(clients, (current) => new Set([...current, ws])));
            ws.on("close", () => {
              void Effect.runPromise(
                Ref.update(clients, (current) => {
                  const next = new Set(current);
                  next.delete(ws);
                  return next;
                }),
              );
            });
          });
        });
        yield* Effect.promise(
          () =>
            new Promise((resolveListen) => {
              server.listen(0, "127.0.0.1", resolveListen);
            }),
        );
        const address = server.address();
        if (typeof address !== "object" || address === null) {
          throw new Error("probe server did not bind to a TCP port");
        }
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const browser = yield* Effect.promise(() => chromium.launch({ headless: true }));
        try {
          const context = yield* Effect.promise(() =>
            browser.newContext({ viewport: { width: 960, height: 720 } }),
          );
          yield* Effect.promise(() =>
            context.tracing.start({ screenshots: true, snapshots: true }),
          );
          const fastPage = yield* Effect.promise(() => context.newPage());
          const slowPage = yield* Effect.promise(() => context.newPage());
          yield* Effect.promise(() => fastPage.goto(`${baseUrl}/probe?client=fast`));
          yield* Effect.promise(() => slowPage.goto(`${baseUrl}/probe?client=slow`));
          yield* Effect.promise(() =>
            waitFor(
              async () =>
                (await fastPage.evaluate(() => window.__probeState.connected)) === true &&
                (await slowPage.evaluate(() => window.__probeState.connected)) === true,
              "browser websocket clients",
            ),
          );

          const publishBurst = function* (burst, count) {
            const startedAt = performance.now();
            const halfway = Math.floor(count / 2);
            for (let index = 1; index <= count; index += 1) {
              sequence += 1;
              yield* pushBus.publishAll(
                ORCHESTRATION_WS_CHANNELS.domainEvent,
                assistantEvent(sequence, `${burst}:${index},`, true, burst),
              );
              if (index === halfway) {
                sequence += 1;
                yield* pushBus.publishAll(
                  ORCHESTRATION_WS_CHANNELS.domainEvent,
                  checkpointEvent(sequence, "thread.turn-checkpoint-recorded", burst),
                );
                sequence += 1;
                yield* pushBus.publishAll(
                  ORCHESTRATION_WS_CHANNELS.domainEvent,
                  activityEvent(sequence, burst),
                );
                sequence += 1;
                yield* pushBus.publishAll(
                  ORCHESTRATION_WS_CHANNELS.domainEvent,
                  checkpointEvent(sequence, "thread.turn-diff-completed", burst),
                );
              }
            }
            sequence += 1;
            const finalLabel = `final-burst-${burst}`;
            yield* pushBus.publishAll(
              ORCHESTRATION_WS_CHANNELS.domainEvent,
              assistantEvent(sequence, finalLabel, false, burst),
            );
            yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, { issues: [] });
            return {
              burst,
              count,
              publishDurationMs: Math.round(performance.now() - startedAt),
              finalLabel,
            };
          };

          const firstBurst = yield* Effect.gen(publishBurst.bind(null, 1, 1_000));
          yield* Effect.promise(() =>
            waitFor(
              async () =>
                (await fastPage.evaluate(() => window.__probeState.finalCount)) >= 1 &&
                (await slowPage.evaluate(() => window.__probeState.finalCount)) >= 1,
              "first final event on both clients",
            ),
          );
          const secondBurst = yield* Effect.gen(publishBurst.bind(null, 2, 5_000));
          const drainStartedAt = performance.now();
          yield* Effect.promise(() =>
            waitFor(
              async () =>
                (await fastPage.evaluate(() => window.__probeState.finalCount)) >= 2 &&
                (await slowPage.evaluate(() => window.__probeState.finalCount)) >= 2 &&
                (await fastPage.evaluate(() => window.__probeState.sidebarRefreshCount)) >= 2 &&
                (await slowPage.evaluate(() => window.__probeState.sidebarRefreshCount)) >= 2,
              "second final event and sidebar refresh on both clients",
            ),
          );
          const queueDrainTimeMs = Math.round(performance.now() - drainStartedAt);
          const fastState = yield* Effect.promise(() =>
            fastPage.evaluate(() => window.__probeState),
          );
          const slowState = yield* Effect.promise(() =>
            slowPage.evaluate(() => window.__probeState),
          );
          const health = yield* pushBus.getHealth;
          const screenshotPath = resolve(outDir, "t3code-live-ws-fast-client.png");
          const tracePath = resolve(outDir, "t3code-live-ws-trace.zip");
          yield* Effect.promise(() =>
            fastPage.screenshot({ path: screenshotPath, fullPage: true }),
          );
          yield* Effect.promise(() => context.tracing.stop({ path: tracePath }));

          const metrics = {
            ok: true,
            repoRoot,
            baseUrl,
            bursts: [firstBurst, secondBurst],
            queueDrainTimeMs,
            fastClient: {
              ...fastState,
              p50LatencyMs: percentile(fastState.latencies, 50),
              p95LatencyMs: percentile(fastState.latencies, 95),
              p99LatencyMs: percentile(fastState.latencies, 99),
              finalPublishToRenderLatencyMs: fastState.finalLatencies.at(-1) ?? null,
            },
            slowClient: {
              ...slowState,
              p50LatencyMs: percentile(slowState.latencies, 50),
              p95LatencyMs: percentile(slowState.latencies, 95),
              p99LatencyMs: percentile(slowState.latencies, 99),
              finalPublishToRenderLatencyMs: slowState.finalLatencies.at(-1) ?? null,
            },
            pushBusHealth: health,
            artifacts: { screenshotPath, tracePath },
          };
          yield* Effect.promise(() =>
            writeFile(
              resolve(outDir, "t3code-live-ws-metrics.json"),
              `${JSON.stringify(metrics, null, 2)}\n`,
            ),
          );
          console.log(JSON.stringify(metrics, null, 2));
        } finally {
          yield* Effect.promise(() => browser.close());
          yield* Effect.promise(
            () =>
              new Promise((resolveClose) => {
                wss.close(() => server.close(resolveClose));
              }),
          );
        }
      }),
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
