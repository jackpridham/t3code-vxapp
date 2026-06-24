import { type MessageId } from "@t3tools/contracts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  measureElement as measureVirtualElement,
  type VirtualItem,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "../../chat-scroll";
import ChatMarkdown from "../ChatMarkdown";
import { ChevronDownIcon, Undo2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { clamp } from "effect/Number";
import { estimateTimelineMessageHeight } from "../timelineHeight";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { MessageMeta } from "./MessageMeta";
import { MessageCopyButton } from "./MessageCopyButton";
import { SkillReferenceChip } from "./SkillReferenceChip";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { WorkLogGroup } from "./WorkLogGroup";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatShortTimestamp } from "../../timestampFormat";
import { splitTextIntoSkillReferenceSegments } from "~/lib/skillReferences";
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { cn } from "~/lib/utils";
import {
  deriveTimelineRows,
  type TimelineRow,
  type TimelineThinking,
} from "./MessagesTimeline.rows";

const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;

interface MessagesTimelineProps {
  hasMessages: boolean;
  isHydratingHistory: boolean;
  isWorking: boolean;
  layoutMode?: "default" | "drawer" | undefined;
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  scrollContainer: HTMLDivElement | null;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionDuration: string | null;
  nowIso?: string;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  markdownCwd: string | undefined;
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isHydratingHistory,
  isWorking,
  layoutMode = "default",
  activeTurnInProgress,
  activeTurnStartedAt,
  scrollContainer,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionDuration,
  nowIso,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  markdownCwd,
  timestampFormat,
  workspaceRoot,
}: MessagesTimelineProps) {
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const [timelineWidthPx, setTimelineWidthPx] = useState<number | null>(null);
  const previousRowsRef = useRef<ReadonlyArray<TimelineRow>>([]);

  useLayoutEffect(() => {
    const timelineRoot = timelineRootRef.current;
    if (!timelineRoot) return;

    const updateWidth = (nextWidth: number) => {
      setTimelineWidthPx((previousWidth) => {
        if (previousWidth !== null && Math.abs(previousWidth - nextWidth) < 0.5) {
          return previousWidth;
        }
        return nextWidth;
      });
    };

    updateWidth(timelineRoot.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateWidth(timelineRoot.getBoundingClientRect().width);
    });
    observer.observe(timelineRoot);
    return () => {
      observer.disconnect();
    };
  }, [hasMessages, isWorking]);

  const rows = useMemo(() => {
    const nextRows = deriveTimelineRows(
      {
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnStartedAt,
        revertTurnCountByUserMessageId,
      },
      previousRowsRef.current,
    );
    previousRowsRef.current = nextRows;
    return nextRows;
  }, [
    activeTurnStartedAt,
    completionDividerBeforeEntryId,
    isWorking,
    revertTurnCountByUserMessageId,
    timelineEntries,
  ]);

  const firstUnvirtualizedRowIndex = useMemo(() => {
    const firstTailRowIndex = Math.max(rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS, 0);
    if (!activeTurnInProgress) return firstTailRowIndex;

    const turnStartedAtMs =
      typeof activeTurnStartedAt === "string" ? Date.parse(activeTurnStartedAt) : Number.NaN;
    let firstCurrentTurnRowIndex = -1;
    if (!Number.isNaN(turnStartedAtMs)) {
      firstCurrentTurnRowIndex = rows.findIndex((row) => {
        if (row.kind === "working") return true;
        if (!row.createdAt) return false;
        const rowCreatedAtMs = Date.parse(row.createdAt);
        return !Number.isNaN(rowCreatedAtMs) && rowCreatedAtMs >= turnStartedAtMs;
      });
    }

    if (firstCurrentTurnRowIndex < 0) {
      firstCurrentTurnRowIndex = rows.findIndex(
        (row) => row.kind === "message" && row.message.streaming,
      );
    }

    if (firstCurrentTurnRowIndex < 0) return firstTailRowIndex;

    for (let index = firstCurrentTurnRowIndex - 1; index >= 0; index -= 1) {
      const previousRow = rows[index];
      if (!previousRow || previousRow.kind !== "message") continue;
      if (previousRow.message.role === "user") {
        return Math.min(index, firstTailRowIndex);
      }
      if (previousRow.message.role === "assistant" && !previousRow.message.streaming) {
        break;
      }
    }

    return Math.min(firstCurrentTurnRowIndex, firstTailRowIndex);
  }, [activeTurnInProgress, activeTurnStartedAt, rows]);

  const virtualizedRowCount = clamp(firstUnvirtualizedRowIndex, {
    minimum: 0,
    maximum: rows.length,
  });
  const [expandedThinkingById, setExpandedThinkingById] = useState<Record<string, boolean>>({});
  const onToggleThinking = useCallback((thinkingId: string) => {
    setExpandedThinkingById((current) => ({
      ...current,
      [thinkingId]: !(current[thinkingId] ?? false),
    }));
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollContainer,
    // Use stable row ids so virtual measurements do not leak across thread switches.
    getItemKey: (index: number) => rows[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = rows[index];
      if (!row) return 96;
      if (row.kind === "work") return 112;
      if (row.kind === "thinking") {
        return estimateTimelineThinkingHeight(
          row.thinking,
          resolveThinkingExpansionState(
            row,
            expandedThinkingById,
            activeTurnInProgress,
            activeTurnStartedAt,
          ),
          timelineWidthPx,
        );
      }
      if (row.kind === "proposed-plan") return estimateTimelineProposedPlanHeight(row.proposedPlan);
      if (row.kind === "working") return 40;
      return estimateTimelineMessageHeight(row.message, { timelineWidthPx });
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    if (timelineWidthPx === null) return;
    rowVirtualizer.measure();
  }, [rowVirtualizer, timelineWidthPx]);
  useEffect(() => {
    rowVirtualizer.measure();
  }, [expandedThinkingById, rowVirtualizer]);
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const itemIntersectsViewport =
        item.end > scrollOffset && item.start < scrollOffset + viewportHeight;
      if (itemIntersectsViewport) {
        return false;
      }
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const pendingMeasureFrameRef = useRef<number | null>(null);
  const onTimelineImageLoad = useCallback(() => {
    if (pendingMeasureFrameRef.current !== null) return;
    pendingMeasureFrameRef.current = window.requestAnimationFrame(() => {
      pendingMeasureFrameRef.current = null;
      rowVirtualizer.measure();
    });
  }, [rowVirtualizer]);
  useEffect(() => {
    return () => {
      const frame = pendingMeasureFrameRef.current;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const nonVirtualizedRows = rows.slice(virtualizedRowCount);

  const renderRowContent = (row: TimelineRow) => (
    <TimelineRowContent
      row={row}
      layoutMode={layoutMode}
      activeTurnInProgress={activeTurnInProgress}
      activeTurnStartedAt={activeTurnStartedAt}
      expandedThinkingById={expandedThinkingById}
      onToggleThinking={onToggleThinking}
      isRevertingCheckpoint={isRevertingCheckpoint}
      isWorking={isWorking}
      onRevertUserMessage={onRevertUserMessage}
      onImageExpand={onImageExpand}
      onTimelineImageLoad={onTimelineImageLoad}
      timestampFormat={timestampFormat}
      markdownCwd={markdownCwd}
      workspaceRoot={workspaceRoot}
      completionDuration={completionDuration}
      nowIso={nowIso}
    />
  );

  if (!hasMessages && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          {isHydratingHistory
            ? "Loading conversation history..."
            : "Send a message to start the conversation."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={timelineRootRef}
      data-timeline-root="true"
      className={cn(
        "w-full min-w-0 overflow-hidden",
        layoutMode === "drawer" ? "max-w-none" : "mx-auto max-w-3xl",
      )}
    >
      {virtualizedRowCount > 0 && (
        <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow: VirtualItem) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            return (
              <div
                key={`virtual-row:${row.id}`}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {renderRowContent(row)}
              </div>
            );
          })}
        </div>
      )}

      {nonVirtualizedRows.map((row) => (
        <div key={`non-virtual-row:${row.id}`}>{renderRowContent(row)}</div>
      ))}
    </div>
  );
});

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineProposedPlan = Extract<TimelineEntry, { kind: "proposed-plan" }>["proposedPlan"];

const TimelineRowContent = memo(function TimelineRowContent(props: {
  row: TimelineRow;
  layoutMode: "default" | "drawer";
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  expandedThinkingById: Record<string, boolean>;
  onToggleThinking: (thinkingId: string) => void;
  isRevertingCheckpoint: boolean;
  isWorking: boolean;
  onRevertUserMessage: (messageId: MessageId) => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onTimelineImageLoad: () => void;
  timestampFormat: TimestampFormat;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  completionDuration: string | null;
  nowIso: string | undefined;
}) {
  const { row } = props;

  return (
    <div
      className="min-w-0 pb-4"
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" ? <WorkLogGroup groupedEntries={row.groupedEntries} /> : null}

      {row.kind === "thinking" ? (
        <ThinkingBubble
          thinking={row.thinking}
          isExpanded={resolveThinkingExpansionState(
            row,
            props.expandedThinkingById,
            props.activeTurnInProgress,
            props.activeTurnStartedAt,
          )}
          onToggle={() => props.onToggleThinking(row.id)}
        />
      ) : null}

      {row.kind === "message" && row.message.role === "user" ? (
        <UserMessageRow
          row={row}
          layoutMode={props.layoutMode}
          isRevertingCheckpoint={props.isRevertingCheckpoint}
          isWorking={props.isWorking}
          onRevertUserMessage={props.onRevertUserMessage}
          onImageExpand={props.onImageExpand}
          onTimelineImageLoad={props.onTimelineImageLoad}
          timestampFormat={props.timestampFormat}
        />
      ) : null}

      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantMessageRow
          row={row}
          completionDuration={props.completionDuration}
          timestampFormat={props.timestampFormat}
          markdownCwd={props.markdownCwd}
          nowIso={props.nowIso}
        />
      ) : null}

      {row.kind === "proposed-plan" ? (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={props.markdownCwd}
            workspaceRoot={props.workspaceRoot}
          />
        </div>
      ) : null}

      {row.kind === "working" ? <WorkingIndicatorRow row={row} nowIso={props.nowIso} /> : null}
    </div>
  );
});

const UserMessageRow = memo(function UserMessageRow(props: {
  row: Extract<TimelineRow, { kind: "message" }>;
  layoutMode: "default" | "drawer";
  isRevertingCheckpoint: boolean;
  isWorking: boolean;
  onRevertUserMessage: (messageId: MessageId) => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onTimelineImageLoad: () => void;
  timestampFormat: TimestampFormat;
}) {
  const userImages = props.row.message.attachments ?? [];
  const displayedUserMessage = deriveDisplayedUserMessageState(props.row.message.text);
  const terminalContexts = displayedUserMessage.contexts;

  return (
    <div className="flex min-w-0 justify-end">
      <div
        className={cn(
          "group relative min-w-0 rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3",
          props.layoutMode === "drawer" ? "max-w-[92%]" : "max-w-[80%]",
        )}
      >
        {userImages.length > 0 && (
          <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
            {userImages.map((image: NonNullable<TimelineMessage["attachments"]>[number]) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
              >
                {image.previewUrl ? (
                  <button
                    type="button"
                    className="h-full w-full cursor-zoom-in"
                    aria-label={`Preview ${image.name}`}
                    onClick={() => {
                      const preview = buildExpandedImagePreview(userImages, image.id);
                      if (!preview) return;
                      props.onImageExpand(preview);
                    }}
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full max-h-[220px] w-full object-cover"
                      onLoad={props.onTimelineImageLoad}
                      onError={props.onTimelineImageLoad}
                    />
                  </button>
                ) : (
                  <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                    {image.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {(displayedUserMessage.visibleText.trim().length > 0 || terminalContexts.length > 0) && (
          <UserMessageBody
            text={displayedUserMessage.visibleText}
            terminalContexts={terminalContexts}
          />
        )}
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
            {displayedUserMessage.copyText ? (
              <MessageCopyButton text={displayedUserMessage.copyText} />
            ) : null}
            {props.row.canRevertAgentWork ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={props.isRevertingCheckpoint || props.isWorking}
                onClick={() => props.onRevertUserMessage(props.row.message.id)}
                title="Revert to this message"
              >
                <Undo2Icon className="size-3" />
              </Button>
            ) : null}
          </div>
          <MessageMeta
            createdAt={props.row.message.createdAt}
            timestampFormat={props.timestampFormat}
            align="right"
          />
        </div>
      </div>
    </div>
  );
});

const AssistantMessageRow = memo(function AssistantMessageRow(props: {
  row: Extract<TimelineRow, { kind: "message" }>;
  completionDuration: string | null;
  timestampFormat: TimestampFormat;
  markdownCwd: string | undefined;
  nowIso: string | undefined;
}) {
  const messageText =
    props.row.message.text || (props.row.message.streaming ? "" : "(empty response)");

  return (
    <>
      {props.row.showCompletionDivider ? (
        <div className="my-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="rounded-full border border-border bg-background px-3 py-1.5 text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
            <span className="block text-[11px] tracking-[0.08em] text-foreground/85">
              {formatDividerTimestamp(
                props.row.message.completedAt ?? props.row.message.createdAt,
                props.timestampFormat,
              )}
            </span>
            <span className="block">
              {props.completionDuration ? `Worked for ${props.completionDuration}` : "Worked"}
            </span>
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <div className="w-full min-w-0 px-1 py-0.5">
        <ChatMarkdown
          text={messageText}
          cwd={props.markdownCwd}
          isStreaming={Boolean(props.row.message.streaming)}
        />
        {!props.row.showCompletionDivider ? (
          <AssistantMessageMeta
            createdAt={props.row.message.createdAt}
            durationStart={props.row.durationStart}
            completedAt={props.row.message.completedAt}
            isStreaming={Boolean(props.row.message.streaming)}
            timestampFormat={props.timestampFormat}
            nowIso={props.nowIso}
          />
        ) : null}
      </div>
    </>
  );
});

const AssistantMessageMeta = memo(function AssistantMessageMeta(props: {
  createdAt: string;
  durationStart: string;
  completedAt: string | undefined;
  isStreaming: boolean;
  timestampFormat: TimestampFormat;
  nowIso: string | undefined;
}) {
  const resolvedNowIso = useResolvedNowIso(props.isStreaming, props.nowIso);
  return (
    <MessageMeta
      createdAt={props.createdAt}
      duration={
        props.isStreaming
          ? formatElapsed(props.durationStart, resolvedNowIso)
          : formatElapsed(props.durationStart, props.completedAt)
      }
      timestampFormat={props.timestampFormat}
      className="mt-1.5"
    />
  );
});

const WorkingIndicatorRow = memo(function WorkingIndicatorRow(props: {
  row: Extract<TimelineRow, { kind: "working" }>;
  nowIso: string | undefined;
}) {
  const resolvedNowIso = useResolvedNowIso(Boolean(props.row.createdAt), props.nowIso);

  return (
    <div className="py-0.5 pl-1.5">
      <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70">
        <span className="inline-flex items-center gap-[3px]">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
        </span>
        <span>
          {props.row.createdAt
            ? `Working for ${formatWorkingTimer(props.row.createdAt, resolvedNowIso) ?? "0s"}`
            : "Working..."}
        </span>
      </div>
    </div>
  );
});

function estimateTimelineProposedPlanHeight(proposedPlan: TimelineProposedPlan): number {
  const estimatedLines = Math.max(1, Math.ceil(proposedPlan.planMarkdown.length / 72));
  return 120 + Math.min(estimatedLines * 22, 880);
}

function estimateTimelineThinkingHeight(
  thinking: TimelineThinking,
  isExpanded: boolean,
  timelineWidthPx: number | null,
): number {
  const latestThought = thinking.detail ?? thinking.thoughts.at(-1) ?? "";
  const width = Math.max(320, timelineWidthPx ?? 720);
  const charsPerLine = Math.max(26, Math.floor((width * 0.8) / 8.5));
  if (!isExpanded) {
    const previewLines = Math.max(1, Math.ceil(latestThought.length / charsPerLine));
    return 92 + Math.min(previewLines * 20, 120);
  }

  const totalLines = Math.max(
    1,
    thinking.thoughts.reduce(
      (sum, thought) => sum + Math.max(1, Math.ceil(thought.length / charsPerLine)),
      0,
    ),
  );
  return 108 + Math.min(totalLines * 22 + thinking.thoughts.length * 10, 960);
}

function useResolvedNowIso(isLive: boolean, fixedNowIso: string | undefined): string {
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (fixedNowIso !== undefined || !isLive) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [fixedNowIso, isLive]);

  return fixedNowIso ?? new Date(nowTick).toISOString();
}

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatDividerTimestamp(createdAt: string, timestampFormat: TimestampFormat): string {
  return formatShortTimestamp(createdAt, timestampFormat).replace(/\s+/g, "").toUpperCase();
}

function resolveThinkingExpansionState(
  row: Extract<TimelineRow, { kind: "thinking" }>,
  expandedThinkingById: Record<string, boolean>,
  activeTurnInProgress: boolean,
  activeTurnStartedAt: string | null,
): boolean {
  const manuallyExpanded = expandedThinkingById[row.id];
  if (manuallyExpanded !== undefined) {
    return manuallyExpanded;
  }
  if (!activeTurnInProgress || activeTurnStartedAt === null) {
    return false;
  }
  return row.createdAt >= activeTurnStartedAt;
}

const ThinkingBubble = memo(function ThinkingBubble(props: {
  thinking: TimelineThinking;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const latestThought = props.thinking.detail ?? props.thinking.thoughts.at(-1) ?? "";
  const hasThoughtHistory = props.thinking.thoughts.length > 1;
  const thoughtOccurrences = new Map<string, number>();

  return (
    <div className="w-full rounded-2xl rounded-bl-sm border border-border/70 bg-card/55 px-4 py-3">
      <div className="mb-2 flex items-center justify-end gap-3">
        {hasThoughtHistory ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground/75 transition-colors duration-150 hover:bg-background/70 hover:text-foreground/80"
            aria-expanded={props.isExpanded}
            aria-label={props.isExpanded ? "Collapse thinking history" : "Expand thinking history"}
            onClick={props.onToggle}
          >
            <ChevronDownIcon
              className={`size-3 transition-transform ${props.isExpanded ? "rotate-180" : ""}`}
            />
            <span>{props.isExpanded ? "Hide" : "Show all"}</span>
          </button>
        ) : null}
      </div>

      {props.isExpanded ? (
        <ol className="space-y-2 pl-5 text-[13px] italic leading-6 text-muted-foreground/65">
          {props.thinking.thoughts.map((thought) => {
            const occurrence = (thoughtOccurrences.get(thought) ?? 0) + 1;
            thoughtOccurrences.set(thought, occurrence);
            return (
              <li
                key={`${props.thinking.id}:thought:${thought}:${occurrence}`}
                className="list-decimal"
              >
                <pre className="whitespace-pre-wrap break-words font-sans italic text-inherit">
                  {thought}
                </pre>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[13px] italic leading-6 text-muted-foreground/65">
          {latestThought}
        </p>
      )}
    </div>
  );
});

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            ...renderUserMessageTextWithSkillReferences(
              props.text.slice(cursor, matchIndex),
              `user-terminal-context-inline-before:${context.header}:${cursor}`,
            ),
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            ...renderUserMessageTextWithSkillReferences(
              props.text.slice(cursor),
              `user-message-terminal-context-inline-rest:${cursor}`,
            ),
          );
        }

        return (
          <div className="wrap-break-word whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(
        ...renderUserMessageTextWithSkillReferences(
          props.text,
          "user-message-terminal-context-inline-text",
        ),
      );
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="wrap-break-word whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-foreground">
      {renderUserMessageTextWithSkillReferences(props.text, "user-message")}
    </pre>
  );
});

function renderUserMessageTextWithSkillReferences(text: string, keyPrefix: string): ReactNode[] {
  let offset = 0;

  return splitTextIntoSkillReferenceSegments(text).map((segment) => {
    const segmentOffset = offset;
    if (segment.type === "skill") {
      offset += segment.skillMarkdownPath.length + 1;
      return (
        <SkillReferenceChip
          key={`${keyPrefix}:skill:${segmentOffset}:${segment.skillMarkdownPath}`}
          skillName={segment.skillName}
          className="mx-px align-baseline"
        />
      );
    }

    offset += segment.text.length;
    return <span key={`${keyPrefix}:text:${segmentOffset}`}>{segment.text}</span>;
  });
}
