import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Phase 05 live probe repo-root config", () => {
  it.each([
    "scripts/live-real-provider-probe.mjs",
    "scripts/live-app-server-sidebar-provider-probe.mjs",
  ])("%s resolves agents repo from repo-links env aliases", (path) => {
    const source = read(path);

    expect(source).toContain(".vx/repo-links.yaml");
    expect(source).toContain("resolveAgentsRootFromRepoLinks");
    expect(source).not.toContain('"/home/gizmo/agents-vxapp"');
    expect(source).not.toContain("'/home/gizmo/agents-vxapp'");
  });
});

describe("live proof scripts avoid stale production authority fixtures", () => {
  const productionProofScripts = [
    "scripts/live-real-provider-probe.mjs",
    "scripts/live-app-server-sidebar-provider-probe.mjs",
    "scripts/live-ws-pushbus-perf-probe.mjs",
  ];

  const forbiddenProductionSentinels = [
    "program-live",
    "thread-cto-live",
    "thread-jasper-live",
    ["plans/evidence", "orchestration-platform-migration"].join("/"),
    "generated-role-session-live",
    "t3code-app-server-live-generated-role-runtime",
    "T3_STATE_DB",
    "VX_AGENTS_APP_ROOT",
    "T3CODE_REAL_PROVIDER_OWNER_",
    "agents_session_bindings",
  ];

  it.each(productionProofScripts)("%s has no production forbidden sentinels", (path) => {
    const source = read(path);

    for (const sentinel of forbiddenProductionSentinels) {
      expect(source).not.toContain(sentinel);
    }
  });
});

describe("live real-provider probe model default", () => {
  it("defaults to a ChatGPT Codex supported model while preserving override support", () => {
    const source = read("scripts/live-real-provider-probe.mjs");

    expect(source).toContain('process.env.T3CODE_REAL_PROVIDER_MODEL ?? "gpt-5.4"');
    expect(source).not.toContain('process.env.T3CODE_REAL_PROVIDER_MODEL ?? "gpt-5.3-codex"');
  });
});
