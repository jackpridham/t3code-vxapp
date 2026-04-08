export function normalizeChangesPath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

export function isAbsoluteChangesPath(pathValue: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(pathValue);
}

export function canonicalizeChangesPathForLookup(pathValue: string): string {
  return normalizeChangesPath(pathValue).replace(/\/+$/, "").toLowerCase();
}

export function stripChangesBasePath(pathValue: string, basePath: string | null): string {
  const normalizedPath = normalizeChangesPath(pathValue);
  const normalizedBase = basePath ? normalizeChangesPath(basePath).replace(/\/+$/, "") : null;
  if (!normalizedBase) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedBase) {
    return "";
  }
  const prefix = `${normalizedBase}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

export function resolveChangesAbsolutePath(worktreePath: string | null, pathValue: string): string {
  const normalizedPath = normalizeChangesPath(pathValue);
  if (isAbsoluteChangesPath(normalizedPath) || !worktreePath) {
    return normalizedPath;
  }
  return `${normalizeChangesPath(worktreePath).replace(/\/+$/, "")}/${normalizedPath}`;
}

export function resolveChangesThreadRelativePath(
  worktreePath: string | null,
  pathValue: string,
): string {
  const normalizedPath = normalizeChangesPath(pathValue);
  if (!worktreePath) {
    return normalizedPath;
  }
  const normalizedWorktree = normalizeChangesPath(worktreePath).replace(/\/+$/, "");
  const prefix = `${normalizedWorktree}/`;
  if (normalizedPath === normalizedWorktree) {
    return "";
  }
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return normalizedPath.replace(/^\/+/, "");
}

export function basenameOfChangesPath(pathValue: string): string {
  const normalized = normalizeChangesPath(pathValue);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function cleanDiscoveredChangesRawRef(raw: string): string {
  let cleaned = raw;
  if (cleaned.toLowerCase().startsWith("file:///")) {
    try {
      const parsed = new URL(cleaned);
      cleaned = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:[\\/]/.test(cleaned)) {
        cleaned = cleaned.slice(1);
      }
    } catch {
      cleaned = cleaned.slice(7);
    }
  }

  const queryIdx = cleaned.indexOf("?");
  if (queryIdx >= 0) cleaned = cleaned.slice(0, queryIdx);
  const hashIdx = cleaned.indexOf("#");
  if (hashIdx >= 0) cleaned = cleaned.slice(0, hashIdx);

  cleaned = cleaned.trim();

  while (/^[`"'([]/.test(cleaned)) {
    cleaned = cleaned.slice(1).trimStart();
  }
  while (/[`"',.:;!?)\]]$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1).trimEnd();
  }

  return normalizeChangesPath(cleaned);
}
