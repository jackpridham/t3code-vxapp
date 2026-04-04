import { describe, expect, it } from "vitest";

import {
  extractArtifactLinks,
  extractTitleFromMarkdown,
  titleFromFilename,
} from "./artifactDiscovery";

// ── extractArtifactLinks ──────────────────────────────────────────────────────

describe("extractArtifactLinks", () => {
  it("extracts file:/// URLs ending in .md", () => {
    const text = "See file:///home/user/repo/@Docs/@Scratch/myrepo/report.md for details.";
    expect(extractArtifactLinks(text)).toContain(
      "file:///home/user/repo/@Docs/@Scratch/myrepo/report.md",
    );
  });

  it("extracts @Docs/@Scratch bare paths", () => {
    const text = "Artifact written to @Docs/@Scratch/myrepo/plan.md.";
    expect(extractArtifactLinks(text)).toContain("@Docs/@Scratch/myrepo/plan.md");
  });

  it("extracts markdown link targets ending in .md", () => {
    const text = "Check out [the plan](@Docs/@Scratch/myrepo/plan.md) now.";
    expect(extractArtifactLinks(text)).toContain("@Docs/@Scratch/myrepo/plan.md");
  });

  it("deduplicates identical links", () => {
    const text = [
      "@Docs/@Scratch/repo/a.md",
      "@Docs/@Scratch/repo/a.md",
      "[link](@Docs/@Scratch/repo/a.md)",
    ].join("\n");
    const links = extractArtifactLinks(text);
    expect(links.filter((l) => l === "@Docs/@Scratch/repo/a.md")).toHaveLength(1);
  });

  it("ignores non-.md file URLs", () => {
    const text = "file:///home/user/repo/README.txt and file:///home/user/repo/code.ts";
    expect(extractArtifactLinks(text)).toHaveLength(0);
  });

  it("ignores plain https:// URLs", () => {
    const text = "See https://example.com/docs/report.md for context.";
    // file:// pattern doesn't match https:// — no results
    const links = extractArtifactLinks(text);
    expect(links.every((l) => !l.startsWith("http"))).toBe(true);
  });

  it("handles empty input", () => {
    expect(extractArtifactLinks("")).toHaveLength(0);
  });

  it("handles multiple different artifacts", () => {
    const text = [
      "file:///home/user/repo/@Docs/@Scratch/repo/report1.md",
      "@Docs/@Scratch/repo/report2.md",
      "[plan](@Docs/@Scratch/repo/plan.md)",
    ].join("\n");
    const links = extractArtifactLinks(text);
    // 4 unique strings: full file:// URL, bare @Docs path from inside the URL,
    // the second bare path, and the markdown link target (deduplicated with bare)
    expect(links).toHaveLength(4);
    expect(links).toContain("file:///home/user/repo/@Docs/@Scratch/repo/report1.md");
    expect(links).toContain("@Docs/@Scratch/repo/report1.md");
    expect(links).toContain("@Docs/@Scratch/repo/report2.md");
    expect(links).toContain("@Docs/@Scratch/repo/plan.md");
  });
});

// ── extractTitleFromMarkdown ──────────────────────────────────────────────────

describe("extractTitleFromMarkdown", () => {
  it("returns the first # heading", () => {
    const content = "# My Report\n\nSome content here.";
    expect(extractTitleFromMarkdown(content, "my-report.md")).toBe("My Report");
  });

  it("falls back to filename when no heading present", () => {
    const content = "Just some text without a heading.";
    expect(extractTitleFromMarkdown(content, "my-report.md")).toBe("My Report");
  });

  it("ignores ## sub-headings when # is absent", () => {
    const content = "## Sub Heading\n\nContent.";
    expect(extractTitleFromMarkdown(content, "fallback-title.md")).toBe("Fallback Title");
  });

  it("skips blank lines before the heading", () => {
    const content = "\n\n# Real Title\n\nContent.";
    expect(extractTitleFromMarkdown(content, "fallback.md")).toBe("Real Title");
  });

  it("stops at first non-blank non-heading line", () => {
    const content = "First paragraph without heading.\n\n# Not used";
    expect(extractTitleFromMarkdown(content, "fallback.md")).toBe("Fallback");
  });

  it("handles empty content gracefully", () => {
    expect(extractTitleFromMarkdown("", "plan.md")).toBe("Plan");
  });
});

// ── titleFromFilename ─────────────────────────────────────────────────────────

describe("titleFromFilename", () => {
  it("strips .md extension", () => {
    expect(titleFromFilename("report.md")).toBe("Report");
  });

  it("converts hyphens to spaces and title-cases", () => {
    expect(titleFromFilename("my-awesome-plan.md")).toBe("My Awesome Plan");
  });

  it("converts underscores to spaces and title-cases", () => {
    expect(titleFromFilename("phase_d_implementation.md")).toBe("Phase D Implementation");
  });

  it("handles filename without extension", () => {
    expect(titleFromFilename("REPORT")).toBe("REPORT");
  });

  it("handles mixed separators", () => {
    expect(titleFromFilename("my_great-feature.md")).toBe("My Great Feature");
  });
});
