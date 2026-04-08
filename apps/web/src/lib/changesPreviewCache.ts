import { LRUCache } from "./lruCache";

const MAX_CHANGES_PREVIEW_CACHE_ENTRIES = 200;
const MAX_CHANGES_PREVIEW_CACHE_MEMORY_BYTES = 20 * 1024 * 1024;

export const changesPreviewContentCache = new LRUCache<string>(
  MAX_CHANGES_PREVIEW_CACHE_ENTRIES,
  MAX_CHANGES_PREVIEW_CACHE_MEMORY_BYTES,
);

export function buildChangesPreviewCacheKey(input: {
  threadId: string | null;
  path: string | null;
  mode: "preview" | "diff";
}): string | null {
  if (!input.threadId || !input.path) {
    return null;
  }
  return `${input.threadId}:${input.mode}:${input.path}`;
}

export function estimateChangesPreviewContentSize(content: string): number {
  return Math.max(content.length * 2, 256);
}
