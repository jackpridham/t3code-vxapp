import { memo } from "react";
import type { ServerAgentsVxappTodoSnapshot } from "@t3tools/contracts";
import { ListTodoIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "~/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import { readTodoPlanLinks } from "./programTodoSnapshot";

const NEUTRAL_BADGE_CLASSNAME = "h-5 border border-border/70 bg-background/70 px-1.5 text-[10px]";

export const ProgramTodoListPane = memo(function ProgramTodoListPane(props: {
  agents: readonly string[];
  currentTodoId: string | null;
  isProgramSelection: boolean;
  onDeleteTodo: (todo: ServerAgentsVxappTodoSnapshot) => void;
  onEditTodo: (todo: ServerAgentsVxappTodoSnapshot) => void;
  onTodoSearchChange: (value: string) => void;
  selectedTodoAgent: string;
  selectedTodoStatus: string;
  setSelectedTodoAgent: (value: string) => void;
  setSelectedTodoStatus: (value: string) => void;
  todoSearch: string;
  todoStatuses: readonly string[];
  visibleTodos: readonly ServerAgentsVxappTodoSnapshot[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{props.isProgramSelection ? "Program TODOs" : "Grouped TODOs"}</CardTitle>
          <CardDescription>
            Showing {props.visibleTodos.length} matching TODO
            {props.visibleTodos.length === 1 ? "" : "s"} for this selection.
          </CardDescription>
        </div>
      </CardHeader>
      <CardPanel className="flex flex-col gap-3 overflow-hidden">
        <div className="grid gap-3 lg:grid-cols-3">
          <Input
            value={props.todoSearch}
            onChange={(event) => props.onTodoSearchChange(event.target.value)}
            placeholder="Search TODOs"
            type="search"
          />
          <Select
            value={props.selectedTodoAgent}
            onValueChange={(value) => props.setSelectedTodoAgent(String(value))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">All agents</SelectItem>
              {props.agents.map((agent) => (
                <SelectItem key={agent} value={agent}>
                  {agent}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select
            value={props.selectedTodoStatus}
            onValueChange={(value) => props.setSelectedTodoStatus(String(value))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">All statuses</SelectItem>
              {props.todoStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <ScrollArea
          className="min-h-0 sm:max-h-[48rem] 2xl:max-h-[calc(100dvh-24rem)]"
          scrollbarGutter
        >
          <div className="space-y-3 pe-2">
            {props.visibleTodos.map((todo) => {
              const planLinks = readTodoPlanLinks(todo);
              const isCurrentTodo = props.currentTodoId === todo.todoId;
              return (
                <Card key={`${todo.agent}:${todo.todoId}`} className="border-border/70">
                  <CardHeader className="pb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{todo.title}</CardTitle>
                        {isCurrentTodo ? (
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
                      <CardDescription className="mt-2 leading-relaxed">
                        {todo.summary || "No summary recorded."}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardPanel className="space-y-3 pt-0 text-sm">
                    {todo.nextAction ? (
                      <div className="rounded-xl bg-muted/55 px-3 py-2 text-sm">
                        <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                          Next action
                        </div>
                        <div className="mt-1">{todo.nextAction}</div>
                      </div>
                    ) : null}
                    {planLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {planLinks.map((link) => (
                          <Badge
                            key={`${todo.todoId}:${link.repo}:${link.planKey}:${link.phase ?? ""}:${link.step ?? ""}`}
                            variant="outline"
                            className="h-5 px-1.5 text-[10px]"
                          >
                            {link.repo}:{link.planKey}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardPanel>
                  <CardFooter className="gap-2 pt-0">
                    <Button size="sm" variant="outline" onClick={() => props.onEditTodo(todo)}>
                      <PencilIcon className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => props.onDeleteTodo(todo)}
                    >
                      <Trash2Icon className="size-3.5" />
                      Delete
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
            {props.visibleTodos.length === 0 ? (
              <Empty className="rounded-2xl border border-dashed border-border/70 bg-card/30 py-12">
                <EmptyHeader>
                  <ListTodoIcon className="size-8 text-muted-foreground/60" />
                  <EmptyTitle>No matching TODOs</EmptyTitle>
                  <EmptyDescription>Adjust the filters or create a new TODO.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </div>
        </ScrollArea>
      </CardPanel>
    </Card>
  );
});
