import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionSnapshotQuery.ts"), "utf8");

describe("ProjectionSnapshotQuery authority boundary", () => {
  it("consumes owner-backed Program, notification, attention, and binding truth for vxapp rows", () => {
    expect(source).toContain("controlPlane.getProgramsProjectionSnapshot()");
    expect(source).toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("controlPlane.getAttentionSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toContain("getBindingAuthorityForVxappProjects");
    expect(source).toContain("ownerPrograms ??");
    expect(source).toContain(
      "vxapp projection boundary requires external role authority runtime paths.",
    );
  });

  it("does not expose local wake rows as vxapp-backed current truth", () => {
    expect(source).toMatch(
      /vxappBackedProjectRows\.length > 0\s*\?\s*\[\]\s*:\s*orchestratorWakeRows/,
    );
    expect(source).toMatch(
      /vxappBackedProjectRows\.length > 0\s*\?\s*0\s*:\s*orchestratorWakeCountRow\.count/,
    );
  });
});
