import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

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
    const snapshotQuerySource = read("src/orchestration/Layers/ProjectionSnapshotQuery.ts");
    expect(snapshotQuerySource).toContain("controlPlane.getProgramsAuthoritySnapshot()");
    expect(snapshotQuerySource).toContain("getNotificationSummaryExport()");
    expect(snapshotQuerySource).toContain("getRuntimePaths()");
    expect(snapshotQuerySource).toContain("AgentsVxappControlPlane");
    expect(snapshotQuerySource).toContain("ownerSnapshot.programs.map(mapOwnerProgram)");

    for (const relativePath of [
      "src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts",
      "src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts",
    ]) {
      const source = read(relativePath);
      expect(source).toContain("controlPlane.getProgramsAuthoritySnapshot()");
      expect(source).toContain("getNotificationSummaryExport()");
      expect(source).toContain("getRuntimePaths()");
      expect(source).toContain("AgentsVxappControlPlane");
      expect(source).toContain("ownerSnapshot.programs.map(mapOwnerProgram)");
      expect(source).toContain(
        "vxapp projection boundary requires external role authority runtime paths.",
      );
    }
  });

  it("does not expose local wake rows as vxapp-backed current truth", () => {
    expect(read("src/orchestration/Layers/ProjectionSnapshotQuery.ts")).toMatch(
      /vxappBackedProjectRows\.length > 0\s*\?\s*\[\]\s*:\s*orchestratorWakeRows/,
    );
    expect(read("src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts")).toMatch(
      /const orchestratorWakeItems: ReadonlyArray<OrchestratorWakeItem> =[\s\S]*vxappBacked[\s\S]*\?\s*\[\]/,
    );
  });

  it("uses the runtime-path helper instead of repo-root prefix classification", () => {
    for (const relativePath of [
      "src/orchestration/Layers/ProjectionSnapshotQuery.ts",
      "src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts",
      "src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts",
    ]) {
      const source = read(relativePath);
      expect(source).toContain("agentsVxappAuthorityPaths.ts");
      expect(source).not.toContain("AGENTS_VXAPP_REPO_ROOT");
      expect(source).not.toContain("startsWith(AGENTS_VXAPP_REPO_ROOT)");
    }
  });
});
