import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { parseYaml } from "../perf/yaml.ts";

interface RepoLinkDefinition {
  readonly selector: string;
  readonly requiredEntrypoints: ReadonlyArray<string>;
  readonly envAliases: ReadonlyArray<string>;
  readonly fallbackSibling: boolean;
}

interface RepoLinksDocument {
  readonly links?: Record<string, unknown> | undefined;
}

interface ResolveRepoLinkInput {
  readonly repoRoot: string;
  readonly selector: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly allowSiblingFallback?: boolean | undefined;
}

export interface ResolvedRepoLink {
  readonly selector: string;
  readonly root: string;
  readonly envAliases: ReadonlyArray<string>;
  readonly envAssignments: Readonly<Record<string, string>>;
  readonly source: string;
}

function canonicalPath(candidate: string): string {
  const resolved = resolvePath(candidate);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseLinkDefinition(selector: string, raw: unknown): RepoLinkDefinition {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const envAliases = asStringArray(record.envAliases).filter((alias) => alias.trim().length > 0);
  if (envAliases.length === 0) {
    throw new Error(
      `Repo-link selector '${selector}' is missing envAliases in .vx/repo-links.yaml.`,
    );
  }

  return {
    selector,
    requiredEntrypoints: asStringArray(record.requiredEntrypoints),
    envAliases,
    fallbackSibling: record.fallbackSibling === true,
  };
}

function loadRepoLinkDefinition(repoRoot: string, selector: string): RepoLinkDefinition {
  const configPath = resolvePath(repoRoot, ".vx/repo-links.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`Missing repo-link config at ${configPath}.`);
  }

  const document = parseYaml(readFileSync(configPath, "utf8")) as RepoLinksDocument;
  const links = document.links && typeof document.links === "object" ? document.links : undefined;
  const linkRecord = links?.[selector];
  if (!linkRecord) {
    throw new Error(`Repo-link selector '${selector}' is not defined in ${configPath}.`);
  }

  return parseLinkDefinition(selector, linkRecord);
}

function validateRepoEntrypoints(
  repoRoot: string,
  requiredEntrypoints: ReadonlyArray<string>,
): boolean {
  return requiredEntrypoints.every((relativePath) =>
    existsSync(resolvePath(repoRoot, relativePath)),
  );
}

function siblingRepoCandidate(repoRoot: string, selector: string): string {
  return canonicalPath(resolvePath(repoRoot, `../${selector}-vxapp`));
}

export function resolveRepoLink(input: ResolveRepoLinkInput): ResolvedRepoLink {
  const env = input.env ?? process.env;
  const link = loadRepoLinkDefinition(input.repoRoot, input.selector);
  const configured = link.envAliases
    .map((alias) => ({ alias, value: env[alias]?.trim() }))
    .filter((entry): entry is { alias: string; value: string } => Boolean(entry.value))
    .map((entry) => ({
      alias: entry.alias,
      root: canonicalPath(entry.value),
    }));

  const uniqueRoots = [...new Set(configured.map((entry) => entry.root))];
  if (uniqueRoots.length > 1) {
    throw new Error(
      `repo-root env aliases disagree for ${input.selector}: ${configured
        .map((entry) => `${entry.alias}=${entry.root}`)
        .join(", ")}`,
    );
  }

  const fromConfigured = uniqueRoots[0];
  if (fromConfigured) {
    if (!validateRepoEntrypoints(fromConfigured, link.requiredEntrypoints)) {
      throw new Error(
        `Configured ${configured.map((entry) => entry.alias).join(", ")} does not point at a valid ${input.selector}-vxapp checkout.`,
      );
    }
    return {
      selector: input.selector,
      root: fromConfigured,
      envAliases: link.envAliases,
      envAssignments: Object.fromEntries(link.envAliases.map((alias) => [alias, fromConfigured])),
      source: configured[0] ? `env:${configured[0].alias}` : "env",
    };
  }

  const allowSiblingFallback = input.allowSiblingFallback === true || link.fallbackSibling;
  if (allowSiblingFallback) {
    const siblingRoot = siblingRepoCandidate(input.repoRoot, input.selector);
    if (validateRepoEntrypoints(siblingRoot, link.requiredEntrypoints)) {
      return {
        selector: input.selector,
        root: siblingRoot,
        envAliases: link.envAliases,
        envAssignments: Object.fromEntries(link.envAliases.map((alias) => [alias, siblingRoot])),
        source: `sibling:${siblingRoot}`,
      };
    }
  }

  const siblingHint = siblingRepoCandidate(input.repoRoot, input.selector);
  throw new Error(
    `Unable to resolve ${input.selector}-vxapp checkout from repo-link config. Set one of ${link.envAliases.join(
      ", ",
    )}; sibling checkout ${siblingHint} is only a repair hint.`,
  );
}

export function resolveAgentsVxappRepoLink(
  repoRoot: string,
  env?: NodeJS.ProcessEnv,
): ResolvedRepoLink {
  return resolveRepoLink({
    repoRoot,
    selector: "agents",
    env,
    allowSiblingFallback: true,
  });
}
