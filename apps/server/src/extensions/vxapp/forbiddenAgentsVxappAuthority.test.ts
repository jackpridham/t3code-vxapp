import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const ownerClientRelativePath = "apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts";
const ownerClientPath = path.resolve(repoRoot, ownerClientRelativePath);
const scanRoots = [
  "apps/server/src/extensions/vxapp",
  "apps/server/src/orchestration",
  "apps/server/src/agentRuntime",
  "apps/server/src/workerRuntime",
  "apps/web/src/features/vxapp",
  "apps/web/src/components/sidebar",
] as const;

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    if (!entry.isFile()) {
      return [];
    }
    if (!(fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
      return [];
    }
    if (fullPath.endsWith(".test.ts") || fullPath.endsWith(".test.tsx")) {
      return [];
    }
    return [fullPath];
  });
}

function relativeToRepoRoot(filePath: string): string {
  return path.relative(repoRoot, filePath);
}

function collectViolations(filePath: string, source: string) {
  const relativePath = relativeToRepoRoot(filePath);
  const violations: Array<{ category: string; relativePath: string }> = [];

  if (
    filePath !== ownerClientPath &&
    (/--compatibility-mode/.test(source) || /["'](?<![a-z0-9-])t3code-[a-z0-9-]+["']/.test(source))
  ) {
    violations.push({
      category: "compatibility-mode usage or owner command literals outside the owner client",
      relativePath,
    });
  }

  const sqliteImportMatch = source.match(
    /import\s*\{([^}]+)\}\s*from\s*["'][^"']*agentsVxappRepoRoot\.ts["']/m,
  );
  if (sqliteImportMatch) {
    const importedNames = sqliteImportMatch[1]!
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const disallowedImports = importedNames.filter((name) => name !== "AGENTS_VXAPP_REPO_ROOT");
    if (disallowedImports.length > 0) {
      violations.push({
        category: "direct agents-vxapp SQLite reads from cutover surfaces",
        relativePath,
      });
    }
  }

  const directTodoJsonIo =
    /\b(?:readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|Bun\.file)\b[\s\S]{0,240}(?:todo|todos)[^"'`\n]*\.json/im.test(
      source,
    ) ||
    /["'`](?:[^"'`\n]*\/)?(?:todo|todos)[^"'`\n]*\.json["'`][\s\S]{0,120}\b(?:readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile)\b/im.test(
      source,
    );
  if (directTodoJsonIo) {
    violations.push({
      category: "direct TODO JSON file reads or writes from cutover surfaces",
      relativePath,
    });
  }

  const directCloseoutSidecarIo =
    /\b(?:readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|Bun\.file)\b[\s\S]{0,240}closeout/im.test(
      source,
    ) ||
    /closeout[\s\S]{0,160}\b(?:readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|Bun\.file)\b/im.test(
      source,
    );
  if (directCloseoutSidecarIo) {
    violations.push({
      category: "direct closeout sidecar reads from cutover surfaces",
      relativePath,
    });
  }

  const directRuntimeMetadataIo =
    /\b(?:readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|Bun\.file)\b[\s\S]{0,320}(?:context-plan\.json|dispatch-contract\.json|installed-packs\.json|instruction-stack-audit\.json)/im.test(
      source,
    ) ||
    /(?:context-plan\.json|dispatch-contract\.json|installed-packs\.json|instruction-stack-audit\.json)[\s\S]{0,160}\b(?:readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|Bun\.file)\b/im.test(
      source,
    );
  if (directRuntimeMetadataIo) {
    violations.push({
      category: "direct runtime metadata file reads for agent or worker runtime snapshots",
      relativePath,
    });
  }

  if (
    /from\s+["'][^"']*localThreadErrorPresentation\.ts["']/.test(source) &&
    !relativePath.endsWith("ProviderRuntimeIngestion.ts") &&
    !relativePath.endsWith("ProviderCommandReactor.ts") &&
    !relativePath.endsWith("ProjectionBootstrapSummaryQuery.ts") &&
    !relativePath.endsWith("ProjectionOperationalQuery.ts") &&
    !relativePath.endsWith("ProjectionSnapshotQuery.ts")
  ) {
    violations.push({
      category: "local active-error recomputation for vxapp-backed threads",
      relativePath,
    });
  }

  if (
    /startsWith\(AGENTS_VXAPP_REPO_ROOT\)/.test(source) ||
    (filePath !== ownerClientPath && /from\s+["'][^"']*agentsVxappRepoRoot\.ts["']/.test(source))
  ) {
    violations.push({
      category: "repo-root-prefix vxapp classification on cutover surfaces",
      relativePath,
    });
  }

  return violations;
}

describe("forbidden agents-vxapp authority sources", () => {
  it("keeps cutover surfaces free of forbidden legacy authority paths", () => {
    const violations = scanRoots.flatMap((relativeRoot) =>
      listSourceFiles(path.resolve(repoRoot, relativeRoot)).flatMap((filePath) =>
        collectViolations(filePath, fs.readFileSync(filePath, "utf8")),
      ),
    );

    assert.deepStrictEqual(violations, []);
  });
});
