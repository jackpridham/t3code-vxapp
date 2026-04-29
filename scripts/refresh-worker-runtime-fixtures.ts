import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type RuntimeSnapshotFiles = {
  "context-plan.json": unknown;
  "dispatch-contract.json": unknown;
  "installed-packs.json": unknown;
  "instruction-stack-audit.json": unknown;
};

type FixtureCatalogEntry = {
  allowedCapabilitiesCount: number;
  auditStatus: string | null;
  closeoutAuthority: string | null;
  contextMode: string | null;
  fixtureId: string;
  forbiddenCapabilitiesCount: number;
  packCount: number;
  repo: string | null;
  selectedPackCount: number;
  sourceWorktree: string;
  taskClass: string | null;
};

const FIXTURE_FILE_NAMES = [
  "context-plan.json",
  "dispatch-contract.json",
  "installed-packs.json",
  "instruction-stack-audit.json",
] as const;

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(repoRoot, "apps/web/src/lib/workerRuntime/__fixtures__");
const snapshotsRoot = path.join(outputRoot, "snapshots");
const defaultSourceRoot = path.join(os.homedir(), "worktrees");
const sourceRoot = path.resolve(process.argv[2] ?? defaultSourceRoot);
const redactedSourceRoot = sourceRoot === defaultSourceRoot ? "~/worktrees" : sourceRoot;

function sanitizeFixtureId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asStringArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string").length : 0;
}

function deepRedactValue(value: unknown, fromRoot: string, toRoot: string): unknown {
  if (typeof value === "string") {
    return value.startsWith(fromRoot) ? value.replace(fromRoot, toRoot) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepRedactValue(entry, fromRoot, toRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        deepRedactValue(nested, fromRoot, toRoot),
      ]),
    );
  }
  return value;
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function findRuntimeDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const runtimes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runtimeDir = path.join(root, entry.name, ".agents", "runtime");
        try {
          const stat = await fs.stat(runtimeDir);
          return stat.isDirectory() ? runtimeDir : null;
        } catch {
          return null;
        }
      }),
  );
  return runtimes.filter((value): value is string => value !== null).toSorted();
}

async function main() {
  const runtimeDirs = await findRuntimeDirectories(sourceRoot);
  await fs.rm(outputRoot, { force: true, recursive: true });
  await fs.mkdir(snapshotsRoot, { recursive: true });

  const catalog: FixtureCatalogEntry[] = [];

  for (const runtimeDir of runtimeDirs) {
    const worktreeRoot = path.dirname(path.dirname(runtimeDir));
    const worktreeName = path.basename(worktreeRoot);
    const fixtureId = sanitizeFixtureId(worktreeName);
    const redactedRoot = `/fixtures/worktrees/${fixtureId}`;
    const snapshotDir = path.join(snapshotsRoot, fixtureId);

    const files = Object.fromEntries(
      await Promise.all(
        FIXTURE_FILE_NAMES.map(async (fileName) => [
          fileName,
          await readJson(path.join(runtimeDir, fileName)),
        ]),
      ),
    ) as RuntimeSnapshotFiles;

    const redactedFiles = Object.fromEntries(
      Object.entries(files).map(([fileName, value]) => [
        fileName,
        deepRedactValue(value, worktreeRoot, redactedRoot),
      ]),
    ) as RuntimeSnapshotFiles;

    await fs.mkdir(snapshotDir, { recursive: true });
    for (const [fileName, value] of Object.entries(redactedFiles)) {
      await fs.writeFile(
        path.join(snapshotDir, fileName),
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
    }

    const contextPlan = redactedFiles["context-plan.json"] as Record<string, unknown>;
    const dispatchContract = redactedFiles["dispatch-contract.json"] as Record<string, unknown>;
    const installedPacks = redactedFiles["installed-packs.json"] as Record<string, unknown>;
    const audit = redactedFiles["instruction-stack-audit.json"] as Record<string, unknown>;

    catalog.push({
      allowedCapabilitiesCount: asStringArrayLength(dispatchContract.allowedCapabilities),
      auditStatus: asString(audit.status),
      closeoutAuthority:
        asString(contextPlan.closeoutAuthority) ??
        asString(dispatchContract.closeoutAuthority) ??
        asString(installedPacks.closeoutAuthority),
      contextMode:
        asString(contextPlan.contextMode) ??
        asString(dispatchContract.contextMode) ??
        asString(installedPacks.contextMode),
      fixtureId,
      forbiddenCapabilitiesCount: asStringArrayLength(dispatchContract.forbiddenCapabilities),
      packCount: Array.isArray(installedPacks.packs) ? installedPacks.packs.length : 0,
      repo:
        asString(contextPlan.repo) ??
        asString(dispatchContract.repo) ??
        asString(installedPacks.repo),
      selectedPackCount:
        asStringArrayLength(dispatchContract.selectedPacks) ||
        asStringArrayLength(contextPlan.selectedPacks),
      sourceWorktree: worktreeName,
      taskClass:
        asString(contextPlan.taskClass) ??
        asString(dispatchContract.taskClass) ??
        asString(installedPacks.taskClass),
    });
  }

  catalog.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
  await fs.writeFile(
    path.join(outputRoot, "catalog.json"),
    `${JSON.stringify({ sourceRoot: redactedSourceRoot, fixtures: catalog }, null, 2)}\n`,
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
