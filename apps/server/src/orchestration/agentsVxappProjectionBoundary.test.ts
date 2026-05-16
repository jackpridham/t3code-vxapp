import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function projectorsBlock(): string {
  const source = read("src/orchestration/Layers/ProjectionPipeline.ts");
  const start = source.indexOf("const projectors: ReadonlyArray<ProjectorDefinition>");
  const end = source.indexOf("const applyProjectorEventsInTransaction", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("agents-vxapp projection authority boundary", () => {
  it("does not wire local owner-equivalent projection repositories into live projectors", () => {
    const block = projectorsBlock();

    expect(block).not.toContain("ORCHESTRATION_PROJECTOR_NAMES.programs");
    expect(block).not.toContain("ORCHESTRATION_PROJECTOR_NAMES.programNotifications");
    expect(block).not.toContain("ORCHESTRATION_PROJECTOR_NAMES.ctoAttention");
    expect(block).not.toContain("ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals");
    expect(block).not.toContain("ORCHESTRATION_PROJECTOR_NAMES.orchestratorWakes");
    expect(block).not.toContain("program.");
    expect(block).not.toContain("thread.orchestrator-wake-upserted");
    expect(block).not.toContain("thread.approval-response-requested");
  });

  it("uses owner-backed truth for vxapp-backed query paths", () => {
    for (const relativePath of [
      "src/orchestration/Layers/ProjectionSnapshotQuery.ts",
      "src/orchestration/Layers/ProjectionOperationalQuery.ts",
      "src/orchestration/Layers/ProjectionBootstrapSummaryQuery.ts",
    ]) {
      const source = read(relativePath);
      expect(source).toContain("controlPlane.getSnapshot({})");
      expect(source).toContain("getNotificationSummaryExport()");
      expect(source).toContain("AgentsVxappControlPlane");
      expect(source).toMatch(
        /ownerPrograms\s*\?\?|ownerSnapshot\.programs\.map\(mapOwnerProgram\)/,
      );
    }
  });

  it("does not expose local wake rows as vxapp-backed current truth", () => {
    expect(read("src/orchestration/Layers/ProjectionSnapshotQuery.ts")).toContain(
      "vxappBackedProjectRows.length > 0 ? [] : orchestratorWakeRows",
    );
    expect(read("src/orchestration/Layers/ProjectionBootstrapSummaryQuery.ts")).toContain(
      "const orchestratorWakeItems: ReadonlyArray<OrchestratorWakeItem> = vxappBacked",
    );
  });

  it("limits cutover surfaces to AGENTS_VXAPP_ROOT path transport when touching sqlite lineage helpers", () => {
    for (const relativePath of [
      "src/orchestration/Layers/ProjectionSnapshotQuery.ts",
      "src/orchestration/Layers/ProjectionOperationalQuery.ts",
      "src/orchestration/Layers/ProjectionBootstrapSummaryQuery.ts",
    ]) {
      const source = read(relativePath);
      const importMatch = source.match(
        /import\s*\{([^}]+)\}\s*from\s*["'][^"']*agentsVxappSqlite\.ts["']/m,
      );

      expect(
        importMatch?.[1]
          ?.split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      ).toEqual(["AGENTS_VXAPP_ROOT"]);
    }
  });
});
