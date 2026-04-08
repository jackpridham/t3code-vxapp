import { describe, expect, it } from "vitest";

import { parseCodeDiffMarkers } from "./codeDiffMarkers";

describe("parseCodeDiffMarkers", () => {
  it("marks pure additions as added line numbers", () => {
    const patch = `
diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,2 +1,4 @@
 const first = 1;
 const second = 2;
+const third = 3;
+const fourth = 4;
`;

    const result = parseCodeDiffMarkers({
      patch,
      path: "src/example.ts",
    });

    expect(result.status).toBe("ready");
    expect(Array.from(result.markers.entries())).toEqual([
      [3, "added"],
      [4, "added"],
    ]);
  });

  it("marks replacement hunks as modified line numbers", () => {
    const patch = `
diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 const first = 1;
-const second = 2;
-const third = 3;
+const second = 20;
+const third = 30;
`;

    const result = parseCodeDiffMarkers({
      patch,
      path: "src/example.ts",
    });

    expect(result.status).toBe("ready");
    expect(Array.from(result.markers.entries())).toEqual([
      [2, "modified"],
      [3, "modified"],
    ]);
  });

  it("returns a deleted status for deleted-only files", () => {
    const patch = `
diff --git a/src/example.ts b/src/example.ts
deleted file mode 100644
index 2222222..0000000
--- a/src/example.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const first = 1;
-const second = 2;
`;

    const result = parseCodeDiffMarkers({
      patch,
      path: "src/example.ts",
    });

    expect(result).toEqual({
      status: "deleted",
      markers: new Map(),
    });
  });

  it("returns an empty ready state for rename-only diffs with no hunks", () => {
    const patch = `
diff --git a/src/example.ts b/src/renamed.ts
similarity index 100%
rename from src/example.ts
rename to src/renamed.ts
`;

    const result = parseCodeDiffMarkers({
      patch,
      path: "src/renamed.ts",
    });

    expect(result).toEqual({
      status: "ready",
      markers: new Map(),
    });
  });

  it("returns unrenderable when no parsed file matches the requested path", () => {
    const result = parseCodeDiffMarkers({
      patch: "@@ not a valid patch @@",
      path: "src/example.ts",
    });

    expect(result.status).toBe("unrenderable");
    if (result.status !== "unrenderable") {
      throw new Error("Expected unrenderable result.");
    }
    expect(result.reason).toContain("No parsed file matched");
  });
});
