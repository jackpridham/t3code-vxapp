import { describe, expect, it } from "vitest";
import { parseGitmodules } from "./submoduleDiscovery";

describe("parseGitmodules", () => {
  it("parses a single submodule", () => {
    const content = `[submodule "@Docs"]
\tpath = @Docs
\turl = git@github.com:user/kb-vxapp.git
\tbranch = main
`;
    const entries = parseGitmodules(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      name: "@Docs",
      path: "@Docs",
      url: "git@github.com:user/kb-vxapp.git",
    });
  });

  it("parses multiple submodules", () => {
    const content = `[submodule "@Docs"]
\tpath = @Docs
\turl = git@github.com:user/kb-vxapp.git
\tbranch = main

[submodule "stores-vxapp"]
\tpath = src/stores-vxapp
\turl = git@github.com:user/stores-vxapp.git
`;
    const entries = parseGitmodules(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe("@Docs");
    expect(entries[0]?.path).toBe("@Docs");
    expect(entries[1]?.name).toBe("stores-vxapp");
    expect(entries[1]?.path).toBe("src/stores-vxapp");
  });

  it("returns empty array for empty content", () => {
    expect(parseGitmodules("")).toHaveLength(0);
  });

  it("returns empty array for malformed content", () => {
    expect(parseGitmodules("not a gitmodules file")).toHaveLength(0);
  });

  it("skips submodules without a path", () => {
    const content = `[submodule "broken"]
\turl = git@github.com:user/broken.git
`;
    const entries = parseGitmodules(content);
    expect(entries).toHaveLength(0);
  });

  it("handles Windows-style line endings", () => {
    const content = `[submodule "@Docs"]\r\n\tpath = @Docs\r\n\turl = git@github.com:user/kb.git\r\n`;
    const entries = parseGitmodules(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("@Docs");
  });

  it("handles submodule without URL", () => {
    const content = `[submodule "local-only"]
\tpath = lib/local
`;
    const entries = parseGitmodules(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("local-only");
    expect(entries[0]?.path).toBe("lib/local");
    expect(entries[0]?.url).toBeUndefined();
  });

  it("handles spaces around equals sign", () => {
    const content = `[submodule "spaced"]
\tpath = vendor/lib
\turl = https://github.com/org/lib.git
`;
    const entries = parseGitmodules(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("vendor/lib");
  });
});
