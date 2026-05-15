import { afterEach, describe, expect, it, vi } from "vitest";

const originalRoot = process.env.T3_AGENTS_VXAPP_ROOT;
const originalDbPath = process.env.T3_AGENTS_VXAPP_DB_PATH;

afterEach(() => {
  vi.resetModules();
  if (originalRoot === undefined) {
    delete process.env.T3_AGENTS_VXAPP_ROOT;
  } else {
    process.env.T3_AGENTS_VXAPP_ROOT = originalRoot;
  }
  if (originalDbPath === undefined) {
    delete process.env.T3_AGENTS_VXAPP_DB_PATH;
  } else {
    process.env.T3_AGENTS_VXAPP_DB_PATH = originalDbPath;
  }
});

describe("agentsVxappSqlite env overrides", () => {
  it("honors T3_AGENTS_VXAPP_ROOT and T3_AGENTS_VXAPP_DB_PATH at import time", async () => {
    process.env.T3_AGENTS_VXAPP_ROOT = "/tmp/custom-agents-root";
    process.env.T3_AGENTS_VXAPP_DB_PATH = "/tmp/custom-agents-root/custom.sqlite3";
    vi.resetModules();

    const module = await import("./agentsVxappSqlite.ts");

    expect(module.AGENTS_VXAPP_ROOT).toBe("/tmp/custom-agents-root");
    expect(module.AGENTS_VXAPP_DB_PATH).toBe("/tmp/custom-agents-root/custom.sqlite3");
  });
});
