import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import { useQuery } from "@tanstack/react-query";
import { type ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import { type ContentState } from "../components/ArtifactPanel";
import type { CodeLineMarkerKind } from "./codeDiffMarkers";
import { parseCodeDiffMarkers } from "./codeDiffMarkers";
import { buildChangesPreviewCacheKey, changesPreviewContentCache } from "./changesPreviewCache";
import { estimateChangesPreviewContentSize } from "./changesPreviewCache";
import { buildPatchCacheKey } from "./diffRendering";
import { checkpointDiffQueryOptions, checkpointFileDiffQueryOptions } from "./providerReactQuery";
import { readWorkspaceFileContent } from "./workspaceFileContent";

function hasMarkers(markers: ReadonlyMap<number, CodeLineMarkerKind>): boolean {
  return markers.size > 0;
}

export function useWorkspaceFileContentState(input: {
  threadId: ThreadId | null;
  worktreePath: string | null;
  absolutePath: string | null;
  enabled: boolean;
  mode: "preview" | "diff";
}): ContentState {
  const [state, setState] = useState<ContentState>({ status: "idle" });

  useEffect(() => {
    if (!input.enabled || !input.absolutePath) {
      setState({ status: "idle" });
      return;
    }

    const cacheKey = buildChangesPreviewCacheKey({
      threadId: input.threadId,
      path: input.absolutePath,
      mode: input.mode,
    });
    const cachedContent = cacheKey ? changesPreviewContentCache.get(cacheKey) : null;
    if (cachedContent != null) {
      setState({ status: "loaded", content: cachedContent, path: input.absolutePath });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    void readWorkspaceFileContent({
      worktreePath: input.worktreePath,
      absolutePath: input.absolutePath,
    })
      .then((content) => {
        if (cancelled) {
          return;
        }
        if (cacheKey) {
          changesPreviewContentCache.set(
            cacheKey,
            content,
            estimateChangesPreviewContentSize(content),
          );
        }
        setState({ status: "loaded", content, path: input.absolutePath ?? "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load file.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.absolutePath, input.enabled, input.mode, input.threadId, input.worktreePath]);

  return state;
}

export function findSelectedFileDiffMetadata(
  patch: string | undefined,
  selectedFilePath: string | null,
): FileDiffMetadata | null {
  if (!patch || !selectedFilePath) {
    return null;
  }

  try {
    const parsedPatches = parsePatchFiles(
      patch.trim().replace(/\r\n/g, "\n"),
      buildPatchCacheKey(patch, `file-preview:${selectedFilePath}`),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    return (
      files.find((file) => {
        const name = file.name.replaceAll("\\", "/").replace(/^a\//, "").replace(/^b\//, "");
        const prevName = file.prevName
          ? file.prevName.replaceAll("\\", "/").replace(/^a\//, "").replace(/^b\//, "")
          : "";
        const normalizedSelectedPath = selectedFilePath.replaceAll("\\", "/");
        return name === normalizedSelectedPath || prevName === normalizedSelectedPath;
      }) ?? null
    );
  } catch {
    return null;
  }
}

export function useResolvedFileDiffState(input: {
  threadId: ThreadId | null;
  selectedFilePath: string | null;
  selectedFileQueryPath: string | null;
  enabled: boolean;
  latestCheckpointTurnCount: number | null;
  cacheScope: string;
}) {
  const fileDiffQuery = useQuery(
    checkpointFileDiffQueryOptions({
      threadId: input.threadId,
      path: input.selectedFileQueryPath,
      fromTurnCount: 0,
      toTurnCount: input.latestCheckpointTurnCount,
      cacheScope: input.selectedFilePath ? input.cacheScope : null,
      enabled:
        input.enabled &&
        input.threadId !== null &&
        input.selectedFileQueryPath !== null &&
        input.latestCheckpointTurnCount !== null,
    }),
  );

  const fileDiffMetadata = useMemo(
    () => findSelectedFileDiffMetadata(fileDiffQuery.data?.diff, input.selectedFileQueryPath),
    [input.selectedFileQueryPath, fileDiffQuery.data?.diff],
  );
  const fileMarkers = useMemo(() => {
    if (!fileDiffQuery.data?.diff || !input.selectedFileQueryPath) {
      return new Map<number, CodeLineMarkerKind>();
    }
    const result = parseCodeDiffMarkers({
      patch: fileDiffQuery.data.diff,
      path: input.selectedFileQueryPath,
      cacheScope: input.cacheScope,
    });
    return result.status === "ready" ? result.markers : new Map<number, CodeLineMarkerKind>();
  }, [input.cacheScope, input.selectedFileQueryPath, fileDiffQuery.data?.diff]);

  const fallbackDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.latestCheckpointTurnCount,
      cacheScope:
        input.enabled && input.selectedFileQueryPath ? `${input.cacheScope}:fallback` : null,
      enabled:
        input.enabled &&
        input.threadId !== null &&
        input.latestCheckpointTurnCount !== null &&
        input.selectedFileQueryPath !== null &&
        (fileDiffQuery.isError || fileDiffQuery.data == null || fileDiffMetadata == null),
    }),
  );

  const fallbackDiffMetadata = useMemo(
    () => findSelectedFileDiffMetadata(fallbackDiffQuery.data?.diff, input.selectedFileQueryPath),
    [fallbackDiffQuery.data?.diff, input.selectedFileQueryPath],
  );
  const fallbackMarkers = useMemo(() => {
    if (!fallbackDiffQuery.data?.diff || !input.selectedFileQueryPath) {
      return new Map<number, CodeLineMarkerKind>();
    }
    const result = parseCodeDiffMarkers({
      patch: fallbackDiffQuery.data.diff,
      path: input.selectedFileQueryPath,
      cacheScope: `${input.cacheScope}:fallback`,
    });
    return result.status === "ready" ? result.markers : new Map<number, CodeLineMarkerKind>();
  }, [input.cacheScope, fallbackDiffQuery.data?.diff, input.selectedFileQueryPath]);

  return {
    diffMetadata: fileDiffMetadata ?? fallbackDiffMetadata,
    markers: hasMarkers(fileMarkers) || fallbackMarkers.size === 0 ? fileMarkers : fallbackMarkers,
    error:
      fileDiffQuery.error instanceof Error
        ? fileDiffQuery.error.message
        : fallbackDiffQuery.error instanceof Error
          ? fallbackDiffQuery.error.message
          : null,
  };
}
