import { queryOptions } from "@tanstack/react-query";
import {
  discoverSubmodulePaths,
  getSubmoduleChangedFiles,
  type SubmoduleFileChange,
} from "./submoduleDiscovery";

export const submoduleQueryKeys = {
  all: ["submodules"] as const,
  changedFiles: (cwd: string | null) => ["submodules", "changedFiles", cwd] as const,
};

const SUBMODULE_STALE_TIME_MS = 10_000;
const SUBMODULE_REFETCH_INTERVAL_MS = 30_000;

export function submoduleChangedFilesQueryOptions(cwd: string | null) {
  return queryOptions<{ files: SubmoduleFileChange[] }>({
    queryKey: submoduleQueryKeys.changedFiles(cwd),
    queryFn: async () => {
      if (!cwd) return { files: [] };
      const submodules = await discoverSubmodulePaths(cwd);
      if (submodules.length === 0) return { files: [] };
      const files = await getSubmoduleChangedFiles(cwd, submodules);
      return { files };
    },
    enabled: cwd !== null,
    staleTime: SUBMODULE_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchInterval: SUBMODULE_REFETCH_INTERVAL_MS,
  });
}
