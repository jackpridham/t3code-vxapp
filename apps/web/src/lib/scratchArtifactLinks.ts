import {
  artifactRecordMeta,
  normalizeArtifactSlug,
  readArtifactPreloadPayload,
  type ArtifactRecord,
} from "./artifactPreloadCache";
import { buildArtifactDetailHref } from "./artifactsRoute";

const SCRATCH_SEGMENT = "@Scratch";
const MARKDOWN_EXTENSION_PATTERN = /\.md$/i;
const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripFilePosition(path: string): string {
  return path.replace(POSITION_SUFFIX_PATTERN, "");
}

function trimQueryAndHash(path: string): string {
  const hashIndex = path.indexOf("#");
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  return queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
}

export function normalizeScratchArtifactPath(path: string): string {
  return stripFilePosition(trimQueryAndHash(normalizePathSeparators(path.trim())));
}

export function getScratchArtifactPathParts(path: string): {
  targetId: string;
  filename: string;
  suffix: string;
} | null {
  const normalized = normalizeScratchArtifactPath(path);
  if (!normalized) return null;

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const scratchIndex = segments.findIndex((segment) => segment === SCRATCH_SEGMENT);
  if (scratchIndex < 0) return null;

  const targetId = segments[scratchIndex + 1];
  const filename = segments.at(-1);
  if (!targetId || !filename || !MARKDOWN_EXTENSION_PATTERN.test(filename)) {
    return null;
  }

  return {
    targetId,
    filename,
    suffix: segments.slice(scratchIndex).join("/"),
  };
}

export function isScratchArtifactPath(path: string): boolean {
  return getScratchArtifactPathParts(path) !== null;
}

function basenameWithoutMarkdownExtension(filename: string): string {
  return filename.replace(MARKDOWN_EXTENSION_PATTERN, "");
}

function artifactPathSuffix(path: string): string | null {
  return getScratchArtifactPathParts(path)?.suffix ?? null;
}

function artifactPathMatches(record: ArtifactRecord, linkedPath: string): boolean {
  const metadata = artifactRecordMeta(record);
  if (!metadata.path) return false;

  const linkedNormalized = normalizeScratchArtifactPath(linkedPath);
  const recordNormalized = normalizeScratchArtifactPath(metadata.path);
  if (!linkedNormalized || !recordNormalized) return false;
  if (linkedNormalized === recordNormalized) return true;

  const linkedSuffix = artifactPathSuffix(linkedNormalized);
  const recordSuffix = artifactPathSuffix(recordNormalized);
  return linkedSuffix != null && recordSuffix != null && linkedSuffix === recordSuffix;
}

export function resolveScratchArtifactHref(path: string): string | null {
  const parts = getScratchArtifactPathParts(path);
  if (!parts) return null;

  const cachedPayload = readArtifactPreloadPayload(parts.targetId);
  const cachedArtifact = cachedPayload?.artifacts.find((artifact) =>
    artifactPathMatches(artifact, path),
  );
  const artifactTitle =
    cachedArtifact != null
      ? artifactRecordMeta(cachedArtifact).slug
      : normalizeArtifactSlug(basenameWithoutMarkdownExtension(parts.filename));

  return buildArtifactDetailHref({
    targetId: parts.targetId,
    artifactTitle,
  });
}
