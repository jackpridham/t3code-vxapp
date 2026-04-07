import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { discoverChangesReferences, type ChangesPanelGroup } from "../changesDiscovery";
import { submoduleChangedFilesQueryOptions } from "../lib/submoduleReactQuery";
import type { ChatMessage, PersistedFileChange } from "../types";

/**
 * React hook that discovers and categorizes file references from chat
 * messages, merging them with persisted file changes from the thread
 * and submodule changed files.
 *
 * Memoized on message count + last message id + persisted changes count
 * + submodule files count to avoid re-scanning on every render.
 */
export function useChangesDiscovery(
  messages: readonly ChatMessage[],
  persistedFileChanges: readonly PersistedFileChange[],
  cwd: string | undefined,
): ChangesPanelGroup[] {
  // Query submodule changed files
  const submoduleQuery = useQuery(submoduleChangedFilesQueryOptions(cwd ?? null));
  const submoduleFiles = submoduleQuery.data?.files ?? EMPTY_SUBMODULE_FILES;

  // Build a cheap cache key
  const lastMsgId = messages[messages.length - 1]?.id ?? "none";
  const cacheKey = `${messages.length}:${lastMsgId}:${persistedFileChanges.length}:${submoduleFiles.length}`;

  return useMemo(() => {
    const groups = discoverChangesReferences(messages, cwd);

    // Merge persisted file changes and submodule files into the "files_changed" group.
    const filesChangedGroup = groups.find((g) => g.section === "files_changed");
    if (filesChangedGroup) {
      const existingPaths = new Set(
        filesChangedGroup.items.map((item) => item.resolvedPath.toLowerCase()),
      );

      // Merge persisted file changes
      for (const fc of persistedFileChanges) {
        if (!existingPaths.has(fc.path.toLowerCase())) {
          filesChangedGroup.items.push({
            rawRef: fc.path,
            resolvedPath: fc.path,
            filename: fc.path.slice(
              Math.max(fc.path.lastIndexOf("/"), fc.path.lastIndexOf("\\")) + 1,
            ),
            section: "files_changed",
            firstSeenMessageId: fc.firstTurnId,
          });
          existingPaths.add(fc.path.toLowerCase());
        }
      }

      // Merge submodule changed files
      for (const sf of submoduleFiles) {
        if (!existingPaths.has(sf.path.toLowerCase())) {
          filesChangedGroup.items.push({
            rawRef: sf.path,
            resolvedPath: sf.path,
            filename: sf.path.slice(
              Math.max(sf.path.lastIndexOf("/"), sf.path.lastIndexOf("\\")) + 1,
            ),
            section: "files_changed",
            firstSeenMessageId: "",
          });
          existingPaths.add(sf.path.toLowerCase());
        }
      }
    }

    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cacheKey acts as dep proxy
  }, [cacheKey, cwd]);
}

const EMPTY_SUBMODULE_FILES: readonly [] = [];
