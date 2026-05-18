import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "ProjectionOperationalQuery.ts"), "utf8");

describe("ProjectionOperationalQuery authority boundary", () => {
  it("uses owner-backed current Program, notification, attention, and binding truth for vxapp rows", () => {
    expect(source).toContain("controlPlane.getSnapshot({})");
    expect(source).toContain("controlPlane.getNotificationSummaryExport()");
    expect(source).toContain("controlPlane.getAttentionSummaryExport()");
    expect(source).toContain("getRuntimePaths()");
    expect(source).toContain("getBindingAuthorityForVxappProjectRows");
    expect(source).toContain("programs = ownerSnapshot.programs.map(mapOwnerProgram)");
    expect(source).toContain(
      "vxapp projection boundary requires external role authority runtime paths.",
    );
  });

  it("keeps local Program repository reads inside the non-vxapp branch", () => {
    const vxappBranch = source.slice(
      source.indexOf("if (vxappBacked)"),
      source.indexOf("} else {", source.indexOf("if (vxappBacked)")),
    );
    expect(vxappBranch).not.toContain("listProgramRows");
  });
});
