import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { useQuery } from "@tanstack/react-query";
import { CircleDotIcon, ListTodoIcon } from "lucide-react";
import { agentsVxappControlPlaneSnapshotQueryOptions } from "~/lib/agentsVxappControlPlaneReactQuery";
import { cn } from "~/lib/utils";

const NEUTRAL_BADGE_CLASSNAME = "h-5 border border-border/70 bg-background/70 px-1.5 text-[10px]";

export function ProgramTodosDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  programTitle: string;
}) {
  const snapshotQuery = useQuery(agentsVxappControlPlaneSnapshotQueryOptions());
  const currentTodoIds = new Set(
    (snapshotQuery.data?.currentTodos ?? [])
      .filter((row) => row.programId === props.programId)
      .map((row) => row.todoId),
  );
  const todos = (snapshotQuery.data?.todos ?? [])
    .filter((todo) => todo.programId === props.programId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{props.programTitle} TODOs</DialogTitle>
          <DialogDescription>
            TODO items recorded for this Program and its orchestration lanes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {snapshotQuery.isLoading ? (
            <div className="rounded-xl border border-border/70 bg-card/60 px-4 py-6 text-sm text-muted-foreground">
              Loading TODOs…
            </div>
          ) : snapshotQuery.error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-6 text-sm text-destructive">
              {snapshotQuery.error instanceof Error
                ? snapshotQuery.error.message
                : "Failed to load Program TODOs."}
            </div>
          ) : todos.length === 0 ? (
            <Empty className="rounded-xl border border-dashed border-border/70 bg-card/40 py-12">
              <EmptyHeader>
                <ListTodoIcon className="size-10 text-muted-foreground/60" />
                <EmptyTitle>No TODOs</EmptyTitle>
                <EmptyDescription>
                  This Program does not currently have any TODO items assigned.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-3">
              {todos.map((todo) => {
                const isCurrent = currentTodoIds.has(todo.todoId);

                return (
                  <section
                    key={`${todo.agent}:${todo.todoId}`}
                    className="rounded-2xl border border-border/70 bg-card/70 p-4"
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {todo.title}
                          </h3>
                          {isCurrent ? (
                            <Badge className="h-5 border-0 bg-fuchsia-500/12 px-1.5 text-[10px] text-fuchsia-700 dark:text-fuchsia-300">
                              Current
                            </Badge>
                          ) : null}
                          <Badge className={cn(NEUTRAL_BADGE_CLASSNAME)}>{todo.status}</Badge>
                          <Badge className={cn(NEUTRAL_BADGE_CLASSNAME)}>{todo.priority}</Badge>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            {todo.agent}
                          </Badge>
                        </div>
                        {todo.summary ? (
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {todo.summary}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {todo.nextAction ? (
                      <div className="mt-3 rounded-xl bg-muted/55 px-3 py-2">
                        <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                          Next action
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                          {todo.nextAction}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>Updated {new Date(todo.updatedAt).toLocaleString()}</span>
                      <span>Created {new Date(todo.createdAt).toLocaleString()}</span>
                    </div>

                    {todo.planLinks.length > 0 ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-background/70 p-3">
                        <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                          Linked plans
                        </div>
                        {todo.planLinks.map((link) => (
                          <div
                            key={`${todo.todoId}:${link.repo}:${link.planKey}:${link.phase ?? ""}:${link.step ?? ""}`}
                            className="flex flex-wrap items-center gap-2 text-xs"
                          >
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                              {link.repo}
                            </Badge>
                            <span className="font-medium text-foreground/90">{link.planKey}</span>
                            {link.phase ? (
                              <span className="text-muted-foreground">phase {link.phase}</span>
                            ) : null}
                            {link.step ? (
                              <span className="text-muted-foreground">step {link.step}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {todo.notes.length > 0 ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-background/70 p-3">
                        <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                          Notes
                        </div>
                        {todo.notes.map((note) => (
                          <div
                            key={`${todo.todoId}:note:${typeof note === "string" ? note : JSON.stringify(note)}`}
                            className="flex gap-2 text-xs text-foreground/90"
                          >
                            <CircleDotIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                            <pre className="whitespace-pre-wrap break-words font-sans">
                              {typeof note === "string" ? note : JSON.stringify(note, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
