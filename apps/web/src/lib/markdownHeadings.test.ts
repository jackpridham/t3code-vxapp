import { describe, expect, it } from "vitest";

import { buildMarkdownHeadingTree, extractMarkdownHeadings } from "./markdownHeadings";

describe("markdown headings", () => {
  it("extracts ATX headings with unique ids", () => {
    const input = [
      "# Top",
      "## Subheading",
      "### Subheading",
      "```",
      "# Not a heading inside code",
      "```",
      "## Subheading",
    ].join("\n");

    expect(extractMarkdownHeadings(input)).toEqual([
      { id: "top", level: 1, text: "Top" },
      { id: "subheading", level: 2, text: "Subheading" },
      { id: "subheading-1", level: 3, text: "Subheading" },
      { id: "subheading-2", level: 2, text: "Subheading" },
    ]);
  });

  it("builds nested heading trees from heading levels", () => {
    const headings = extractMarkdownHeadings(
      ["# Root", "## Child", "#### Grandchild", "## New Branch", "### Leaf"].join("\n"),
    );

    const tree = buildMarkdownHeadingTree(headings);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.children[0]).toMatchObject({
      level: 4,
      text: "Grandchild",
    });
    expect(tree[0]?.children[1]?.children).toHaveLength(1);
  });
});
