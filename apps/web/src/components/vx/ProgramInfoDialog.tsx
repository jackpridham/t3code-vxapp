import { InfoIcon } from "lucide-react";
import { useAgentsVxappSidebarAuthorityBootstrap, useAgentsVxappStore } from "~/agentsVxappStore";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { readProgramCloseoutVerdict, readProgramScopeSummary } from "./programsTodosModel";
import { ProgramOverviewCard } from "./ProgramOverviewCard";
import { resolveProgramDisplay } from "./programDisplay";

function readRuntimeTargetLabel(input: {
  emptyLabel: string;
  target: {
    availability: "inspectable" | "degraded" | "unavailable";
    threadId: string | null;
    workspace: string | null;
  } | null;
  unavailableLabel: string;
}) {
  if (!input.target) {
    return input.emptyLabel;
  }
  if (input.target.availability === "unavailable") {
    return input.unavailableLabel;
  }
  return input.target.threadId ?? input.target.workspace ?? input.emptyLabel;
}

export function ProgramInfoDialog(props: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  programId: string;
}) {
  useAgentsVxappSidebarAuthorityBootstrap();
  const status = useAgentsVxappStore((store) => store.status);
  const error = useAgentsVxappStore((store) => store.error);
  const programCard = useAgentsVxappStore(
    (store) => store.programCardById.get(props.programId) ?? null,
  );
  const todoCount = useAgentsVxappStore(
    (store) => store.todosByProgramId.get(props.programId)?.length ?? 0,
  );
  const currentTodoId = useAgentsVxappStore(
    (store) => store.currentTodoIdByProgramId.get(props.programId) ?? null,
  );
  const program = programCard?.program ?? null;
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
          {status === "loading" || status === "idle" ? (
            <div className="rounded-xl border border-border/70 bg-card/60 px-4 py-6 text-sm text-muted-foreground">
              Loading Program details…
            </div>
          ) : status === "error" ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-6 text-sm text-destructive">
              {error?.message ?? "Failed to load Program details."}
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
              currentTodoId={currentTodoId}
              description={programCard?.display?.summary ?? programDisplay?.summary ?? null}
              executiveLabel={readRuntimeTargetLabel({
                target: programCard?.executive ?? null,
                emptyLabel: "Unassigned Executive",
                unavailableLabel: "Executive unavailable",
              })}
              orchestratorLabel={readRuntimeTargetLabel({
                target: programCard?.orchestrator ?? null,
                emptyLabel: "No orchestrator",
                unavailableLabel: "Orchestrator unavailable",
              })}
              scopeSummary={readProgramScopeSummary(program)}
              status={
                programCard?.display
                  ? {
                      label: programCard.display.label ?? null,
                      tone: programCard.display.tone ?? null,
                    }
                  : programDisplay
                    ? { label: programDisplay.label, tone: programDisplay.tone }
                    : null
              }
              title={programCard?.display?.heading ?? programDisplay?.heading ?? program.title}
              totalTodoCount={todoCount}
              verdict={readProgramCloseoutVerdict(program)}
            />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
