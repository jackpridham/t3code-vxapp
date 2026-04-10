import { type ProjectHook } from "@t3tools/contracts";
import { memo } from "react";
import { ArrowUpRightIcon, FolderOpenIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectHooksControl, { type NewProjectHookInput } from "../ProjectHooksControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { Button } from "../ui/button";
import { getDisplayThreadLabelEntries } from "../../lib/threadLabels";
import { WorkerLineageWarningIcon } from "../thread/WorkerLineageWarningIcon";

interface ChatHeaderProps {
  activeThreadLabels?: string[] | undefined;
  activeThreadWorkerLineageWarning?: string | null;
  activeProjectName: string | undefined;
  activeProjectHooks: ProjectHook[] | undefined;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  changesPanelShortcutLabel: string | null;
  changesPanelOpen: boolean;
  showChangesDrawerToggle: boolean;
  onAddProjectHook: (input: NewProjectHookInput) => Promise<void>;
  onUpdateProjectHook: (hookId: string, input: NewProjectHookInput) => Promise<void>;
  onDeleteProjectHook: (hookId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleChangesPanel: () => void;
  onOpenChangesWindow: () => void;
  onLabelClick?: (label: string) => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadLabels,
  activeThreadWorkerLineageWarning,
  activeProjectName,
  activeProjectHooks,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  changesPanelShortcutLabel,
  changesPanelOpen,
  showChangesDrawerToggle,
  onAddProjectHook,
  onUpdateProjectHook,
  onDeleteProjectHook,
  onToggleTerminal,
  onToggleChangesPanel,
  onOpenChangesWindow,
  onLabelClick,
}: ChatHeaderProps) {
  const visibleThreadLabels = getDisplayThreadLabelEntries(activeThreadLabels);

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {visibleThreadLabels.length > 0 && (
          <div className="hidden items-center gap-1 overflow-hidden sm:flex">
            {visibleThreadLabels.map((label) => (
              <Badge
                key={label.key}
                variant="outline"
                title={`Click to filter by "${label.displayLabel}"`}
                className="h-5 min-w-0 max-w-24 shrink-0 cursor-pointer px-1.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => onLabelClick?.(label.rawLabel)}
              >
                <span className="truncate">{label.displayLabel}</span>
              </Badge>
            ))}
          </div>
        )}
        <WorkerLineageWarningIcon description={activeThreadWorkerLineageWarning ?? null} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectHooks && (
          <ProjectHooksControl
            hooks={activeProjectHooks}
            onAddHook={onAddProjectHook}
            onUpdateHook={onUpdateProjectHook}
            onDeleteHook={onDeleteProjectHook}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="shrink-0"
                onClick={onOpenChangesWindow}
                aria-label="Open changes in separate window"
                variant="outline"
                size="icon-xs"
              >
                <ArrowUpRightIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">Open changes in separate window</TooltipPopup>
        </Tooltip>
        {showChangesDrawerToggle ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={changesPanelOpen}
                  onPressedChange={onToggleChangesPanel}
                  aria-label="Toggle changes panel"
                  variant="outline"
                  size="xs"
                >
                  <FolderOpenIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {changesPanelShortcutLabel
                ? `Toggle changes panel (${changesPanelShortcutLabel})`
                : "Toggle changes panel"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
});
