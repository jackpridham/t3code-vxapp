import { afterEach, describe, expect, it, vi } from "vitest";

import {
  artifactRecordMeta,
  findArtifactBySlug,
  refreshArtifactPreloadCache,
} from "./artifactPreloadCache";
import {
  getScratchArtifactPathParts,
  isScratchArtifactPath,
  resolveScratchArtifactHref,
} from "./scratchArtifactLinks";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scratch artifact link helpers", () => {
  it("recognizes markdown artifacts inside an exact @Scratch segment", () => {
    expect(isScratchArtifactPath("/repo/@Docs/@Scratch/slave/report.md")).toBe(true);
    expect(isScratchArtifactPath("@Docs/@Scratch/slave/report.md:12")).toBe(true);
    expect(isScratchArtifactPath("/repo/@Docs/not@Scratch/slave/report.md")).toBe(false);
    expect(isScratchArtifactPath("/repo/@Docs/@Scratchy/slave/report.md")).toBe(false);
    expect(isScratchArtifactPath("/repo/@Docs/@Scratch/slave/report.txt")).toBe(false);
  });

  it("extracts the target id from the segment after @Scratch", () => {
    expect(getScratchArtifactPathParts("/repo/@Docs/@Scratch/slave/report.md")).toEqual({
      targetId: "slave",
      filename: "report.md",
      suffix: "@Scratch/slave/report.md",
    });
  });

  it("builds a detail href from the artifact filename when no cache match exists", () => {
    expect(
      resolveScratchArtifactHref(
        "/repo/@Docs/@Scratch/slave/mediawiki-knowledge-base-feature-design.md",
      ),
    ).toBe("/artifacts/slave/mediawiki-knowledge-base-feature-design");
  });

  it("uses cached artifact metadata for the detail slug when the path matches", () => {
    vi.stubGlobal("window", {
      localStorage: new MemoryStorage(),
    });

    refreshArtifactPreloadCache(
      { target_id: "slave" },
      {
        target_id: "slave",
        fetched_at: "2026-04-21T00:00:00.000Z",
        total_results: 1,
        artifacts: [
          {
            title: "MediaWiki Knowledge Base Feature Design",
            path: "@Docs/@Scratch/slave/mediawiki-kb.md",
          },
        ],
      },
    );

    expect(resolveScratchArtifactHref("/repo/@Docs/@Scratch/slave/mediawiki-kb.md")).toBe(
      "/artifacts/slave/mediawiki-knowledge-base-feature-design",
    );
  });

  it("matches filename-derived route slugs against catalog paths without the markdown extension", () => {
    const artifact = {
      title: "Different Human Title",
      path: "@Docs/@Scratch/slave/mediawiki-kb.md",
    };

    expect(findArtifactBySlug({ artifacts: [artifact], artifactTitle: "mediawiki-kb" })).toBe(
      artifact,
    );
    expect(artifactRecordMeta({ path: "@Docs/@Scratch/slave/mediawiki-kb.md" }).slug).toBe(
      "mediawiki-kb",
    );
  });
});
