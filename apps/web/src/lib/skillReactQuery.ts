import type { ProjectSearchEntriesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import {
  buildSkillsRootPath,
  type ProjectSkillEntry,
  toProjectSkillEntry,
} from "./skillReferences";

const DEFAULT_SKILL_SEARCH_LIMIT = 40;
const DEFAULT_SKILL_SEARCH_STALE_TIME = 15_000;
const EMPTY_PROJECT_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_SKILL_ENTRIES_RESULT: {
  entries: ProjectSkillEntry[];
  truncated: boolean;
} = {
  entries: [],
  truncated: false,
};

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
  projectCwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SKILL_SEARCH_LIMIT;
  const skillsRootPath = input.projectCwd ? buildSkillsRootPath(input.projectCwd) : null;

  return queryOptions({
    queryKey: skillQueryKeys.searchEntries(input.projectCwd, input.query, limit),
    queryFn: async () => {
      if (!skillsRootPath) {
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
          .map((entry) => toProjectSkillEntry(skillsRootPath, entry))
          .filter((entry): entry is ProjectSkillEntry => entry !== null),
      };
    },
    enabled: (input.enabled ?? true) && skillsRootPath !== null,
    staleTime: input.staleTime ?? DEFAULT_SKILL_SEARCH_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SKILL_ENTRIES_RESULT,
  });
}
