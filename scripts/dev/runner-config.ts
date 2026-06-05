import { createConnection } from "node:net";
import { resolve } from "node:path";
import { URL } from "node:url";

import {
  BASE_SERVER_PORT,
  BASE_WEB_PORT,
  createDevRunnerEnv,
  DEV_RUNNER_MODE_ARGS,
  resolveOffset,
  type DevMode,
} from "../dev-runner.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { NetService } from "@t3tools/shared/Net";
import { resolveAgentsVxappRepoLink } from "./repo-links.ts";

export interface ResolvedRunConfigInput {
  readonly workspaceRoot?: string | undefined;
  readonly baseEnv?: NodeJS.ProcessEnv | undefined;
  readonly mode: DevMode;
  readonly bindHost: string;
  readonly publicHost: string;
  readonly serverPort?: number | undefined;
  readonly webPort?: number | undefined;
  readonly t3Home?: string | undefined;
  readonly authToken?: string | undefined;
  readonly noBrowser?: boolean | undefined;
  readonly autoBootstrapProjectFromCwd?: boolean | undefined;
  readonly logWebSocketEvents?: boolean | undefined;
}

export interface ResolvedRunConfig {
  readonly mode: DevMode;
  readonly bindHost: string;
  readonly publicHost: string;
  readonly serverPort: number;
  readonly webPort: number;
  readonly webUrl: string;
  readonly serverUrl: string;
  readonly serverHealthUrl: string;
  readonly env: NodeJS.ProcessEnv;
  readonly turboArgs: ReadonlyArray<string>;
  readonly offsetSource: string;
}

const runtimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const DEFAULT_READY_TIMEOUT_MS = 60_000;

function loopbackHost(bindHost: string): string {
  switch (bindHost) {
    case "":
    case "0.0.0.0":
    case "::":
    case "[::]":
    case "localhost":
      return "127.0.0.1";
    default:
      return bindHost;
  }
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const done = (available: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(available);
    };
    socket.once("connect", () => done(false));
    socket.once("error", () => done(true));
    socket.setTimeout(500, () => done(true));
  });
}

function readOffsetFromEnvironment(): { offset: number; source: string } {
  const portOffsetRaw = process.env.T3CODE_PORT_OFFSET?.trim();
  const devInstance = process.env.T3CODE_DEV_INSTANCE;
  const portOffset =
    portOffsetRaw === undefined || portOffsetRaw === ""
      ? undefined
      : Number.parseInt(portOffsetRaw, 10);

  return resolveOffset({
    portOffset: Number.isFinite(portOffset) ? portOffset : undefined,
    devInstance,
  });
}

async function resolvePorts(
  mode: DevMode,
  offset: number,
  explicitServerPort: number | undefined,
  explicitWebPort: number | undefined,
): Promise<{ serverPort: number; webPort: number }> {
  const baseServerPort = BASE_SERVER_PORT + offset;
  const baseWebPort = BASE_WEB_PORT + offset;

  if (mode === "dev:server") {
    const serverPort = explicitServerPort ?? (await findNextAvailablePort(baseServerPort));
    return {
      serverPort,
      webPort: explicitWebPort ?? baseWebPort,
    };
  }

  if (mode === "dev:web") {
    const webPort = explicitWebPort ?? (await findNextAvailablePort(baseWebPort));
    return {
      serverPort: explicitServerPort ?? baseServerPort,
      webPort,
    };
  }

  if (explicitServerPort !== undefined && explicitWebPort !== undefined) {
    const [serverAvailable, webAvailable] = await Promise.all([
      isPortAvailable("127.0.0.1", explicitServerPort),
      isPortAvailable("127.0.0.1", explicitWebPort),
    ]);
    if (!serverAvailable) {
      throw new Error(`Server port ${explicitServerPort} is already in use`);
    }
    if (!webAvailable) {
      throw new Error(`Web port ${explicitWebPort} is already in use`);
    }
    return { serverPort: explicitServerPort, webPort: explicitWebPort };
  }

  for (let candidate = offset; candidate < 65535; candidate += 1) {
    const serverPort = explicitServerPort ?? BASE_SERVER_PORT + candidate;
    const webPort = explicitWebPort ?? BASE_WEB_PORT + candidate;
    const [serverAvailable, webAvailable] = await Promise.all([
      explicitServerPort === undefined
        ? isPortAvailable("127.0.0.1", serverPort)
        : Promise.resolve(true),
      explicitWebPort === undefined ? isPortAvailable("127.0.0.1", webPort) : Promise.resolve(true),
    ]);
    if (serverAvailable && webAvailable) {
      return { serverPort, webPort };
    }
  }

  throw new Error("No available dev ports found");
}

async function findNextAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await isPortAvailable("127.0.0.1", port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting at ${startPort}`);
}

export async function resolveRunConfig(input: ResolvedRunConfigInput): Promise<ResolvedRunConfig> {
  const workspaceRoot = input.workspaceRoot ?? resolve(import.meta.dirname, "../..");
  const baseEnv = input.baseEnv ?? process.env;
  const { offset, source } = readOffsetFromEnvironment();
  const { serverPort, webPort } = await resolvePorts(
    input.mode,
    offset,
    input.serverPort,
    input.webPort,
  );
  const webUrl = new URL(`http://${input.publicHost}:${webPort}/`);
  const agentsRepoLink = resolveAgentsVxappRepoLink(workspaceRoot, baseEnv);
  const childEnv = {
    ...baseEnv,
    ...agentsRepoLink.envAssignments,
  };
  const env = await Effect.runPromise(
    createDevRunnerEnv({
      mode: input.mode,
      baseEnv: childEnv,
      serverOffset: offset,
      webOffset: offset,
      t3Home: input.t3Home,
      authToken: input.authToken,
      noBrowser: input.noBrowser,
      autoBootstrapProjectFromCwd: input.autoBootstrapProjectFromCwd,
      logWebSocketEvents: input.logWebSocketEvents,
      host: input.bindHost,
      publicHost: input.publicHost,
      port: serverPort,
      webPort,
      devUrl: webUrl,
    }).pipe(Effect.provide(runtimeLayer)),
  );

  return {
    mode: input.mode,
    bindHost: input.bindHost,
    publicHost: input.publicHost,
    serverPort,
    webPort,
    webUrl: webUrl.toString(),
    serverUrl: `ws://${input.publicHost}:${serverPort}/`,
    serverHealthUrl: `http://${loopbackHost(input.bindHost)}:${serverPort}/health/live`,
    env,
    turboArgs: DEV_RUNNER_MODE_ARGS[input.mode],
    offsetSource: source,
  };
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function resolveReadyTimeoutMs(): number {
  const value = process.env.T3CODE_DEV_READY_TIMEOUT_MS?.trim();
  if (!value) {
    return DEFAULT_READY_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_READY_TIMEOUT_MS;
}

function readyUrlFromLiveUrl(liveUrl: string): string {
  return liveUrl.replace(/\/health\/live$/, "/health/ready");
}

export async function waitForModeReadiness(config: ResolvedRunConfig): Promise<boolean> {
  const timeoutMs = resolveReadyTimeoutMs();
  const readyUrl = readyUrlFromLiveUrl(config.serverHealthUrl);
  if (config.mode === "dev:server") {
    return await waitForHttp(readyUrl, timeoutMs);
  }

  const checks: Array<Promise<boolean>> = [waitForHttp(config.webUrl, timeoutMs)];
  if (config.mode === "dev") {
    checks.push(waitForHttp(readyUrl, timeoutMs));
  }
  const results = await Promise.all(checks);
  return results.every(Boolean);
}
