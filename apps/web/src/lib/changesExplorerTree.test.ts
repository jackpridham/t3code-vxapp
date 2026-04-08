import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildChangesExplorerTree } from "./changesExplorerTree";

describe("buildChangesExplorerTree", () => {
  it("keeps section roots in fixed order and nests directories before files", () => {
    const tree = buildChangesExplorerTree(
      [
        {
          section: "files_changed",
          label: "Files Changed",
          items: [
            {
              rawRef: "/repo/src/components/Button.tsx",
              resolvedPath: "/repo/src/components/Button.tsx",
              filename: "Button.tsx",
              section: "files_changed",
              firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
            },
            {
              rawRef: "/repo/src/lib/utils.ts",
              resolvedPath: "/repo/src/lib/utils.ts",
              filename: "utils.ts",
              section: "files_changed",
              firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
            },
            {
              rawRef: "/repo/README.md",
              resolvedPath: "/repo/README.md",
              filename: "README.md",
              section: "files_changed",
              firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
            },
          ],
        },
        {
          section: "plans",
          label: "Plans",
          items: [],
        },
      ],
      {
        basePath: "/repo",
      },
    );

    expect(tree.map((node) => node.section)).toEqual(["plans", "files_changed"]);
    const filesChanged = tree.find((node) => node.section === "files_changed");
    expect(filesChanged?.children).toHaveLength(2);
    expect(filesChanged?.children[0]?.kind).toBe("directory");
    expect(filesChanged?.children[0]).toMatchObject({
      kind: "directory",
      name: "src",
      path: "src",
    });

    const srcDirectory = filesChanged?.children[0];
    if (!srcDirectory || srcDirectory.kind !== "directory") {
      throw new Error("Expected a src directory node.");
    }

    expect(srcDirectory.children[0]).toMatchObject({
      kind: "directory",
      name: "components",
      path: "src/components",
    });
    expect(srcDirectory.children[1]).toMatchObject({
      kind: "directory",
      name: "lib",
      path: "src/lib",
    });
    expect(filesChanged?.children[1]).toMatchObject({
      kind: "file",
      name: "README.md",
      path: "/repo/README.md",
    });
  });

  it("attaches per-file stats and aggregates them into directories", () => {
    const tree = buildChangesExplorerTree(
      [
        {
          section: "files_changed",
          label: "Files Changed",
          items: [
            {
              rawRef: "/repo/src/index.ts",
              resolvedPath: "/repo/src/index.ts",
              filename: "index.ts",
              section: "files_changed",
              firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
            },
          ],
        },
      ],
      {
        basePath: "/repo",
        fileStatsByPath: new Map([["/repo/src/index.ts", { additions: 4, deletions: 2 }]]),
      },
    );

    const filesChanged = tree[0];
    if (!filesChanged) {
      throw new Error("Expected files_changed section.");
    }
    const srcDirectory = filesChanged.children[0];
    if (!srcDirectory || srcDirectory.kind !== "directory") {
      throw new Error("Expected a src directory node.");
    }
    const fileNode = srcDirectory.children[0];
    expect(fileNode).toMatchObject({
      kind: "file",
      stat: { additions: 4, deletions: 2 },
    });
    expect(srcDirectory.stat).toEqual({ additions: 4, deletions: 2 });
    expect(filesChanged.stat).toEqual({ additions: 4, deletions: 2 });
  });
});
