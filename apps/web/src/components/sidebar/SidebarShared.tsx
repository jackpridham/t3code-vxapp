import { type ReactNode } from "react";
import { ArrowUpDownIcon, ListFilterIcon } from "lucide-react";
import { type ProjectId } from "@t3tools/contracts";
import {
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
} from "@t3tools/contracts/settings";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../lib/utils";
import { SIDEBAR_PROJECT_SORT_LABELS, SIDEBAR_THREAD_SORT_LABELS } from "../../lib/sidebarSettings";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

export function VortexWordmark() {
  return (
    <span
      aria-label="vortex"
      className="inline-flex shrink-0 text-sm font-semibold lowercase tracking-normal text-foreground"
    >
      vortex
    </span>
  );
}

export function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Sidebar sort options"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                />
              }
            >
              <ArrowUpDownIcon className="size-3.5" />
            </MenuTrigger>
          }
        />
        <TooltipPopup side="top">Sort options</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <MenuGroupLabel>Projects</MenuGroupLabel>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => onProjectSortOrderChange(value as SidebarProjectSortOrder)}
          >
            {Object.entries(SIDEBAR_PROJECT_SORT_LABELS).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Threads</MenuGroupLabel>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => onThreadSortOrderChange(value as SidebarThreadSortOrder)}
          >
            {Object.entries(SIDEBAR_THREAD_SORT_LABELS).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function LabelFilterMenu({
  availableLabels,
  selectedLabels,
  onToggleLabel,
  onClearLabels,
  triggerClassName,
}: {
  availableLabels: readonly string[];
  selectedLabels: readonly string[];
  onToggleLabel: (label: string) => void;
  onClearLabels: () => void;
  triggerClassName?: string;
}) {
  if (availableLabels.length === 0) return null;

  const hasActive = selectedLabels.length > 0;

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  data-thread-selection-safe
                  aria-label={
                    hasActive
                      ? `Filter by label (${selectedLabels.length} active)`
                      : "Filter threads by label"
                  }
                  className={cn(
                    "absolute top-1 right-7 inline-flex size-5 cursor-pointer items-center justify-center rounded-md p-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    hasActive
                      ? "pointer-events-auto text-primary opacity-100"
                      : "pointer-events-none text-muted-foreground/70 opacity-0 hover:bg-secondary hover:text-foreground group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100 group-focus-within/menu-item:pointer-events-auto group-focus-within/menu-item:opacity-100",
                    triggerClassName,
                  )}
                />
              }
            />
          }
        >
          <ListFilterIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">Filter by label</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <MenuGroupLabel>Filter by label</MenuGroupLabel>
          {availableLabels.map((label) => (
            <MenuCheckboxItem
              key={label}
              checked={selectedLabels.includes(label)}
              onCheckedChange={() => onToggleLabel(label)}
              className="min-h-7 py-1 sm:text-xs"
            >
              <span className="truncate">{label}</span>
            </MenuCheckboxItem>
          ))}
          {hasActive ? (
            <>
              <MenuSeparator />
              <MenuCheckboxItem
                checked={false}
                onCheckedChange={onClearLabels}
                className="min-h-7 py-1 sm:text-xs text-muted-foreground"
              >
                Clear filters
              </MenuCheckboxItem>
            </>
          ) : null}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: ProjectId;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}
