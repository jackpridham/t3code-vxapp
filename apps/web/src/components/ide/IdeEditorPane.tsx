import { FileDiff } from "@pierre/diffs/react";
import { CopyIcon, DiffIcon, EyeIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import ChatMarkdown from "../ChatMarkdown";
import CodeFileViewer from "../CodeFileViewer";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readNativeApi } from "../../nativeApi";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { useResolvedFileDiffState, useWorkspaceFileContentState } from "../../lib/filePreviewState";
import { type IdeSelectedFile, isMarkdownPath } from "../../lib/ide";
import { useTheme } from "../../hooks/useTheme";
import { useUiStateStore } from "../../uiStateStore";
import { cn } from "../../lib/utils";

interface IdeEditorPaneProps {
  selectedFile: IdeSelectedFile | null;
}

function IDEHeaderTitle(props: {
  fileName: string | null;
  canPreviewMarkdown: boolean;
  markdownPreviewEnabled: boolean;
  diffEnabled: boolean;
  onCopyFileName: () => void;
  onToggleMarkdownPreview: () => void;
  onToggleDiff: () => void;
}) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {props.fileName ?? "No file selected"}
        </span>
        {props.fileName ? (
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={props.onCopyFileName}
            aria-label="Copy file name"
            className="text-muted-foreground/60 hover:text-foreground"
          >
            <CopyIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant={props.markdownPreviewEnabled ? "secondary" : "ghost"}
                disabled={!props.canPreviewMarkdown}
                onClick={props.onToggleMarkdownPreview}
                aria-label="Toggle markdown preview"
              >
                <EyeIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup>Toggle Markdown Preview</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant={props.diffEnabled ? "secondary" : "ghost"}
                onClick={props.onToggleDiff}
                aria-label="Toggle diff viewer"
              >
                <DiffIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup>Toggle Diff Viewer</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

function IDEHeaderBreadcrumbs(props: { absolutePath: string | null; relativePath: string | null }) {
  const breadcrumbSegments = (() => {
    const relativeSegments =
      props.relativePath?.split("/").filter((segment) => segment.length > 0) ?? [];
    const segments: { key: string; label: string }[] = [];
    let currentPath = "";
    for (const segment of relativeSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      segments.push({ key: currentPath, label: segment });
    }
    return segments;
  })();

  const handleContextMenu = async (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      return;
    }

    const clicked = await api.contextMenu.show(
      [
        { id: "copy-relative", label: "Copy relative path" },
        { id: "copy-absolute", label: "Copy absolute path" },
      ],
      { x: event.clientX, y: event.clientY },
    );

    if (clicked === "copy-relative" && props.relativePath) {
      await navigator.clipboard.writeText(props.relativePath);
    }
    if (clicked === "copy-absolute" && props.absolutePath) {
      await navigator.clipboard.writeText(props.absolutePath);
    }
  };

  return (
    <div
      className="flex min-h-[22px] items-center gap-1 overflow-hidden text-[11px] text-muted-foreground"
      onContextMenu={handleContextMenu}
    >
      {breadcrumbSegments.length === 0 ? (
        <span className="truncate">Awaiting file selection</span>
      ) : (
        breadcrumbSegments.map((segment, index) => (
          <div key={segment.key} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
            <span
              className={cn(
                "truncate",
                index === breadcrumbSegments.length - 1 && "font-medium text-foreground/80",
              )}
            >
              {segment.label}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function IDEHeader(props: {
  selectedFile: IdeSelectedFile | null;
  canPreviewMarkdown: boolean;
  markdownPreviewEnabled: boolean;
  diffEnabled: boolean;
  onCopyFileName: () => void;
  onToggleMarkdownPreview: () => void;
  onToggleDiff: () => void;
}) {
  return (
    <header className="border-b border-border px-4 py-2">
      <IDEHeaderTitle
        fileName={props.selectedFile?.fileName ?? null}
        canPreviewMarkdown={props.canPreviewMarkdown}
        markdownPreviewEnabled={props.markdownPreviewEnabled}
        diffEnabled={props.diffEnabled}
        onCopyFileName={props.onCopyFileName}
        onToggleMarkdownPreview={props.onToggleMarkdownPreview}
        onToggleDiff={props.onToggleDiff}
      />
      <IDEHeaderBreadcrumbs
        absolutePath={props.selectedFile?.absolutePath ?? null}
        relativePath={props.selectedFile?.relativePath ?? null}
      />
    </header>
  );
}

function IdeCodeMinimap(props: {
  content: string;
  markers: ReadonlyMap<number, "added" | "modified">;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const [scrollState, setScrollState] = useState({
    clientHeight: 1,
    scrollHeight: 1,
    scrollTop: 0,
  });
  const segments = useMemo(() => {
    const lines = props.content.split("\n");
    const maxSegments = 180;
    const chunkSize = Math.max(1, Math.ceil(lines.length / maxSegments));
    return Array.from({ length: Math.ceil(lines.length / chunkSize) }, (_, index) => {
      const lineStart = index * chunkSize + 1;
      const lineEnd = Math.min(lines.length, (index + 1) * chunkSize);
      let marker: "added" | "modified" | null = null;
      for (let lineNumber = lineStart; lineNumber <= lineEnd; lineNumber += 1) {
        const nextMarker = props.markers.get(lineNumber);
        if (nextMarker === "modified") {
          marker = "modified";
          break;
        }
        if (nextMarker === "added") {
          marker = "added";
        }
      }
      return { marker, startLine: lineStart };
    });
  }, [props.content, props.markers]);

  useEffect(() => {
    const node = props.scrollContainerRef.current;
    if (!node) {
      return;
    }
    const update = () => {
      setScrollState({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      });
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      node.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [props.scrollContainerRef]);

  const viewportHeightRatio = Math.min(1, scrollState.clientHeight / scrollState.scrollHeight);
  const viewportTopRatio = Math.min(
    1 - viewportHeightRatio,
    scrollState.scrollTop / Math.max(1, scrollState.scrollHeight - scrollState.clientHeight),
  );

  return (
    <div className="hidden w-14 shrink-0 border-l border-border/60 bg-muted/20 px-2 py-3 lg:block">
      <div
        className="relative h-full cursor-pointer overflow-hidden rounded-sm bg-background/80"
        onClick={(event) => {
          const container = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - container.top) / Math.max(container.height, 1);
          const scrollNode = props.scrollContainerRef.current;
          if (!scrollNode) {
            return;
          }
          scrollNode.scrollTop =
            ratio * Math.max(0, scrollNode.scrollHeight - scrollNode.clientHeight);
        }}
      >
        <div className="flex h-full flex-col gap-px px-1 py-1">
          {segments.map((segment) => (
            <div
              key={segment.startLine}
              className={cn(
                "min-h-[2px] flex-1 rounded-full bg-muted-foreground/12",
                segment.marker === "added" && "bg-emerald-500/45",
                segment.marker === "modified" && "bg-amber-500/45",
              )}
            />
          ))}
        </div>
        <div
          className="pointer-events-none absolute left-0 right-0 rounded-sm border border-primary/40 bg-primary/8"
          style={{
            top: `${viewportTopRatio * 100}%`,
            height: `${Math.max(8, viewportHeightRatio * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}

const IdeBlankState = memo(function IdeBlankState() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-sm font-medium text-foreground/80">No file selected</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a file from Changes or Explorer to open it here.
        </p>
      </div>
    </div>
  );
});

export const IdeEditorPane = memo(function IdeEditorPane({ selectedFile }: IdeEditorPaneProps) {
  const { resolvedTheme } = useTheme();
  const markdownPreviewEnabled = useUiStateStore((state) => state.ideMarkdownPreviewEnabled);
  const diffEnabled = useUiStateStore((state) => state.ideDiffEnabled);
  const toggleMarkdownPreview = useUiStateStore((state) => state.toggleIdeMarkdownPreview);
  const toggleDiff = useUiStateStore((state) => state.toggleIdeDiff);
  const { copyToClipboard } = useCopyToClipboard();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const canPreviewMarkdown = isMarkdownPath(selectedFile?.absolutePath);
  const contentState = useWorkspaceFileContentState({
    threadId: selectedFile?.threadId ?? null,
    worktreePath: selectedFile?.worktreePath ?? null,
    absolutePath: selectedFile?.absolutePath ?? null,
    enabled: selectedFile !== null,
    mode: diffEnabled ? "diff" : "preview",
  });
  const diffState = useResolvedFileDiffState({
    threadId: selectedFile?.threadId ?? null,
    selectedFilePath: selectedFile?.displayPath ?? null,
    selectedFileQueryPath: selectedFile?.sourcePath ?? selectedFile?.relativePath ?? null,
    enabled: selectedFile !== null,
    latestCheckpointTurnCount: selectedFile?.latestCheckpointTurnCount ?? null,
    cacheScope: `ide-editor:${selectedFile?.displayPath ?? selectedFile?.absolutePath ?? "selection"}`,
  });
  const diffThemeName = resolveDiffThemeName(resolvedTheme);

  if (!selectedFile) {
    return <IdeBlankState />;
  }

  const loadedContent = contentState.status === "loaded" ? contentState.content : "";
  const showMarkdownPreview = canPreviewMarkdown && markdownPreviewEnabled;
  const showDiff = diffEnabled;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <IDEHeader
        selectedFile={selectedFile}
        canPreviewMarkdown={canPreviewMarkdown}
        markdownPreviewEnabled={showMarkdownPreview}
        diffEnabled={showDiff}
        onCopyFileName={() => copyToClipboard(selectedFile.fileName, undefined)}
        onToggleMarkdownPreview={toggleMarkdownPreview}
        onToggleDiff={toggleDiff}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto">
          {contentState.status === "error" ? (
            <div className="m-4 rounded-2xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive">
              {contentState.message}
            </div>
          ) : showDiff ? (
            diffState.diffMetadata ? (
              <DiffWorkerPoolProvider>
                <FileDiff
                  fileDiff={diffState.diffMetadata}
                  options={{
                    theme: diffThemeName,
                    themeType: resolvedTheme,
                    disableFileHeader: true,
                    overflow: "scroll",
                    collapsed: false,
                  }}
                />
              </DiffWorkerPoolProvider>
            ) : (
              <div className="m-4 rounded-2xl border border-border/70 bg-card/92 p-4 text-sm text-muted-foreground">
                {diffState.error ?? "No diff is available for this file in the current thread."}
              </div>
            )
          ) : showMarkdownPreview ? (
            <div className="mx-auto max-w-4xl px-4 py-6">
              <ChatMarkdown
                text={loadedContent}
                cwd={selectedFile.worktreePath ?? undefined}
                variant="document"
              />
            </div>
          ) : (
            <div className="min-h-full px-4 py-4">
              <CodeFileViewer
                path={selectedFile.absolutePath}
                content={loadedContent}
                markers={diffState.markers}
                loading={contentState.status === "loading"}
                error={null}
              />
            </div>
          )}
        </div>

        {!showDiff && !showMarkdownPreview && contentState.status === "loaded" ? (
          <IdeCodeMinimap
            content={loadedContent}
            markers={diffState.markers}
            scrollContainerRef={scrollContainerRef}
          />
        ) : null}
      </div>
    </div>
  );
});
