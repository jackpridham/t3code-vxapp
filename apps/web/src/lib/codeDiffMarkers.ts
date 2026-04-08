import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

import { buildPatchCacheKey } from "./diffRendering";

export type CodeLineMarkerKind = "added" | "modified";

export interface CodeLineMarker {
  lineNumber: number;
  kind: CodeLineMarkerKind;
}

export type CodeDiffMarkersResult =
  | {
      status: "ready";
      markers: ReadonlyMap<number, CodeLineMarkerKind>;
    }
  | {
      status: "deleted";
      markers: ReadonlyMap<number, CodeLineMarkerKind>;
    }
  | {
      status: "unrenderable";
      markers: ReadonlyMap<number, CodeLineMarkerKind>;
      reason: string;
    };

const EMPTY_MARKERS: ReadonlyMap<number, CodeLineMarkerKind> = new Map();

function normalizeDiffPath(path: string | undefined): string {
  if (!path) {
    return "";
  }

  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.startsWith("a/") || normalizedPath.startsWith("b/")) {
    return normalizedPath.slice(2);
  }

  return normalizedPath;
}

function findParsedFile(
  files: readonly FileDiffMetadata[],
  path: string,
): FileDiffMetadata | undefined {
  const normalizedPath = normalizeDiffPath(path);
  return files.find((file) => {
    const nextPath = normalizeDiffPath(file.name);
    const previousPath = normalizeDiffPath(file.prevName);
    return nextPath === normalizedPath || previousPath === normalizedPath;
  });
}

export function parseCodeDiffMarkers(input: {
  patch: string;
  path: string;
  cacheScope?: string;
}): CodeDiffMarkersResult {
  const normalizedPatch = input.patch.replace(/\r\n/g, "\n").trim();
  if (normalizedPatch.length === 0) {
    return { status: "ready", markers: EMPTY_MARKERS };
  }

  let parsedFiles: ReadonlyArray<FileDiffMetadata>;
  try {
    parsedFiles = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, input.cacheScope ?? "code-file-viewer"),
    ).flatMap((patch) => patch.files);
  } catch {
    return {
      status: "unrenderable",
      markers: EMPTY_MARKERS,
      reason: "Failed to parse file patch.",
    };
  }

  const file = findParsedFile(parsedFiles, input.path);
  if (!file) {
    return {
      status: "unrenderable",
      markers: EMPTY_MARKERS,
      reason: `No parsed file matched "${input.path}".`,
    };
  }

  if (file.type === "deleted") {
    return { status: "deleted", markers: EMPTY_MARKERS };
  }

  if (file.hunks.length === 0) {
    return { status: "ready", markers: EMPTY_MARKERS };
  }

  const markers = new Map<number, CodeLineMarkerKind>();
  for (const hunk of file.hunks) {
    const markerKind: CodeLineMarkerKind =
      hunk.deletionLines > 0 && hunk.additionLines > 0 ? "modified" : "added";

    for (const block of hunk.hunkContent) {
      if (block.type !== "change" || block.additions === 0) {
        continue;
      }

      const additionStart = hunk.additionStart + (block.additionLineIndex - hunk.additionLineIndex);
      for (let offset = 0; offset < block.additions; offset += 1) {
        markers.set(additionStart + offset, markerKind);
      }
    }
  }

  return { status: "ready", markers };
}
