import {
  type ComponentProps,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { resolveProjectStatusIndicator } from "../Sidebar.logic";
import { SidebarMenuButton } from "../ui/sidebar";

export interface SidebarProjectHeaderProps {
  activatorRef?: Ref<HTMLButtonElement>;
  isActive: boolean;
  expanded: boolean;
  isOrchestratorProject: boolean;
  isManualProjectSorting: boolean;
  projectName: string;
  projectStatus: ReturnType<typeof resolveProjectStatusIndicator> | null;
  projectIcon: ReactNode;
  className?: string;
  buttonClassName?: string;
  buttonProps?: Partial<ComponentProps<typeof SidebarMenuButton>> | undefined;
  onPointerDownCapture: PointerEventHandler<HTMLButtonElement>;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onContextMenu: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
}

export function SidebarProjectHeader({
  activatorRef,
  isActive,
  expanded,
  isOrchestratorProject,
  isManualProjectSorting,
  projectName,
  projectStatus,
  projectIcon,
  className,
  buttonClassName,
  buttonProps,
  onPointerDownCapture,
  onClick,
  onKeyDown,
  onContextMenu,
  children,
}: SidebarProjectHeaderProps) {
  return (
    <div className={cn("group/project-header relative", className)}>
      <SidebarMenuButton
        ref={activatorRef}
        isActive={isActive}
        size="sm"
        className={cn(
          "gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground",
          isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          buttonClassName,
        )}
        onPointerDownCapture={onPointerDownCapture}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        {...buttonProps}
      >
        {isOrchestratorProject ? null : !expanded && projectStatus ? (
          <span
            aria-hidden="true"
            title={projectStatus.label}
            className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
          >
            <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
              <span
                className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                  projectStatus.pulse ? "animate-pulse" : ""
                }`}
              />
            </span>
            <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
          </span>
        ) : (
          <ChevronRightIcon
            className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        )}
        {projectIcon}
        <span
          className={`flex-1 truncate text-xs font-medium ${
            isOrchestratorProject ? "text-foreground/95" : "text-foreground/90"
          }`}
        >
          {projectName}
        </span>
      </SidebarMenuButton>
      {children}
    </div>
  );
}
