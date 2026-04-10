import {
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  type RefCallback,
} from "react";
import { ArchiveIcon, GitPullRequestIcon, TerminalIcon } from "lucide-react";
import { type GitStatusResult, type ThreadId } from "@t3tools/contracts";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveThreadRowClassName, resolveThreadStatusPill } from "../Sidebar.logic";
import { Badge } from "../ui/badge";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkerLineageWarningIcon } from "../thread/WorkerLineageWarningIcon";

export interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

export interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

export type SidebarThreadStatus = NonNullable<ReturnType<typeof resolveThreadStatusPill>>;
export type SidebarThreadPr = GitStatusResult["pr"];

export function ThreadStatusLabel({
  status,
  compact = false,
}: {
  status: SidebarThreadStatus;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        title={status.label}
        className={`inline-flex size-3.5 shrink-0 items-center justify-center ${status.colorClass}`}
      >
        <span
          className={`size-[9px] rounded-full ${status.dotClass} ${
            status.pulse ? "animate-pulse" : ""
          }`}
        />
        <span className="sr-only">{status.label}</span>
      </span>
    );
  }

  return (
    <span
      title={status.label}
      className={`inline-flex items-center gap-1 text-[10px] ${status.colorClass}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.dotClass} ${
          status.pulse ? "animate-pulse" : ""
        }`}
      />
      <span className="hidden md:inline">{status.label}</span>
    </span>
  );
}

export function buildTerminalStatusIndicator(
  runningTerminalIds: readonly string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }

  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

export function buildPrStatusIndicator(pr: SidebarThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }

  return null;
}

export interface SidebarThreadRowProps {
  threadId: ThreadId;
  title: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  isActive: boolean;
  isSelected: boolean;
  jumpLabel: string | null;
  showThreadJumpHints: boolean;
  threadStatus: SidebarThreadStatus | null;
  prStatus: PrStatusIndicator | null;
  terminalStatus: TerminalStatusIndicator | null;
  workerLineageWarning: string | null;
  isThreadRunning: boolean;
  isConfirmingArchive: boolean;
  confirmThreadArchive: boolean;
  confirmArchiveButtonRef: RefCallback<HTMLButtonElement>;
  onMouseLeave: () => void;
  onBlurCapture: FocusEventHandler<HTMLLIElement>;
  onClick: MouseEventHandler<HTMLAnchorElement>;
  onKeyDown: KeyboardEventHandler<HTMLAnchorElement>;
  onContextMenu: MouseEventHandler<HTMLAnchorElement>;
  onOpenPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
  onRequestConfirmArchive: (event: MouseEvent<HTMLButtonElement>) => void;
  onConfirmArchive: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

export function SidebarThreadRow({
  threadId,
  title,
  archivedAt,
  createdAt,
  updatedAt,
  isActive,
  isSelected,
  jumpLabel,
  showThreadJumpHints,
  threadStatus,
  prStatus,
  terminalStatus,
  workerLineageWarning,
  isThreadRunning,
  isConfirmingArchive,
  confirmThreadArchive,
  confirmArchiveButtonRef,
  onMouseLeave,
  onBlurCapture,
  onClick,
  onKeyDown,
  onContextMenu,
  onOpenPrLink,
  onRequestConfirmArchive,
  onConfirmArchive,
  children,
}: SidebarThreadRowProps) {
  const isHighlighted = isActive || isSelected;
  const threadMetaClassName = isConfirmingArchive
    ? "pointer-events-none opacity-0"
    : !isThreadRunning
      ? "pointer-events-none transition-opacity duration-150 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0"
      : "pointer-events-none";

  return (
    <SidebarMenuSubItem
      key={threadId}
      className={`w-full${archivedAt !== null ? " opacity-50" : ""}`}
      data-thread-item
      onMouseLeave={onMouseLeave}
      onBlurCapture={onBlurCapture}
    >
      <SidebarMenuSubButton
        render={<div role="button" tabIndex={0} />}
        size="sm"
        isActive={isActive}
        data-testid={`thread-row-${threadId}`}
        className={`${resolveThreadRowClassName({
          isActive,
          isSelected,
        })} relative isolate`}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {prStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onClick={(event) => {
                      onOpenPrLink(event, prStatus.url);
                    }}
                  >
                    <GitPullRequestIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          {threadStatus && <ThreadStatusLabel status={threadStatus} />}
          <WorkerLineageWarningIcon description={workerLineageWarning} />
          {children}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {terminalStatus && (
            <span
              role="img"
              aria-label={terminalStatus.label}
              title={terminalStatus.label}
              className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
            >
              <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
            </span>
          )}
          <div className="flex min-w-12 justify-end">
            {isConfirmingArchive ? (
              <button
                ref={confirmArchiveButtonRef}
                type="button"
                data-thread-selection-safe
                data-testid={`thread-archive-confirm-${threadId}`}
                aria-label={`Confirm archive ${title}`}
                className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-full bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={onConfirmArchive}
              >
                Confirm
              </button>
            ) : !isThreadRunning ? (
              confirmThreadArchive ? (
                <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`thread-archive-${threadId}`}
                    aria-label={`Archive ${title}`}
                    className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={onRequestConfirmArchive}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`thread-archive-${threadId}`}
                          aria-label={`Archive ${title}`}
                          className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={onConfirmArchive}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </button>
                      </div>
                    }
                  />
                  <TooltipPopup side="top">Archive</TooltipPopup>
                </Tooltip>
              )
            ) : null}
            <span className={threadMetaClassName}>
              {showThreadJumpHints && jumpLabel ? (
                <Badge
                  variant="outline"
                  title={jumpLabel}
                  className="h-5 border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
                >
                  {jumpLabel}
                </Badge>
              ) : (
                <span
                  className={cn(
                    "text-[10px]",
                    isHighlighted
                      ? "text-foreground/72 dark:text-foreground/82"
                      : "text-muted-foreground/40",
                  )}
                >
                  {formatRelativeTimeLabel(updatedAt ?? createdAt)}
                </span>
              )}
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
