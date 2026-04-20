import { CheckIcon, CopyIcon } from "lucide-react";
import React, {
  Children,
  Suspense,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openInPreferredEditor } from "../editorPreferences";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { useTheme } from "../hooks/useTheme";
import { resolveMarkdownFileLinkTarget } from "../markdown-links";
import { resolveScratchArtifactHref } from "../lib/scratchArtifactLinks";
import { readNativeApi } from "../nativeApi";
import { slugifyMarkdownHeading, type ParsedMarkdownHeading } from "../lib/markdownHeadings";
import {
  createHighlightCacheKey,
  estimateHighlightedSize,
  extractFenceLanguage,
  getHighlighterPromise,
  highlightedCodeCache,
} from "../lib/codeHighlighting";
import { cn } from "~/lib/utils";

/**
 * Extend react-markdown's default URL transform to also allow `file:` protocol.
 * The default only permits http(s), irc(s), mailto, xmpp — file: links are
 * stripped to "" which breaks artifact panel routing.
 */
function urlTransform(url: string): string {
  if (url.trim().toLowerCase().startsWith("file:")) return url;
  return defaultUrlTransform(url);
}

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  variant?: "chat" | "document";
  className?: string;
  headingAnchors?: readonly ParsedMarkdownHeading[];
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

function ChatMarkdown({
  text,
  cwd,
  isStreaming = false,
  variant = "chat",
  className,
  headingAnchors,
}: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const headingIdIndexRef = useRef(0);
  const headingSlugCountsRef = useRef(new Map<string, number>());

  headingIdIndexRef.current = 0;
  headingSlugCountsRef.current = new Map<string, number>();

  const resolveHeadingId = useCallback(
    (children: ReactNode, level: number): string => {
      const textHeading = nodeToPlainText(children).trim();
      const anchors = headingAnchors ?? [];

      for (let index = headingIdIndexRef.current; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        if (anchor && anchor.level === level && anchor.text === textHeading) {
          headingIdIndexRef.current = index + 1;
          return anchor.id;
        }
      }

      return slugifyMarkdownHeading(textHeading, headingSlugCountsRef.current);
    },
    [headingAnchors],
  );

  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
        }

        const artifactHref = resolveScratchArtifactHref(targetPath);
        if (artifactHref) {
          return <a {...props} href={artifactHref} />;
        }

        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const api = readNativeApi();
              if (api) {
                void openInPreferredEditor(api, targetPath);
              } else {
                console.warn("Native API not found. Unable to open file in editor.");
              }
            }}
          />
        );
      },
      table({ node: _node, children, ...props }) {
        return (
          <div className="chat-markdown-table">
            <table {...props}>{children}</table>
          </div>
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <CodeHighlightErrorBoundary fallback={<pre {...props}>{children}</pre>}>
              <Suspense fallback={<pre {...props}>{children}</pre>}>
                <SuspenseShikiCodeBlock
                  className={codeBlock.className}
                  code={codeBlock.code}
                  themeName={diffThemeName}
                  isStreaming={isStreaming}
                />
              </Suspense>
            </CodeHighlightErrorBoundary>
          </MarkdownCodeBlock>
        );
      },
      h1({ node: _node, children, ...props }) {
        return (
          <h1 {...props} id={resolveHeadingId(children, 1)}>
            {children}
          </h1>
        );
      },
      h2({ node: _node, children, ...props }) {
        return (
          <h2 {...props} id={resolveHeadingId(children, 2)}>
            {children}
          </h2>
        );
      },
      h3({ node: _node, children, ...props }) {
        return (
          <h3 {...props} id={resolveHeadingId(children, 3)}>
            {children}
          </h3>
        );
      },
      h4({ node: _node, children, ...props }) {
        return (
          <h4 {...props} id={resolveHeadingId(children, 4)}>
            {children}
          </h4>
        );
      },
      h5({ node: _node, children, ...props }) {
        return (
          <h5 {...props} id={resolveHeadingId(children, 5)}>
            {children}
          </h5>
        );
      },
      h6({ node: _node, children, ...props }) {
        return (
          <h6 {...props} id={resolveHeadingId(children, 6)}>
            {children}
          </h6>
        );
      },
    }),
    [cwd, diffThemeName, isStreaming, resolveHeadingId],
  );

  return (
    <div
      className={cn(
        "chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80",
        className,
      )}
      data-variant={variant}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
