import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionSnapshotQuery.ts"), "utf8");

describe("ProjectionSnapshotQuery authority boundary", () => {
  it("consumes owner-backed Program, notification, attention, and binding truth for vxapp rows", () => {
    expect(source).toContain("controlPlane.getSnapshot({})");
    expect(source).toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("controlPlane.getAttentionSummaryExport()");
    expect(source).toContain("getBindingAuthorityForVxappProjects");
    expect(source).toContain("ownerPrograms ??");
  });

  it("does not expose local wake rows as vxapp-backed current truth", () => {
    expect(source).toContain("vxappBackedProjectRows.length > 0 ? [] : orchestratorWakeRows");
    expect(source).toContain(
      "vxappBackedProjectRows.length > 0 ? 0 : orchestratorWakeCountRow.count",
    );
  });
});
