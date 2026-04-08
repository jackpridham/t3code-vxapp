import { getFiletypeFromFileName } from "@pierre/diffs";
import { useEffect, useMemo, useState } from "react";

import { useTheme } from "../hooks/useTheme";
import {
  createHighlightCacheKey,
  estimateHighlightedSize,
  getHighlighterPromise,
  highlightedCodeCache,
} from "../lib/codeHighlighting";
import { resolveDiffThemeName } from "../lib/diffRendering";
import type { CodeLineMarkerKind } from "../lib/codeDiffMarkers";
import { cn } from "../lib/utils";
import { Skeleton } from "./ui/skeleton";

export interface CodeFileViewerProps {
  path: string;
  content: string;
  markers: ReadonlyMap<number, CodeLineMarkerKind>;
  loading?: boolean;
  error?: string | null;
}

const HIGHLIGHTED_LINE_OPENING_TAG_PATTERN = /<span class="([^"]*\bline\b[^"]*)">/g;

export function annotateHighlightedCodeHtml(
  html: string,
  markers: ReadonlyMap<number, CodeLineMarkerKind>,
): {
  html: string;
  lineCount: number;
} {
  let lineCount = 0;
  const annotatedHtml = html.replace(HIGHLIGHTED_LINE_OPENING_TAG_PATTERN, (_match, className) => {
    lineCount += 1;
    const marker = markers.get(lineCount);
    const markerAttribute = marker ? ` data-line-marker="${marker}"` : "";
    return `<span class="${className} code-file-viewer__line" data-line-number="${lineCount}"${markerAttribute}>`;
  });

  return { html: annotatedHtml, lineCount };
}

function resolveCodeLanguage(path: string): string {
  return getFiletypeFromFileName(path) ?? "text";
}

function PlainTextCodeView({
  content,
  markers,
}: {
  content: string;
  markers: ReadonlyMap<number, CodeLineMarkerKind>;
}) {
  const lines = content.split("\n");

  return (
    <pre className="code-file-viewer__plain">
      <code>
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const marker = markers.get(lineNumber);
          return (
            <span
              key={`${lineNumber}:${line}`}
              className="code-file-viewer__line"
              data-line-number={lineNumber}
              data-line-marker={marker}
            >
              {line.length > 0 ? line : " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export default function CodeFileViewer({
  path,
  content,
  markers,
  loading = false,
  error = null,
}: CodeFileViewerProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const language = useMemo(() => resolveCodeLanguage(path), [path]);
  const cacheKey = useMemo(
    () => createHighlightCacheKey(content, language, diffThemeName),
    [content, diffThemeName, language],
  );
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [highlightingFailed, setHighlightingFailed] = useState(false);

  useEffect(() => {
    if (loading || error) {
      setHighlightedHtml(null);
      setHighlightingFailed(false);
      return;
    }

    const cachedHighlightedHtml = highlightedCodeCache.get(cacheKey);
    if (cachedHighlightedHtml != null) {
      setHighlightedHtml(cachedHighlightedHtml);
      setHighlightingFailed(false);
      return;
    }

    let cancelled = false;
    setHighlightedHtml(null);
    setHighlightingFailed(false);

    void getHighlighterPromise(language)
      .then((highlighter) => {
        let html: string;
        try {
          html = highlighter.codeToHtml(content, { lang: language, theme: diffThemeName });
        } catch (error) {
          console.warn(
            `Code highlighting failed for language "${language}", falling back to plain text.`,
            error instanceof Error ? error.message : error,
          );
          html = highlighter.codeToHtml(content, { lang: "text", theme: diffThemeName });
        }

        if (cancelled) {
          return;
        }

        highlightedCodeCache.set(cacheKey, html, estimateHighlightedSize(html, content));
        setHighlightedHtml(html);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn(
            `Unable to initialize code highlighting for "${path}". Rendering plain text instead.`,
            error instanceof Error ? error.message : error,
          );
          setHighlightingFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, content, diffThemeName, error, language, loading, path]);

  const annotatedHighlightedHtml = useMemo(() => {
    if (highlightedHtml == null) {
      return null;
    }

    const annotated = annotateHighlightedCodeHtml(highlightedHtml, markers);
    if (annotated.lineCount === 0) {
      return null;
    }

    return annotated.html;
  }, [highlightedHtml, markers]);

  if (loading) {
    return (
      <div className="space-y-3 p-1" role="status" aria-label="Loading code file">
        <Skeleton className="h-5 w-44 rounded-full" />
        <Skeleton className="h-4 w-full rounded-full" />
        <Skeleton className="h-4 w-11/12 rounded-full" />
        <Skeleton className="h-4 w-10/12 rounded-full" />
        <Skeleton className="h-4 w-9/12 rounded-full" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <span className="sr-only">Loading file preview…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive shadow-xs"
        role="alert"
      >
        {error}
      </div>
    );
  }

  const showHighlightedView = annotatedHighlightedHtml != null && !highlightingFailed;

  return (
    <div className="code-file-viewer">
      <div
        className={cn(
          "code-file-viewer__surface",
          !showHighlightedView && "code-file-viewer__surface--plain",
        )}
      >
        {showHighlightedView ? (
          <div dangerouslySetInnerHTML={{ __html: annotatedHighlightedHtml }} />
        ) : (
          <PlainTextCodeView content={content} markers={markers} />
        )}
      </div>
    </div>
  );
}
