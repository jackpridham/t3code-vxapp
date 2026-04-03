import fsPromises from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, afterEach, describe, expect, vi } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, PlatformError } from "effect";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceEntriesLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-workspace-entries-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.fn(function* (opts?: { prefix?: string; git?: boolean }) {
  const fileSystem = yield* FileSystem.FileSystem;
  const gitCore = yield* GitCore;
  const dir = yield* fileSystem.makeTempDirectoryScoped({
    prefix: opts?.prefix ?? "t3code-workspace-entries-",
  });
  if (opts?.git) {
    yield* gitCore.initRepo({ cwd: dir });
  }
  return dir;
});

function writeTextFile(
  cwd: string,
  relativePath: string,
  contents = "",
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, contents);
  });
}

const git = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const result = yield* gitCore.execute({
      operation: "WorkspaceEntries.test.git",
      cwd,
      args,
      ...(env ? { env } : {}),
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const searchWorkspaceEntries = (input: {
  cwd: string;
  query: string;
  limit: number;
  includeIgnored?: boolean;
}) =>
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries;
    return yield* workspaceEntries.search({
      ...input,
      includeIgnored: input.includeIgnored ?? false,
    });
  });

it.layer(TestLayer)("WorkspaceEntriesLive", (it) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("search", () => {
    it.effect("returns files and directories relative to cwd", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir();
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/index.ts");
        yield* writeTextFile(cwd, "README.md");
        yield* writeTextFile(cwd, ".git/HEAD");
        yield* writeTextFile(cwd, "node_modules/pkg/index.js");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/components");
        expect(paths).toContain("src/components/Composer.tsx");
        expect(paths).toContain("README.md");
        expect(paths.some((entryPath) => entryPath.startsWith(".git"))).toBe(false);
        expect(paths.some((entryPath) => entryPath.startsWith("node_modules"))).toBe(false);
        expect(result.truncated).toBe(false);
      }),
    );

    it.effect("filters and ranks entries by query", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-query-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/components/composePrompt.ts");
        yield* writeTextFile(cwd, "docs/composition.md");

        const result = yield* searchWorkspaceEntries({ cwd, query: "compo", limit: 5 });

        expect(result.entries.length).toBeGreaterThan(0);
        expect(result.entries.some((entry) => entry.path === "src/components")).toBe(true);
        expect(result.entries.every((entry) => entry.path.toLowerCase().includes("compo"))).toBe(
          true,
        );
      }),
    );

    it.effect("supports fuzzy subsequence queries for composer path search", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-fuzzy-query-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/components/composePrompt.ts");
        yield* writeTextFile(cwd, "docs/composition.md");

        const result = yield* searchWorkspaceEntries({ cwd, query: "cmp", limit: 10 });
        const paths = result.entries.map((entry) => entry.path);

        expect(result.entries.length).toBeGreaterThan(0);
        expect(paths).toContain("src/components");
        expect(paths).toContain("src/components/Composer.tsx");
      }),
    );

    it.effect("tracks truncation without sorting every fuzzy match", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-fuzzy-limit-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");
        yield* writeTextFile(cwd, "src/components/composePrompt.ts");
        yield* writeTextFile(cwd, "docs/composition.md");

        const result = yield* searchWorkspaceEntries({ cwd, query: "cmp", limit: 1 });

        expect(result.entries).toHaveLength(1);
        expect(result.truncated).toBe(true);
      }),
    );

    it.effect("excludes gitignored paths for git repositories", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-gitignore-", git: true });
        yield* writeTextFile(cwd, ".gitignore", ".convex/\nconvex/\nignored.txt\n");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");
        yield* writeTextFile(cwd, "ignored.txt", "ignore me");
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");
        yield* writeTextFile(cwd, "convex/UOoS-l/convex_local_storage/modules/data.json", "{}");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths).not.toContain("ignored.txt");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
        expect(paths.some((entryPath) => entryPath.startsWith("convex/"))).toBe(false);
      }),
    );

    it.effect("excludes tracked paths that match ignore rules", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({
          prefix: "t3code-workspace-tracked-gitignore-",
          git: true,
        });
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");
        yield* git(cwd, ["add", ".convex/local-storage/data.json", "src/keep.ts"]);
        yield* writeTextFile(cwd, ".gitignore", ".convex/\n");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
      }),
    );

    it.effect("includes gitignored files when requested but still hides blocked directories", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({
          prefix: "t3code-workspace-include-gitignore-",
          git: true,
        });
        yield* writeTextFile(cwd, ".gitignore", ".convex/\nignored.txt\nnested/\n");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");
        yield* writeTextFile(cwd, "ignored.txt", "ignore me");
        yield* writeTextFile(cwd, "nested/file.ts", "export const nested = true;");
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");

        const result = yield* searchWorkspaceEntries({
          cwd,
          query: "",
          limit: 100,
          includeIgnored: true,
        });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths).toContain("ignored.txt");
        expect(paths).toContain("nested");
        expect(paths).toContain("nested/file.ts");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
      }),
    );

    it.effect("excludes .convex in non-git workspaces", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-non-git-convex-" });
        yield* writeTextFile(cwd, ".convex/local-storage/data.json", "{}");
        yield* writeTextFile(cwd, "src/keep.ts", "export {};");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("src");
        expect(paths).toContain("src/keep.ts");
        expect(paths.some((entryPath) => entryPath.startsWith(".convex/"))).toBe(false);
      }),
    );

    it.effect(
      "indexes symlinked directories as directories with searchable contents (non-git)",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;

          // Simulate a global skill directory living outside the workspace
          const externalSkillDir = yield* makeTempDir({
            prefix: "t3code-workspace-symlink-target-",
          });
          yield* writeTextFile(externalSkillDir, "find-skills/SKILL.md", "# Find skills");
          yield* writeTextFile(externalSkillDir, "find-skills/helpers.ts", "export {};");

          // Workspace with a symlink pointing to the external skill directory
          const cwd = yield* makeTempDir({ prefix: "t3code-workspace-symlink-src-" });
          const symlinkPath = path.join(cwd, "find-skills");
          const targetPath = path.join(externalSkillDir, "find-skills");
          yield* Effect.promise(() => fsPromises.symlink(targetPath, symlinkPath));

          const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
          const entries = result.entries;
          const paths = entries.map((e) => e.path);

          // The symlink itself must be indexed as a directory (not a file)
          const skillEntry = entries.find((e) => e.path === "find-skills");
          expect(skillEntry).toBeDefined();
          expect(skillEntry?.kind).toBe("directory");

          // Contents reachable through the symlink must be indexed
          expect(paths).toContain("find-skills/SKILL.md");
          expect(paths).toContain("find-skills/helpers.ts");
        }),
    );

    it.effect("indexes gitignored symlinked directories when includeIgnored is true (git)", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;

        // External directory acting as the global skill source
        const externalSkillDir = yield* makeTempDir({
          prefix: "t3code-workspace-symlink-gi-target-",
        });
        yield* writeTextFile(externalSkillDir, "SKILL.md", "# My skill");

        // Git workspace with a gitignored symlink pointing to the external skill
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-symlink-gi-src-", git: true });
        yield* writeTextFile(cwd, ".gitignore", "my-skill\n");
        yield* writeTextFile(cwd, "src/index.ts", "export {};");
        const symlinkPath = path.join(cwd, "my-skill");
        yield* Effect.promise(() => fsPromises.symlink(externalSkillDir, symlinkPath));

        // Without includeIgnored the symlink is excluded
        const excluded = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        expect(excluded.entries.map((e) => e.path)).not.toContain("my-skill");

        // With includeIgnored the symlink must appear as a directory
        const included = yield* searchWorkspaceEntries({
          cwd,
          query: "",
          limit: 100,
          includeIgnored: true,
        });
        const skillEntry = included.entries.find((e) => e.path === "my-skill");
        expect(skillEntry?.kind).toBe("directory");
        expect(included.entries.map((e) => e.path)).toContain("my-skill/SKILL.md");
      }),
    );

    it.effect("indexes @-prefixed directories as directories with searchable contents", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-at-dir-fs-" });
        yield* writeTextFile(cwd, "@Docs/README.md", "# Docs");
        yield* writeTextFile(cwd, "@Docs/@Workflows/ci.yml", "steps:");
        yield* writeTextFile(cwd, "src/index.ts", "export {};");

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const entries = result.entries;
        const paths = entries.map((e) => e.path);

        // @Docs must appear as a directory (kind matters for the picker icon)
        const docsEntry = entries.find((e) => e.path === "@Docs");
        expect(docsEntry).toBeDefined();
        expect(docsEntry?.kind).toBe("directory");

        // Nested @-prefixed subdirectory is also a directory
        const workflowsEntry = entries.find((e) => e.path === "@Docs/@Workflows");
        expect(workflowsEntry?.kind).toBe("directory");

        // Contents are fully searchable
        expect(paths).toContain("@Docs/README.md");
        expect(paths).toContain("@Docs/@Workflows/ci.yml");
      }),
    );

    it.effect("indexes git submodule as directory with searchable contents", () =>
      Effect.gen(function* () {
        // Build a local git repo to use as the submodule source
        const submoduleSrc = yield* makeTempDir({
          prefix: "t3code-workspace-submod-src-",
          git: true,
        });
        yield* git(submoduleSrc, ["config", "user.email", "test@test.com"]);
        yield* git(submoduleSrc, ["config", "user.name", "Test"]);
        yield* writeTextFile(submoduleSrc, "README.md", "# Submodule");
        yield* writeTextFile(submoduleSrc, "@Workflows/ci.yml", "steps:");
        yield* git(submoduleSrc, ["add", "."]);
        yield* git(submoduleSrc, ["commit", "-m", "init"]);

        // Build parent repo and add the submodule at @Docs
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-submod-parent-", git: true });
        yield* git(cwd, [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          submoduleSrc,
          "@Docs",
        ]);

        const result = yield* searchWorkspaceEntries({ cwd, query: "", limit: 100 });
        const entries = result.entries;
        const paths = entries.map((e) => e.path);

        // git ls-files lists the submodule as a gitlink; the fix must reclassify it as a directory
        const docsEntry = entries.find((e) => e.path === "@Docs");
        expect(docsEntry?.kind).toBe("directory");

        // Files inside the submodule must be reachable in the index
        expect(paths).toContain("@Docs/README.md");
        expect(paths).toContain("@Docs/@Workflows");
        expect(paths).toContain("@Docs/@Workflows/ci.yml");

        // @-prefix scoring must surface the submodule directory near the top
        // when searching by name without the @ prefix (the normal picker flow)
        const queryResult = yield* searchWorkspaceEntries({ cwd, query: "Docs", limit: 10 });
        const queryPaths = queryResult.entries.map((e) => e.path);
        expect(queryPaths[0]).toBe("@Docs");
      }),
    );

    it.effect("returns @-prefixed directories when searching without @ prefix", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-at-prefix-" });
        yield* writeTextFile(cwd, "@my-org/plugin-a/index.ts");
        yield* writeTextFile(cwd, "@my-org/plugin-b/index.ts");
        yield* writeTextFile(cwd, "src/index.ts");

        // User types "@my-org" in composer; client strips trigger @ and sends "my-org"
        const result = yield* searchWorkspaceEntries({ cwd, query: "my-org", limit: 20 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("@my-org");
        expect(paths).toContain("@my-org/plugin-a");
        expect(paths).toContain("@my-org/plugin-b");
        // @my-org should rank before unrelated entries that merely contain "my-org" as a substring
        const atOrgIndex = paths.indexOf("@my-org");
        expect(atOrgIndex).toBeGreaterThanOrEqual(0);
        expect(atOrgIndex).toBeLessThan(3);
      }),
    );

    it.effect("ranks @-prefixed directory as exact match when query includes @", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-at-exact-" });
        yield* writeTextFile(cwd, "@scope/utils.ts");
        yield* writeTextFile(cwd, "scope-utils/helpers.ts");

        // User types "@@scope" in composer; client strips trigger @ and sends "@scope"
        // normalizeQuery must NOT strip this @, so "@scope" matches exactly
        const result = yield* searchWorkspaceEntries({ cwd, query: "@scope", limit: 20 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("@scope");
        // @scope must rank first — it is an exact name match for query "@scope"
        expect(paths[0]).toBe("@scope");
      }),
    );

    it.effect("returns files inside @-prefixed directories by path query", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-at-files-" });
        yield* writeTextFile(cwd, "packages/@my-org/utils/index.ts");
        yield* writeTextFile(cwd, "packages/other/index.ts");

        const result = yield* searchWorkspaceEntries({ cwd, query: "my-org", limit: 20 });
        const paths = result.entries.map((entry) => entry.path);

        expect(paths).toContain("packages/@my-org");
        expect(paths).toContain("packages/@my-org/utils");
        expect(paths).toContain("packages/@my-org/utils/index.ts");
      }),
    );

    it.effect("deduplicates concurrent index builds for the same cwd", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-concurrent-build-" });
        yield* writeTextFile(cwd, "src/components/Composer.tsx");

        let rootReadCount = 0;
        const originalReaddir = fsPromises.readdir.bind(fsPromises);
        vi.spyOn(fsPromises, "readdir").mockImplementation((async (
          ...args: Parameters<typeof fsPromises.readdir>
        ) => {
          if (args[0] === cwd) {
            rootReadCount += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return originalReaddir(...args);
        }) as typeof fsPromises.readdir);

        yield* Effect.all(
          [
            searchWorkspaceEntries({ cwd, query: "", limit: 100 }),
            searchWorkspaceEntries({ cwd, query: "comp", limit: 100 }),
            searchWorkspaceEntries({ cwd, query: "src", limit: 100 }),
          ],
          { concurrency: "unbounded" },
        );

        expect(rootReadCount).toBe(1);
      }),
    );

    it.effect("limits concurrent directory reads while walking the filesystem", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir({ prefix: "t3code-workspace-read-concurrency-" });
        yield* Effect.forEach(
          Array.from({ length: 80 }, (_, index) => index),
          (index) => writeTextFile(cwd, `group-${index}/entry-${index}.ts`, "export {};"),
          { discard: true },
        );

        let activeReads = 0;
        let peakReads = 0;
        const originalReaddir = fsPromises.readdir.bind(fsPromises);
        vi.spyOn(fsPromises, "readdir").mockImplementation((async (
          ...args: Parameters<typeof fsPromises.readdir>
        ) => {
          const target = args[0];
          if (typeof target === "string" && target.startsWith(cwd)) {
            activeReads += 1;
            peakReads = Math.max(peakReads, activeReads);
            await new Promise((resolve) => setTimeout(resolve, 4));
            try {
              return await originalReaddir(...args);
            } finally {
              activeReads -= 1;
            }
          }
          return originalReaddir(...args);
        }) as typeof fsPromises.readdir);

        yield* searchWorkspaceEntries({ cwd, query: "", limit: 200 });

        expect(peakReads).toBeLessThanOrEqual(32);
      }),
    );
  });
});
