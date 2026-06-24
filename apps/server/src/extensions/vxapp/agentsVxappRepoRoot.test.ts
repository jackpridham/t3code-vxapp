import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_ALIASES = [
  "T3_AGENTS_VXAPP_REPO_ROOT",
  "AGENTS_VXAPP_REPO_ROOT",
  "VX_AGENTS_REPO_ROOT",
] as const;
const originalEnv = new Map(ENV_ALIASES.map((alias) => [alias, process.env[alias]]));

afterEach(() => {
  for (const alias of ENV_ALIASES) {
    const originalValue = originalEnv.get(alias);
    if (originalValue === undefined) {
      delete process.env[alias];
    } else {
      process.env[alias] = originalValue;
    }
  }
});

beforeEach(() => {
  vi.resetModules();
});

const loadEnvOverrideModule = () => import("./agentsVxappRepoRoot.ts");
const loadInvalidEnvModule = () => import("./agentsVxappRepoRoot.ts");
const loadMissingEnvModule = () => import("./agentsVxappRepoRoot.ts");
const loadAliasConflictModule = () => import("./agentsVxappRepoRoot.ts");

describe("agentsVxappRepoRoot resolution", () => {
  it("resolves the t3code-vxapp repo root from bundled dist module directories", async () => {
    const expectedRoot = path.resolve(import.meta.dirname, "../../../../..");
    const buildOutputModuleDir = path.resolve(import.meta.dirname, "../../../dist");

    process.env.T3_AGENTS_VXAPP_REPO_ROOT = path.resolve(
      import.meta.dirname,
      "../../../../../../agents-vxapp",
    );
    const module = await loadEnvOverrideModule();

    expect(module.resolveT3CodeRepoRoot(buildOutputModuleDir)).toBe(expectedRoot);
  });

  it("honors T3_AGENTS_VXAPP_REPO_ROOT at import time", async () => {
    const expectedRoot = path.resolve(import.meta.dirname, "../../../../../../agents-vxapp");
    process.env.T3_AGENTS_VXAPP_REPO_ROOT = expectedRoot;

    const module = await loadEnvOverrideModule();

    expect(module.AGENTS_VXAPP_REPO_ROOT).toBe(expectedRoot);
  });

  it("fails closed when T3_AGENTS_VXAPP_REPO_ROOT is invalid", async () => {
    delete process.env.AGENTS_VXAPP_REPO_ROOT;
    delete process.env.VX_AGENTS_REPO_ROOT;
    process.env.T3_AGENTS_VXAPP_REPO_ROOT = "/tmp/not-agents-vxapp";

    await expect(loadInvalidEnvModule()).rejects.toThrow(
      "does not point at a valid agents-vxapp checkout",
    );
  });

  it("uses the validated sibling checkout when env aliases are unset", async () => {
    for (const alias of ENV_ALIASES) {
      delete process.env[alias];
    }

    const module = await loadMissingEnvModule();

    expect(module.AGENTS_VXAPP_REPO_ROOT).toBe(
      path.resolve(import.meta.dirname, "../../../../../../agents-vxapp"),
    );
  });

  it("fails closed when repo-root env aliases disagree", async () => {
    process.env.T3_AGENTS_VXAPP_REPO_ROOT = path.resolve(
      import.meta.dirname,
      "../../../../../../agents-vxapp",
    );
    process.env.AGENTS_VXAPP_REPO_ROOT = "/tmp/not-the-same";

    await expect(loadAliasConflictModule()).rejects.toThrow("env aliases disagree");
  });
});
