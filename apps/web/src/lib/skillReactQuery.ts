import type { ProjectSearchEntriesResult } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import {
  resolveSkillCatalogRoots,
  type SkillCatalogContext,
  type SkillCatalogEntry,
  type SkillCatalogRoot,
  toSkillCatalogEntry,
} from "./skillCatalog";

const DEFAULT_SKILL_SEARCH_LIMIT = 40;
const DEFAULT_SKILL_SEARCH_STALE_TIME = 15_000;
const EMPTY_PROJECT_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_SKILL_ENTRIES_RESULT: {
  entries: SkillCatalogEntry[];
  truncated: boolean;
} = {
  entries: [],
  truncated: false,
};
const EMPTY_SKILL_CATALOG_ROOTS: SkillCatalogRoot[] = [];

export const skillQueryKeys = {
  all: ["skills"] as const,
  searchEntries: (projectCwd: string | null, query: string, limit: number) =>
    ["skills", "search-entries", projectCwd, query, limit] as const,
};

export function isMissingSkillDirectoryError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error != null && typeof error === "object" && "message" in error
          ? String(error.message)
          : "";

  return /ENOENT|no such file or directory|cannot find the path specified/i.test(message);
}

export function projectSkillEntriesQueryOptions(input: {
  context?: SkillCatalogContext;
  projectCwd?: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SKILL_SEARCH_LIMIT;
  const context = input.context ?? { projectCwd: input.projectCwd ?? null };
  const roots = resolveSkillCatalogRoots(context);
  const primaryRoot = roots[0] ?? null;
  const skillsRootPath = primaryRoot?.rootPath ?? null;

  return queryOptions({
    queryKey: skillQueryKeys.searchEntries(skillsRootPath, input.query, limit),
    queryFn: async () => {
      if (!skillsRootPath || !primaryRoot) {
        throw new Error("Skill search is unavailable.");
      }

      const api = ensureNativeApi();
      const result: ProjectSearchEntriesResult = await api.projects
        .searchEntries({
          cwd: skillsRootPath,
          query: input.query,
          limit,
          includeIgnored: true,
        })
        .catch((error) => {
          if (isMissingSkillDirectoryError(error)) {
            return EMPTY_PROJECT_SEARCH_ENTRIES_RESULT;
          }
          throw error;
        });

      return {
        truncated: result.truncated,
        entries: result.entries
          .map((entry) => toSkillCatalogEntry(primaryRoot, entry))
          .filter((entry): entry is SkillCatalogEntry => entry !== null),
      };
    },
    enabled: (input.enabled ?? true) && skillsRootPath !== null,
    staleTime: input.staleTime ?? DEFAULT_SKILL_SEARCH_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SKILL_ENTRIES_RESULT,
  });
}

export function useSkillSuggestions(input: {
  context: SkillCatalogContext;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const roots = resolveSkillCatalogRoots(input.context);
  const query = useQuery(
    projectSkillEntriesQueryOptions({
      context: input.context,
      query: input.query,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.staleTime !== undefined ? { staleTime: input.staleTime } : {}),
    }),
  );

  return {
    entries: query.data?.entries ?? EMPTY_SKILL_ENTRIES_RESULT.entries,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    truncated: query.data?.truncated ?? false,
    roots: roots.length > 0 ? roots : EMPTY_SKILL_CATALOG_ROOTS,
    unavailableReason: roots.length === 0 ? "no-project" : null,
  } as const;
}
