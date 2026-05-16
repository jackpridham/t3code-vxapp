import { afterEach, describe, expect, it, vi } from "vitest";

const originalRoot = process.env.T3_AGENTS_VXAPP_ROOT;

afterEach(() => {
  vi.resetModules();
  if (originalRoot === undefined) {
    delete process.env.T3_AGENTS_VXAPP_ROOT;
  } else {
    process.env.T3_AGENTS_VXAPP_ROOT = originalRoot;
  }
});

describe("agentsVxappSqlite env overrides", () => {
  it("honors T3_AGENTS_VXAPP_ROOT at import time", async () => {
    process.env.T3_AGENTS_VXAPP_ROOT = "/tmp/custom-agents-root";
    vi.resetModules();

    const module = await import("./agentsVxappSqlite.ts");

    expect(module.AGENTS_VXAPP_ROOT).toBe("/tmp/custom-agents-root");
  });
});
