import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useStore } from "~/store";
import { agentsVxappControlPlaneSnapshotQueryOptions } from "~/lib/agentsVxappControlPlaneReactQuery";
import { agentsVxappSidebarGraphQueryOptions } from "~/lib/agentsVxappSidebarReactQuery";
import type { Thread } from "~/types";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import {
  readProgramCloseoutVerdict,
  readProgramScopeSummary,
  resolveExecutiveOptions,
  resolveOrchestratorOptions,
  resolveProgramExecutiveLabel,
  resolveProgramOrchestratorLabel,
} from "./programsTodosModel";
import { ProgramOverviewCard } from "./ProgramOverviewCard";
import { resolveProgramDisplay } from "./programDisplay";

const EMPTY_PROGRAMS = [] as const;
const EMPTY_TODOS = [] as const;
const EMPTY_THREAD_LINKS: readonly {
  threadId: Thread["id"];
  title: string | null;
  roleSession?: { role: "cto" | "jasper"; sessionId: string | null } | null;
  workspaceRoot: string | null;
  worktreePath: string | null;
  spawnRole: string | null;
}[] = [];

export function ProgramInfoDialog(props: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  programId: string;
}) {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const snapshotQuery = useQuery(agentsVxappControlPlaneSnapshotQueryOptions());
  const sidebarGraphQuery = useQuery(agentsVxappSidebarGraphQueryOptions());

  const programs = snapshotQuery.data?.programs ?? EMPTY_PROGRAMS;
  const todos = snapshotQuery.data?.todos ?? EMPTY_TODOS;
  const currentTodoByProgramId = useMemo(() => {
    const next = new Map<string, string>();
    for (const row of snapshotQuery.data?.currentTodos ?? []) {
      next.set(row.programId, row.todoId);
    }
    return next;
  }, [snapshotQuery.data?.currentTodos]);

  const executiveOptions = useMemo(
    () =>
      resolveExecutiveOptions({
        programs,
        projects,
        threads,
      }),
    [programs, projects, threads],
  );
  const orchestratorOptions = useMemo(
    () =>
      resolveOrchestratorOptions({
        programs,
        threads,
        threadLinks:
          sidebarGraphQuery.data?.threadLinks.map((link) => ({
            threadId: link.threadId,
            title: link.title,
            roleSession: link.roleSession ?? null,
            workspaceRoot: link.workspaceRoot,
            worktreePath: link.worktreePath,
            spawnRole: link.spawnRole,
          })) ?? EMPTY_THREAD_LINKS,
      }),
    [programs, sidebarGraphQuery.data?.threadLinks, threads],
  );

  const program = programs.find((entry) => entry.id === props.programId) ?? null;
  const todoCount = todos.filter((todo) => todo.programId === props.programId).length;
  const programDisplay = program ? resolveProgramDisplay(program) : null;

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Program info</DialogTitle>
          <DialogDescription>
            Human-readable overview of the selected Program and its current orchestration lane.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {snapshotQuery.isLoading ? (
            <div className="rounded-xl border border-border/70 bg-card/60 px-4 py-6 text-sm text-muted-foreground">
              Loading Program details…
            </div>
          ) : snapshotQuery.error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-6 text-sm text-destructive">
              {snapshotQuery.error instanceof Error
                ? snapshotQuery.error.message
                : "Failed to load Program details."}
            </div>
          ) : !program ? (
            <Empty className="rounded-xl border border-dashed border-border/70 bg-card/40 py-12">
              <EmptyHeader>
                <InfoIcon className="size-10 text-muted-foreground/60" />
                <EmptyTitle>Program unavailable</EmptyTitle>
                <EmptyDescription>
                  The selected Program is no longer present in the current control-plane snapshot.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ProgramOverviewCard
              currentTodoId={currentTodoByProgramId.get(program.id) ?? null}
              description={programDisplay?.summary ?? null}
              executiveLabel={resolveProgramExecutiveLabel(program, executiveOptions)}
              orchestratorLabel={resolveProgramOrchestratorLabel(program, orchestratorOptions)}
              scopeSummary={readProgramScopeSummary(program)}
              status={
                programDisplay ? { label: programDisplay.label, tone: programDisplay.tone } : null
              }
              title={programDisplay?.heading ?? program.title}
              totalTodoCount={todoCount}
              verdict={readProgramCloseoutVerdict(program)}
            />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
