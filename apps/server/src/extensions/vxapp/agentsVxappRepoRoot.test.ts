import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRoot = process.env.T3_AGENTS_VXAPP_REPO_ROOT;

afterEach(() => {
  if (originalRoot === undefined) {
    delete process.env.T3_AGENTS_VXAPP_REPO_ROOT;
  } else {
    process.env.T3_AGENTS_VXAPP_REPO_ROOT = originalRoot;
  }
});

beforeEach(() => {
  vi.resetModules();
});

const loadEnvOverrideModule = () => import("./agentsVxappRepoRoot.ts");
const loadInvalidEnvModule = () => import("./agentsVxappRepoRoot.ts");
const loadSiblingDiscoveryModule = () => import("./agentsVxappRepoRoot.ts");

describe("agentsVxappRepoRoot resolution", () => {
  it("resolves the t3code-vxapp repo root from bundled dist module directories", async () => {
    const expectedRoot = path.resolve(import.meta.dirname, "../../../../..");
    const buildOutputModuleDir = path.resolve(import.meta.dirname, "../../../dist");

    const module = await loadSiblingDiscoveryModule();

    expect(module.resolveT3CodeRepoRoot(buildOutputModuleDir)).toBe(expectedRoot);
  });

  it("honors T3_AGENTS_VXAPP_REPO_ROOT at import time", async () => {
    const expectedRoot = path.resolve(import.meta.dirname, "../../../../../../agents-vxapp");
    process.env.T3_AGENTS_VXAPP_REPO_ROOT = expectedRoot;

    const module = await loadEnvOverrideModule();

    expect(module.AGENTS_VXAPP_REPO_ROOT).toBe(expectedRoot);
  });

  it("fails closed when T3_AGENTS_VXAPP_REPO_ROOT is invalid", async () => {
    process.env.T3_AGENTS_VXAPP_REPO_ROOT = "/tmp/not-agents-vxapp";

    await expect(loadInvalidEnvModule()).rejects.toThrow(
      "does not point at a valid agents-vxapp checkout",
    );
  });

  it("sibling discovery resolves a checkout with the required owner entrypoints", async () => {
    delete process.env.T3_AGENTS_VXAPP_REPO_ROOT;

    const module = await loadSiblingDiscoveryModule();

    expect(
      fs.existsSync(`${module.AGENTS_VXAPP_REPO_ROOT}/scripts/tools/t3-control-plane-owner`),
    ).toBe(true);
    expect(fs.existsSync(`${module.AGENTS_VXAPP_REPO_ROOT}/scripts/tools/role-session-owner`)).toBe(
      true,
    );
  });
});
