import { type ComponentType, type CSSProperties, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, FolderIcon, HardHatIcon, Layers3Icon, PackageIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "../ui/sidebar";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { useStore } from "../../store";
import { collapseThreadToCanonicalProject } from "../../lib/orchestrationMode";
import { vortexAppsListQueryOptions } from "../../lib/vortexAppsReactQuery";
import { cn } from "../../lib/utils";
import { resolveSidebarProjectKind } from "../Sidebar.logic";
import type { Project, Thread } from "../../types";

interface OrchestrationManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: Thread["id"];
}

type WorkerSummary = {
  activeWorkerCount: number;
  hasRunningWorker: boolean;
};

type ManagerProjectRow = {
  activeWorkerCount: number;
  hasRunningWorker: boolean;
  id: string;
  isActive: boolean;
  kind: "app" | "special" | "uncategorized";
  labels: readonly string[];
  title: string;
  onClick?: (() => void) | undefined;
};

const MANAGER_SIDEBAR_STYLE = {
  "--sidebar-width": "100%",
} as CSSProperties;

function matchCatalogProject(input: {
  appPath: string;
  projects: readonly Project[];
}): Project | null {
  const exactProject = input.projects.find((project) => project.cwd === input.appPath);
  if (exactProject) {
    return exactProject;
  }

  return (
    input.projects.find(
      (project) =>
        project.cwd.startsWith(`${input.appPath}/`) || project.cwd.startsWith(`${input.appPath}\\`),
    ) ?? null
  );
}

function findPreferredThread(input: {
  projectId: Project["id"];
  currentSessionRootThreadId: Project["currentSessionRootThreadId"];
  threads: readonly Thread[];
}): Thread | null {
  if (input.currentSessionRootThreadId) {
    const selectedThread =
      input.threads.find((thread) => thread.id === input.currentSessionRootThreadId) ?? null;
    if (selectedThread) {
      return selectedThread;
    }
  }

  return (
    input.threads
      .filter((thread) => thread.archivedAt === null && thread.projectId === input.projectId)
      .toSorted((left, right) => {
        const leftAt = Date.parse(left.updatedAt ?? left.createdAt);
        const rightAt = Date.parse(right.updatedAt ?? right.createdAt);
        return rightAt - leftAt;
      })[0] ?? null
  );
}

function WorkerSummaryInline(props: { activeWorkerCount: number; hasRunningWorker: boolean }) {
  const visibleHatCount = Math.min(5, props.activeWorkerCount);
  const remainingHatCount = Math.max(0, props.activeWorkerCount - visibleHatCount);

  if (!props.hasRunningWorker && visibleHatCount === 0 && remainingHatCount === 0) {
    return null;
  }

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
      {props.hasRunningWorker ? (
        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
      ) : null}
      {Array.from({ length: visibleHatCount }, (_, index) => `worker:${index + 1}`).map((key) => (
        <HardHatIcon key={key} className="size-3.5 text-amber-500" />
      ))}
      {remainingHatCount > 0 ? (
        <span className="text-[10px] text-muted-foreground">(+ {remainingHatCount} more)</span>
      ) : null}
    </div>
  );
}

function ManagerSection(props: {
  emptyLabel: string;
  icon: ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  rows: readonly ManagerProjectRow[];
}) {
  const SectionIcon = props.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className={cn(
          "cursor-default gap-2 px-2 py-2 text-left text-xs",
          props.isActive ? "text-foreground" : "text-muted-foreground",
        )}
        isActive={props.isActive}
        render={<div />}
        size="sm"
      >
        <SectionIcon className="size-4 shrink-0" />
        <span>{props.label}</span>
      </SidebarMenuButton>
      <SidebarMenuSub className="mt-1">
        {props.rows.length === 0 ? (
          <SidebarMenuSubItem>
            <div className="px-2 py-1 text-[11px] text-muted-foreground">{props.emptyLabel}</div>
          </SidebarMenuSubItem>
        ) : (
          props.rows.map((project) => (
            <SidebarMenuSubItem key={project.id}>
              <SidebarMenuSubButton
                className="h-auto min-h-7 items-start py-1.5 text-[11px]"
                isActive={project.isActive}
                onClick={project.onClick}
                render={<button type="button" />}
                size="sm"
              >
                {project.kind === "special" ? (
                  <BotIcon className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
                ) : project.kind === "uncategorized" ? (
                  <FolderIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" />
                ) : (
                  <PackageIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" />
                )}
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{project.title}</span>
                </span>
                <WorkerSummaryInline
                  activeWorkerCount={project.activeWorkerCount}
                  hasRunningWorker={project.hasRunningWorker}
                />
              </SidebarMenuSubButton>
              {project.labels.length > 0 ? (
                <div className="px-2 pt-1.5">
                  <div className="flex flex-wrap gap-1">
                    {project.labels.map((label) => (
                      <Badge
                        key={`${project.id}:${label}`}
                        variant="outline"
                        className="h-5 px-1.5 text-[10px]"
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </SidebarMenuSubItem>
          ))
        )}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}

export function OrchestrationManager({ open, onOpenChange, threadId }: OrchestrationManagerProps) {
  const navigate = useNavigate();
  const appsQuery = useQuery(vortexAppsListQueryOptions());
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === threadId) ?? null,
    [threadId, threads],
  );
  const activeCanonicalProjectId = useMemo(() => {
    if (!activeThread) {
      return null;
    }
    return collapseThreadToCanonicalProject({
      thread: activeThread,
      projects,
    }).canonicalProjectId;
  }, [activeThread, projects]);

  const workerSummaryByProjectId = useMemo(() => {
    const summary = new Map<Project["id"], WorkerSummary>();
    for (const thread of threads) {
      if (thread.archivedAt !== null || thread.spawnRole !== "worker") {
        continue;
      }
      const projectBucket = collapseThreadToCanonicalProject({ thread, projects });
      const existing = summary.get(projectBucket.canonicalProjectId) ?? {
        activeWorkerCount: 0,
        hasRunningWorker: false,
      };
      existing.activeWorkerCount += 1;
      existing.hasRunningWorker ||= thread.session?.status === "running";
      summary.set(projectBucket.canonicalProjectId, existing);
    }
    return summary;
  }, [projects, threads]);

  const navigateToProject = useCallback(
    (project: Project) => {
      const preferredThread = findPreferredThread({
        projectId: project.id,
        currentSessionRootThreadId: project.currentSessionRootThreadId,
        threads,
      });
      if (!preferredThread) {
        return;
      }
      onOpenChange(false);
      void navigate({
        to: "/$threadId",
        params: { threadId: preferredThread.id },
        replace: false,
      });
    },
    [navigate, onOpenChange, threads],
  );

  const appProjects = useMemo<ManagerProjectRow[]>(() => {
    return (appsQuery.data?.catalog.projects ?? []).map((appProject) => {
      const matchedProject = matchCatalogProject({
        appPath: appProject.path,
        projects,
      });
      const summary = matchedProject
        ? (workerSummaryByProjectId.get(matchedProject.id) ?? {
            activeWorkerCount: 0,
            hasRunningWorker: false,
          })
        : { activeWorkerCount: 0, hasRunningWorker: false };

      return {
        activeWorkerCount: summary.activeWorkerCount,
        hasRunningWorker: summary.hasRunningWorker,
        id: matchedProject?.id ?? appProject.target_id,
        isActive:
          matchedProject !== null &&
          (matchedProject.id === activeCanonicalProjectId ||
            matchedProject.id === activeThread?.projectId),
        kind: "app",
        labels: [],
        onClick: matchedProject ? () => navigateToProject(matchedProject) : undefined,
        title: appProject.display_name,
      } satisfies ManagerProjectRow;
    });
  }, [
    activeCanonicalProjectId,
    activeThread?.projectId,
    appsQuery.data?.catalog.projects,
    navigateToProject,
    projects,
    workerSummaryByProjectId,
  ]);

  const matchedProjectIds = useMemo(
    () =>
      new Set(
        appProjects.flatMap((project) =>
          projects.some((entry) => entry.id === project.id) ? [project.id] : [],
        ),
      ),
    [appProjects, projects],
  );

  const specialProjects = useMemo<ManagerProjectRow[]>(() => {
    return projects
      .filter((project) => {
        const kind = resolveSidebarProjectKind({ project });
        return kind === "executive" || kind === "orchestrator";
      })
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((project) => {
        const preferredThread = findPreferredThread({
          projectId: project.id,
          currentSessionRootThreadId: project.currentSessionRootThreadId,
          threads,
        });
        const summary = workerSummaryByProjectId.get(project.id) ?? {
          activeWorkerCount: 0,
          hasRunningWorker: false,
        };

        return {
          activeWorkerCount: summary.activeWorkerCount,
          hasRunningWorker: summary.hasRunningWorker,
          id: project.id,
          isActive: activeThread?.projectId === project.id,
          kind: "special",
          labels: preferredThread?.labels ?? [],
          onClick: preferredThread ? () => navigateToProject(project) : undefined,
          title: project.name,
        } satisfies ManagerProjectRow;
      });
  }, [activeThread?.projectId, navigateToProject, projects, threads, workerSummaryByProjectId]);

  const uncategorizedProjects = useMemo<ManagerProjectRow[]>(() => {
    return projects
      .filter((project) => {
        if (matchedProjectIds.has(project.id)) {
          return false;
        }
        if (
          project.sidebarParentProjectId !== undefined &&
          project.sidebarParentProjectId !== null
        ) {
          return false;
        }
        return resolveSidebarProjectKind({ project }) === "project";
      })
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((project) => {
        const summary = workerSummaryByProjectId.get(project.id) ?? {
          activeWorkerCount: 0,
          hasRunningWorker: false,
        };
        return {
          activeWorkerCount: summary.activeWorkerCount,
          hasRunningWorker: summary.hasRunningWorker,
          id: project.id,
          isActive:
            project.id === activeCanonicalProjectId || project.id === activeThread?.projectId,
          kind: "uncategorized",
          labels: [],
          onClick: () => navigateToProject(project),
          title: project.name,
        } satisfies ManagerProjectRow;
      });
  }, [
    activeCanonicalProjectId,
    activeThread?.projectId,
    matchedProjectIds,
    navigateToProject,
    projects,
    workerSummaryByProjectId,
  ]);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup
        className="w-[min(calc(100vw-3rem),22rem)] max-w-none bg-card p-0 text-foreground"
        showCloseButton={false}
        side="left"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Orchestration Manager</SheetTitle>
        </SheetHeader>
        <SidebarProvider
          className="h-full min-h-0 w-full"
          defaultOpen
          open
          style={MANAGER_SIDEBAR_STYLE}
        >
          <Sidebar collapsible="none" className="h-full w-full border-r-0 bg-card text-foreground">
            <SidebarHeader className="border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Layers3Icon className="size-4 shrink-0 text-muted-foreground/70" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    Orchestration Manager
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    Jump between apps, orchestration roots, and uncategorized projects.
                  </div>
                </div>
              </div>
            </SidebarHeader>
            <SidebarContent className="gap-0 px-2 py-3">
              <SidebarGroup className="p-0">
                <SidebarMenu>
                  <ManagerSection
                    emptyLabel={
                      appsQuery.isLoading ? "Loading configured apps..." : "No configured apps."
                    }
                    icon={PackageIcon}
                    isActive={appProjects.some((project) => project.isActive)}
                    label="Projects"
                    rows={appProjects}
                  />
                  <ManagerSection
                    emptyLabel="No executive or orchestrator projects."
                    icon={BotIcon}
                    isActive={specialProjects.some((project) => project.isActive)}
                    label="Executive & Orchestrators"
                    rows={specialProjects}
                  />
                  <ManagerSection
                    emptyLabel="No uncategorized projects."
                    icon={FolderIcon}
                    isActive={uncategorizedProjects.some((project) => project.isActive)}
                    label="Uncategorized"
                    rows={uncategorizedProjects}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>
      </SheetPopup>
    </Sheet>
  );
}
