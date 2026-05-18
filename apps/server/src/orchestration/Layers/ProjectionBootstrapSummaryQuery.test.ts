import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, "ProjectionBootstrapSummaryQuery.ts"),
  "utf8",
);

describe("ProjectionBootstrapSummaryQuery authority boundary", () => {
  it("uses owner-backed Program and notification truth for vxapp bootstrap rows", () => {
    expect(source).toContain("controlPlane.getSnapshot({})");
    expect(source).toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toContain("ownerPrograms ??");
    expect(source).toContain(
      "vxapp projection boundary requires external role authority runtime paths.",
    );
  });

  it("does not expose local wake rows as vxapp-backed bootstrap truth", () => {
    expect(source).toMatch(
      /const orchestratorWakeItems: ReadonlyArray<OrchestratorWakeItem> =[\s\S]*vxappBacked[\s\S]*\?\s*\[\]/,
    );
  });
});
