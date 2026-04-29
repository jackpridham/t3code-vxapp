import { memo, useState } from "react";
import {
  ChevronDownIcon,
  CheckIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { type WorkLogEntry } from "../../session-logic";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import { cn } from "~/lib/utils";

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

interface WorkLogGroupProps {
  groupId: string;
  groupedEntries: readonly WorkLogEntry[];
  isExpanded: boolean;
  onToggleGroup: (groupId: string) => void;
}

export const WorkLogGroup = memo(function WorkLogGroup({
  groupId,
  groupedEntries,
  isExpanded,
  onToggleGroup,
}: WorkLogGroupProps) {
  const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded
      ? groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : groupedEntries;
  const hiddenCount = groupedEntries.length - visibleEntries.length;
  const onlyToolEntries = groupedEntries.every((entry) => entry.tone === "tool");
  const onlyThinkingEntries = groupedEntries.every((entry) => entry.tone === "thinking");
  const showHeader = hasOverflow || !onlyToolEntries;
  const groupLabel = onlyToolEntries ? "Tool calls" : onlyThinkingEntries ? "Thinking" : "Work log";

  return (
    <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
      {showHeader && (
        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
          <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
            {groupLabel} ({groupedEntries.length})
          </p>
          {hasOverflow && (
            <button
              type="button"
              className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
              onClick={() => onToggleGroup(groupId)}
            >
              {isExpanded ? "Show less" : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
      <div className="space-y-0.5">
        {visibleEntries.map((workEntry) => (
          <SimpleWorkEntryRow key={`work-row:${workEntry.id}`} workEntry={workEntry} />
        ))}
      </div>
    </div>
  );
});

function workToneIcon(tone: "thinking" | "tool" | "info" | "error"): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: WrenchIcon,
      className: "text-rose-300/70 dark:text-rose-300/65",
    };
  }
  if (tone === "tool") {
    return {
      icon: WrenchIcon,
      className: "text-muted-foreground/72",
    };
  }
  if (tone === "thinking") {
    return {
      icon: GlobeIcon,
      className: "text-foreground/72",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/92",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/92",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

function workEntryPreview(
  workEntry: Pick<WorkLogEntry, "detail" | "command" | "changedFiles" | "thoughts">,
) {
  const latestThought = visibleThoughts(workEntry.thoughts).at(-1);
  if (latestThought) return latestThought;
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  return workEntry.changedFiles!.length === 1
    ? firstPath
    : `${firstPath} +${workEntry.changedFiles!.length - 1} more`;
}

function hasExpandableWorkEntryContent(workEntry: WorkLogEntry): boolean {
  return (
    visibleThoughts(workEntry.thoughts).length > 0 ||
    Boolean(workEntry.command) ||
    Boolean(workEntry.detail) ||
    Boolean(workEntry.rawPayload) ||
    (workEntry.changedFiles?.length ?? 0) > 0
  );
}

function visibleThoughts(thoughts: ReadonlyArray<string> | undefined): string[] {
  if (!thoughts) {
    return [];
  }
  return thoughts.map((thought) => thought.trim()).filter((thought) => thought.length > 0);
}

function workEntryIcon(workEntry: WorkLogEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: WorkLogEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: { workEntry: WorkLogEntry }) {
  const { workEntry } = props;
  const [expanded, setExpanded] = useState(false);
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const showExpandToggle = hasExpandableWorkEntryContent(workEntry);
  const thoughtItems = visibleThoughts(workEntry.thoughts);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="rounded-lg px-1 py-1">
        <div className="flex items-start gap-2 transition-[opacity,translate] duration-200">
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center pt-0.5",
              iconConfig.className,
            )}
          >
            <EntryIcon className="size-3" />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p
              className={cn(
                "truncate text-[11px] leading-5",
                workToneClass(workEntry.tone),
                preview ? "text-muted-foreground/70" : "",
              )}
              title={displayText}
            >
              <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                {heading}
              </span>
              {preview && <span className="text-muted-foreground/55"> - {preview}</span>}
            </p>
          </div>
          {showExpandToggle ? (
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground/70"
                />
              }
              aria-label={expanded ? "Hide work entry details" : "Show work entry details"}
            >
              <ChevronDownIcon
                className={cn("size-3 transition-transform", expanded && "rotate-180")}
              />
              <span>{expanded ? "Hide" : "Show"}</span>
            </CollapsibleTrigger>
          ) : null}
        </div>
        {hasChangedFiles && !previewIsChangedFiles && !expanded && (
          <div className="mt-1 flex flex-wrap gap-1 pl-6">
            {workEntry.changedFiles?.slice(0, 4).map((filePath) => (
              <span
                key={`${workEntry.id}:${filePath}`}
                className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                title={filePath}
              >
                {filePath}
              </span>
            ))}
            {(workEntry.changedFiles?.length ?? 0) > 4 && (
              <span className="px-1 text-[10px] text-muted-foreground/55">
                +{(workEntry.changedFiles?.length ?? 0) - 4}
              </span>
            )}
          </div>
        )}
        {showExpandToggle ? (
          <CollapsibleContent>
            <div className="mt-2 space-y-2 pl-6">
              {thoughtItems.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    Thoughts
                  </p>
                  <ol className="space-y-2 pl-4 text-[11px] leading-5 text-foreground/85">
                    {thoughtItems.map((thought) => (
                      <li key={`${workEntry.id}:thought:${thought}`} className="list-decimal">
                        <pre className="whitespace-pre-wrap break-words font-mono">{thought}</pre>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {workEntry.command ? (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    Command
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/55 bg-background/75 px-2 py-1.5 font-mono text-[11px] leading-5 text-foreground/85">
                    {workEntry.command}
                  </pre>
                </div>
              ) : null}
              {workEntry.detail && thoughtItems.length === 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    Detail
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/55 bg-background/75 px-2 py-1.5 font-mono text-[11px] leading-5 text-foreground/85">
                    {workEntry.detail}
                  </pre>
                </div>
              ) : null}
              {hasChangedFiles ? (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    Changed files
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {workEntry.changedFiles?.map((filePath) => (
                      <span
                        key={`${workEntry.id}:expanded:${filePath}`}
                        className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                        title={filePath}
                      >
                        {filePath}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {workEntry.rawPayload && thoughtItems.length === 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                    Raw payload
                  </p>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/55 bg-background/75 px-2 py-1.5 font-mono text-[11px] leading-5 text-foreground/85">
                    {workEntry.rawPayload}
                  </pre>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
});
