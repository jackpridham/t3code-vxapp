import type { ServerListVortexAppArtifactsResult, VortexAppProject } from "@t3tools/contracts";

export const ARTIFACT_PRELOAD_TTL_MS = 5 * 60 * 1000;

const ARTIFACT_PRELOAD_CACHE_VERSION = 1;
const ARTIFACT_PRELOAD_STORAGE_PREFIX = "t3code:artifact-preload:v1:";

interface CachedArtifactPreload {
  schemaVersion: typeof ARTIFACT_PRELOAD_CACHE_VERSION;
  targetId: string;
  fetchedAt: string;
  expiresAt: string;
  fingerprintsByKey: Record<string, string>;
  payload: ServerListVortexAppArtifactsResult;
}

export type ArtifactRecord = Record<string, unknown>;

const SLUG_SEPARATOR = "-";

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function filenameFromPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function artifactRecordTitle(record: ArtifactRecord): string | null {
  return toStringValue(record.title) ?? toStringValue(record.Name) ?? null;
}

function artifactRecordPath(record: ArtifactRecord): string | null {
  return toStringValue(record.path);
}

function artifactRecordRepo(record: ArtifactRecord): string | null {
  return toStringValue(record.repo);
}

function artifactRecordCreatedAt(record: ArtifactRecord): string | null {
  return toStringValue(record.createdAt) ?? toStringValue(record.created_at);
}

function artifactRecordUpdatedAt(record: ArtifactRecord): string | null {
  return (
    toStringValue(record.updatedAt) ??
    toStringValue(record.updated_at) ??
    toStringValue(record.modifiedAt) ??
    toStringValue(record.modified_at) ??
    null
  );
}

function artifactRecordKind(record: ArtifactRecord): string | null {
  return toStringValue(record.kind) ?? toStringValue(record.artifactType);
}

function artifactRecordPreview(record: ArtifactRecord): string | null {
  return toStringValue(record.preview);
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") return value === 1;
  return false;
}

function artifactRecordPinned(record: ArtifactRecord): boolean {
  return booleanValue(record.pinned);
}

function artifactRecordArchived(record: ArtifactRecord): boolean {
  return booleanValue(record.archived) || toStringValue(record.archivedAt) != null;
}

export function artifactPreloadStorageKey(targetId: string): string {
  return `${ARTIFACT_PRELOAD_STORAGE_PREFIX}${targetId}`;
}

export function normalizeArtifactSlug(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return "artifact";

  return normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, SLUG_SEPARATOR)
    .replace(/(^-|-$)/g, "")
    .replace(/-+/g, SLUG_SEPARATOR);
}

export function artifactRecordSlug(record: ArtifactRecord): string {
  const title = artifactRecordTitle(record);
  if (title) {
    return normalizeArtifactSlug(title);
  }

  const recordPath = artifactRecordPath(record);
  if (!recordPath) {
    return "artifact";
  }

  return normalizeArtifactSlug(filenameFromPath(recordPath));
}

export function readArtifactPreloadPayload(
  targetId: string,
): ServerListVortexAppArtifactsResult | null {
  if (typeof window === "undefined") {
    return null;
  }

  const key = artifactPreloadStorageKey(targetId);
  const cached = parseCachedArtifactPreload(window.localStorage.getItem(key));
  if (!cached || cached.targetId !== targetId) {
    return null;
  }

  return cached.payload;
}

export function findArtifactBySlug(input: {
  artifacts: readonly ArtifactRecord[];
  artifactTitle: string;
}): ArtifactRecord | null {
  const requestedTitle = input.artifactTitle.trim();
  let decodedTitle = requestedTitle;
  try {
    const candidate = decodeURIComponent(requestedTitle);
    decodedTitle = candidate;
  } catch {
    decodedTitle = requestedTitle;
  }

  const requestedSlug = normalizeArtifactSlug(decodedTitle);

  let titleFallbackMatch: ArtifactRecord | null = null;

  for (const artifact of input.artifacts) {
    const title = artifactRecordTitle(artifact);
    if (title) {
      if (title === decodedTitle) {
        return artifact;
      }

      if (title === input.artifactTitle) {
        return artifact;
      }

      if (normalizeArtifactSlug(title) === requestedSlug) {
        return artifact;
      }
    }

    const recordPath = artifactRecordPath(artifact);
    if (!titleFallbackMatch && recordPath) {
      const fallbackTitle = filenameFromPath(recordPath);
      if (normalizeArtifactSlug(fallbackTitle) === requestedSlug) {
        titleFallbackMatch = artifact;
      }
    }
  }

  return titleFallbackMatch;
}

export function artifactRecordMeta(record: ArtifactRecord): {
  title: string;
  slug: string;
  path: string | null;
  repo: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  kind: string | null;
  preview: string | null;
  pinned: boolean;
  archived: boolean;
} {
  const title = artifactRecordTitle(record) ?? "Artifact";
  const path = artifactRecordPath(record);
  const repo = artifactRecordRepo(record);
  const createdAt = artifactRecordCreatedAt(record);
  const updatedAt = artifactRecordUpdatedAt(record);
  const kind = artifactRecordKind(record);
  const preview = artifactRecordPreview(record);

  return {
    title,
    slug: artifactRecordSlug(record),
    path: path ?? null,
    repo: repo ?? null,
    createdAt: createdAt ?? null,
    updatedAt: updatedAt ?? null,
    kind: kind ?? null,
    preview: preview ?? null,
    pinned: artifactRecordPinned(record),
    archived: artifactRecordArchived(record),
  };
}

function parseCachedArtifactPreload(raw: string | null): CachedArtifactPreload | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CachedArtifactPreload>;
    if (
      parsed.schemaVersion !== ARTIFACT_PRELOAD_CACHE_VERSION ||
      typeof parsed.targetId !== "string" ||
      typeof parsed.fetchedAt !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.fingerprintsByKey !== "object" ||
      parsed.fingerprintsByKey === null ||
      typeof parsed.payload !== "object" ||
      parsed.payload === null
    ) {
      return null;
    }
    return parsed as CachedArtifactPreload;
  } catch {
    return null;
  }
}

export function hasFreshArtifactPreload(targetId: string, nowMs = Date.now()): boolean {
  if (typeof window === "undefined") return true;

  const key = artifactPreloadStorageKey(targetId);
  const cached = parseCachedArtifactPreload(window.localStorage.getItem(key));
  if (!cached || cached.targetId !== targetId) {
    window.localStorage.removeItem(key);
    return false;
  }

  const expiresAtMs = Date.parse(cached.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }

  return true;
}

function artifactRecordKey(artifact: Record<string, unknown>, fallbackIndex: number): string {
  const path = artifact.path;
  if (typeof path === "string" && path.trim().length > 0) {
    return `path:${path.trim()}`;
  }

  const title = artifact.title;
  if (typeof title === "string" && title.trim().length > 0) {
    return `title:${title.trim()}`;
  }

  return `index:${fallbackIndex}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function buildArtifactFingerprints(
  artifacts: readonly Record<string, unknown>[],
): Record<string, string> {
  return Object.fromEntries(
    artifacts.map((artifact, index) => [
      artifactRecordKey(artifact, index),
      stableStringify(artifact),
    ]),
  );
}

function mergeChangedArtifacts(input: {
  existing: CachedArtifactPreload | null;
  nextPayload: ServerListVortexAppArtifactsResult;
}): ServerListVortexAppArtifactsResult {
  if (!input.existing) {
    return input.nextPayload;
  }

  const existingByKey = new Map(
    input.existing.payload.artifacts.map((artifact, index) => [
      artifactRecordKey(artifact, index),
      artifact,
    ]),
  );
  const nextFingerprints = buildArtifactFingerprints(input.nextPayload.artifacts);
  const artifacts = input.nextPayload.artifacts.map((artifact, index) => {
    const key = artifactRecordKey(artifact, index);
    const existingArtifact = existingByKey.get(key);
    if (existingArtifact && input.existing?.fingerprintsByKey[key] === nextFingerprints[key]) {
      return existingArtifact;
    }

    return artifact;
  });

  return {
    ...input.nextPayload,
    artifacts,
  };
}

export function refreshArtifactPreloadCache(
  project: Pick<VortexAppProject, "target_id">,
  payload: ServerListVortexAppArtifactsResult,
  nowMs = Date.now(),
): void {
  if (typeof window === "undefined") return;

  const fetchedAt = new Date(nowMs).toISOString();
  const key = artifactPreloadStorageKey(project.target_id);
  const existing = parseCachedArtifactPreload(window.localStorage.getItem(key));
  const mergedPayload = mergeChangedArtifacts({
    existing: existing?.targetId === project.target_id ? existing : null,
    nextPayload: payload,
  });
  const cacheEntry: CachedArtifactPreload = {
    schemaVersion: ARTIFACT_PRELOAD_CACHE_VERSION,
    targetId: project.target_id,
    fetchedAt,
    expiresAt: new Date(nowMs + ARTIFACT_PRELOAD_TTL_MS).toISOString(),
    fingerprintsByKey: buildArtifactFingerprints(mergedPayload.artifacts),
    payload: mergedPayload,
  };

  window.localStorage.setItem(key, JSON.stringify(cacheEntry));
}
