import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";

import { createDevRunnerEnv } from "../dev-runner.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { NetService } from "@t3tools/shared/Net";
import { Layer } from "effect";
import { resolveRunConfig } from "./runner-config.ts";
import { workspaceKey } from "./runtime-state.ts";

const runtimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const cleanupRoots: string[] = [];

function writeFileTree(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", "utf8");
}

function createRepoFixture(): { repoRoot: string; siblingRoot: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "t3code-dev-manager-"));
  cleanupRoots.push(tempRoot);
  const repoRoot = resolve(tempRoot, "t3code-vxapp");
  const siblingRoot = resolve(tempRoot, "agents-vxapp");
  mkdirSync(resolve(repoRoot, ".vx"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".vx/repo-links.yaml"),
    `schemaVersion: 1.0.0
documentKind: vx_repo_links
links:
  agents:
    selector: agents
    requiredEntrypoints:
      - scripts/tools/t3-control-plane-owner
      - scripts/tools/role-session-owner
    envAliases:
      - T3_AGENTS_VXAPP_REPO_ROOT
      - AGENTS_VXAPP_REPO_ROOT
      - VX_AGENTS_REPO_ROOT
    fallbackSibling: false
`,
    "utf8",
  );
  writeFileTree(resolve(siblingRoot, "scripts/tools/t3-control-plane-owner"));
  writeFileTree(resolve(siblingRoot, "scripts/tools/role-session-owner"));
  return { repoRoot, siblingRoot };
}

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("localized T3 dev surface", () => {
  it("workspace keys are stable and path-sensitive", () => {
    expect(workspaceKey("/tmp/example")).toEqual(workspaceKey("/tmp/example"));
    expect(workspaceKey("/tmp/example")).not.toEqual(workspaceKey("/tmp/other"));
  });

  it("creates managed env with remote-capable Vite websocket settings", async () => {
    const env = await Effect.runPromise(
      createDevRunnerEnv({
        mode: "dev",
        baseEnv: {},
        serverOffset: 0,
        webOffset: 0,
        t3Home: "/tmp/t3-home",
        authToken: undefined,
        noBrowser: true,
        autoBootstrapProjectFromCwd: true,
        logWebSocketEvents: true,
        host: "0.0.0.0",
        publicHost: "192.168.100.42",
        port: 4773,
        webPort: 6773,
        devUrl: new URL("http://192.168.100.42:6773/"),
      }).pipe(Effect.provide(runtimeLayer)),
    );

    expect(env.T3CODE_PORT).toBe("4773");
    expect(env.PORT).toBe("6773");
    expect(env.VITE_DEV_SERVER_URL).toBe("http://192.168.100.42:6773/");
    expect(env.VITE_WS_URL).toBe("ws://192.168.100.42:6773/ws");
    expect(env.VITE_WS_PROXY_PORT).toBe("4773");
    expect(env.VITE_HMR_HOST).toBe("192.168.100.42");
    expect(env.VITE_HOST).toBe("true");
  });

  it("resolves default managed ports and urls", async () => {
    const { repoRoot, siblingRoot } = createRepoFixture();
    const config = await resolveRunConfig({
      workspaceRoot: repoRoot,
      baseEnv: {},
      mode: "dev",
      bindHost: "0.0.0.0",
      publicHost: "127.0.0.1",
      t3Home: "/tmp/t3-home",
    });

    expect(config.serverPort).toBeGreaterThanOrEqual(3773);
    expect(config.webPort).toBeGreaterThanOrEqual(5733);
    expect(config.webUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(config.serverHealthUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(config.env.T3_AGENTS_VXAPP_REPO_ROOT).toBe(siblingRoot);
    expect(config.env.AGENTS_VXAPP_REPO_ROOT).toBe(siblingRoot);
    expect(config.env.VX_AGENTS_REPO_ROOT).toBe(siblingRoot);
  });
});
