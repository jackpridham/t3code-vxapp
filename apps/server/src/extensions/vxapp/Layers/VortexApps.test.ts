import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadVortexAppsOperationsConfigForTests } from "./VortexApps.ts";

describe("VortexApps operations config", () => {
  it("loads timeout, buffer, cache, and page-limit policy from CFG-008", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "t3-vortex-apps-config-"));
    mkdirSync(join(repoRoot, ".vx/runtime"), { recursive: true });
    writeFileSync(join(repoRoot, "bun.lock"), "");
    mkdirSync(join(repoRoot, "apps/server"), { recursive: true });
    writeFileSync(join(repoRoot, "apps/server/package.json"), "{}");
    writeFileSync(
      join(repoRoot, ".vx/runtime/operations.yaml"),
      [
        "schemaVersion: 1.0.0",
        "documentKind: vx_runtime_operations",
        "web:",
        "  agentStoreStaleTimeMs: 10000",
        "  defaultPageLimit: 17",
        "vortexApps:",
        "  commandTimeoutMs: 12345",
        "  maxBufferBytes: 987654",
        "  cacheTtlMs: 45678",
        "",
      ].join("\n"),
    );

    expect(loadVortexAppsOperationsConfigForTests(repoRoot)).toEqual({
      commandTimeoutMs: 12345,
      maxBufferBytes: 987654,
      cacheTtlMs: 45678,
      defaultPageLimit: 17,
    });
  });
});
