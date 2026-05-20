import {
  type FormEvent,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ServerAgentsVxappProgramSnapshot,
  ServerAgentsVxappTodoSnapshot,
  ServerGetAgentsVxappControlPlaneSnapshotResult,
} from "@t3tools/contracts";
import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  Layers3Icon,
  ListTodoIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  useAgentsVxappSidebarAuthorityBootstrap,
  useAgentsVxappStore,
} from "~/features/vxapp/agentsVxappStore";
import { useStore } from "~/store";
import type { Project, Thread } from "~/types";
import {
  agentsVxappControlPlaneQueryKeys,
  agentsVxappControlPlaneSnapshotQueryOptions,
  createAgentsVxappProgramMutationOptions,
  createAgentsVxappTodoMutationOptions,
  deleteAgentsVxappProgramMutationOptions,
  deleteAgentsVxappTodoMutationOptions,
  setAgentsVxappProgramLifecycleMutationOptions,
  updateAgentsVxappProgramMutationOptions,
  updateAgentsVxappTodoMutationOptions,
} from "~/features/vxapp/agentsVxappControlPlaneReactQuery";
import { buildAppDocumentTitle, useDocumentTitle } from "~/lib/documentTitle";
import { randomUUID, cn } from "~/lib/utils";
import { toastManager } from "~/components/ui/toast";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { VortexErrorBanner } from "./VortexErrorBanner";
import {
  buildProgramTodoGroups,
  canonicalizeProgramScope,
  chooseCreateProgramScopeTemplate,
  type ExecutiveOption,
  makeExecutiveKey,
  readProgramScope,
  readProgramCloseoutVerdict,
  readProgramScopeSummary,
  resolveProgramLifecycleOptions,
  resolveExecutiveOptions,
  resolveOrchestratorOptions,
  resolveProgramExecutiveLabel,
  resolveProgramOrchestratorLabel,
  resolveTodoPriorityOptions,
  resolveTodoStatusOptions,
  type ProgramTodoGroup,
  validateProgramScope,
} from "./programsTodosModel";
import { ProgramOverviewCard } from "./ProgramOverviewCard";
import { resolveProgramDisplay } from "./programDisplay";

type ProgramEditorMode = "create" | "edit";
type TodoEditorMode = "create" | "edit";

type EditablePlanLink = {
  id: string;
  phase: string | null;
  planKey: string;
  repo: string;
  step: string | null;
};

type ProgramFormState = {
  currentOrchestratorThreadId: string;
  executiveKey: string;
  objective: string;
  scopeJson: string;
  title: string;
};

type ProgramLifecycleState = {
  nextStatus: string;
  reason: string;
  supersededByProgramId: string;
};

type TodoFormState = {
  agent: string;
  nextAction: string;
  planLinks: EditablePlanLink[];
  priority: string;
  programId: string;
  status: string;
  summary: string;
  title: string;
  todoId: string;
};

type GroupCardView = {
  currentTodoId: string | null;
  executiveLabel: string | null;
  group: ProgramTodoGroup;
  orchestratorLabel: string | null;
  scopeSummary: string | null;
  status: { label: string | null; tone: string | null } | null;
  verdict: string | null;
};

const EMPTY_PROGRAMS: readonly ServerAgentsVxappProgramSnapshot[] = [];
const EMPTY_TODOS: readonly ServerAgentsVxappTodoSnapshot[] = [];
const EMPTY_AGENTS: readonly string[] = [];
const EMPTY_THREAD_LINKS: readonly {
  threadId: Thread["id"];
  title: string | null;
  roleSession?: { role: "cto" | "jasper"; sessionId: string | null } | null;
  workspaceRoot: string | null;
  worktreePath: string | null;
  spawnRole: string | null;
}[] = [];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.closest("[contenteditable='true']") !== null
  );
}

function makeEditablePlanLink(input: Partial<Omit<EditablePlanLink, "id">> = {}): EditablePlanLink {
  return {
    id: randomUUID(),
    repo: input.repo ?? "",
    planKey: input.planKey ?? "",
    phase: input.phase ?? null,
    step: input.step ?? null,
  };
}

const NEUTRAL_BADGE_CLASSNAME = "h-5 border border-border/70 bg-background/70 px-1.5 text-[10px]";

function parseScopeJson(value: string): Record<string, unknown> | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Scope JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function defaultProgramFormState(input: {
  executiveOptions: readonly ExecutiveOption[];
  mode: ProgramEditorMode;
  program: ServerAgentsVxappProgramSnapshot | null;
  templateScopeJson: string;
}): ProgramFormState {
  const { executiveOptions, mode, program, templateScopeJson } = input;
  const defaultExecutive =
    program?.executiveProjectId && program.executiveThreadId
      ? makeExecutiveKey(program.executiveProjectId, program.executiveThreadId)
      : executiveOptions[0]
        ? makeExecutiveKey(executiveOptions[0].projectId, executiveOptions[0].threadId)
        : "";

  return {
    currentOrchestratorThreadId: program?.currentOrchestratorThreadId ?? "",
    executiveKey: defaultExecutive,
    objective: program?.objective ?? "",
    scopeJson:
      mode === "edit"
        ? JSON.stringify(
            readProgramScope(program ?? ({} as ServerAgentsVxappProgramSnapshot)) ?? {},
            null,
            2,
          )
        : templateScopeJson,
    title: program?.title ?? "",
  };
}

function defaultTodoFormState(
  todo: ServerAgentsVxappTodoSnapshot | null,
  agents: readonly string[],
  optionDefaults?: {
    priority: string | null;
    status: string | null;
  },
): TodoFormState {
  return {
    agent: todo?.agent ?? agents[0] ?? "jasper",
    nextAction: todo?.nextAction ?? "",
    planLinks:
      todo?.planLinks.map((link) =>
        makeEditablePlanLink({
          repo: link.repo,
          planKey: link.planKey,
          phase: link.phase ?? null,
          step: link.step ?? null,
        }),
      ) ?? [],
    priority: todo?.priority ?? optionDefaults?.priority ?? "",
    programId: todo?.programId ?? "",
    status: todo?.status ?? optionDefaults?.status ?? "",
    summary: todo?.summary ?? "",
    title: todo?.title ?? "",
    todoId: todo?.todoId ?? "",
  };
}

function defaultLifecycleState(
  program: ServerAgentsVxappProgramSnapshot | null,
  fallbackStatus?: string | null,
): ProgramLifecycleState {
  return {
    nextStatus: program?.status ?? fallbackStatus ?? "",
    reason: "",
    supersededByProgramId: "",
  };
}

function nextLifecycleStatus(form: ProgramLifecycleState): string {
  return form.nextStatus;
}

function formatScopeErrors(errors: readonly string[]): string {
  return errors.join(" ");
}

function mutationProgramId(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const programId = (result as Record<string, unknown>).programId;
  return typeof programId === "string" && programId.length > 0 ? programId : null;
}

function PlanLinksEditor(props: {
  planLinks: EditablePlanLink[];
  onChange: (next: EditablePlanLink[]) => void;
}) {
  return (
    <div className="space-y-3">
      {props.planLinks.map((link, index) => (
        <div
          key={link.id}
          className="grid gap-2 rounded-xl border border-border/70 p-3 md:grid-cols-4"
        >
          <Input
            value={link.repo}
            onChange={(event) => {
              const next = [...props.planLinks];
              const current = next[index]!;
              next[index] = { ...current, repo: event.target.value };
              props.onChange(next);
            }}
            placeholder="repo"
          />
          <Input
            value={link.planKey}
            onChange={(event) => {
              const next = [...props.planLinks];
              const current = next[index]!;
              next[index] = { ...current, planKey: event.target.value };
              props.onChange(next);
            }}
            placeholder="plan key"
          />
          <Input
            value={link.phase ?? ""}
            onChange={(event) => {
              const next = [...props.planLinks];
              const current = next[index]!;
              next[index] = { ...current, phase: event.target.value || null };
              props.onChange(next);
            }}
            placeholder="phase"
          />
          <div className="flex gap-2">
            <Input
              value={link.step ?? ""}
              onChange={(event) => {
                const next = [...props.planLinks];
                const current = next[index]!;
                next[index] = { ...current, step: event.target.value || null };
                props.onChange(next);
              }}
              placeholder="step"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                props.onChange(props.planLinks.filter((entry) => entry.id !== link.id));
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          props.onChange([...props.planLinks, makeEditablePlanLink()]);
        }}
      >
        <PlusIcon className="size-3.5" />
        Add plan link
      </Button>
    </div>
  );
}

const ProgramGroupsPane = memo(function ProgramGroupsPane(props: {
  groupCards: readonly GroupCardView[];
  onCreateProgram: () => void;
  onDeleteProgram: (program: ServerAgentsVxappProgramSnapshot) => void;
  onEditProgram: (program: ServerAgentsVxappProgramSnapshot) => void;
  onEditStatus: (program: ServerAgentsVxappProgramSnapshot) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSelectGroup: (groupKey: string) => void;
  programSearch: string;
  programSearchInputRef: { current: HTMLInputElement | null };
  selectedGroupKey: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>Programs</CardTitle>
          <CardDescription>
            Press `/` to focus search. TODOs are grouped under each Program.
          </CardDescription>
        </div>
        <CardAction className="gap-2">
          <Button variant="outline" onClick={props.onRefresh}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
          <Button onClick={props.onCreateProgram}>
            <PlusIcon className="size-3.5" />
            New Program
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel className="flex flex-col gap-3 overflow-hidden">
        <Input
          ref={props.programSearchInputRef}
          value={props.programSearch}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="Search Programs"
          type="search"
        />
        <ScrollArea
          className="min-h-0 sm:max-h-[42rem] 2xl:max-h-[calc(100dvh-20rem)]"
          scrollbarGutter
        >
          <div className="space-y-3 pe-2">
            {props.groupCards.map((card) => {
              const isSelected = props.selectedGroupKey === card.group.key;
              const isProgram = card.group.kind === "program";
              const program = card.group.kind === "program" ? card.group.program : null;
              return (
                <Card
                  key={card.group.key}
                  className={cn(
                    "cursor-pointer border-border/70 transition-colors hover:border-foreground/20",
                    isSelected ? "border-foreground/25 ring-1 ring-foreground/15" : "",
                  )}
                  onClick={() => props.onSelectGroup(card.group.key)}
                >
                  <CardHeader className="pb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="truncate text-base">{card.group.label}</CardTitle>
                        {card.status?.label ? (
                          <Badge
                            className={cn(NEUTRAL_BADGE_CLASSNAME, card.status.tone ?? undefined)}
                          >
                            {card.status.label}
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {card.group.todos.length} TODO{card.group.todos.length === 1 ? "" : "s"}
                        </Badge>
                        {card.verdict ? (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            closeout {card.verdict}
                          </Badge>
                        ) : null}
                      </div>
                      {card.group.description ? (
                        <CardDescription className="mt-2 line-clamp-3 leading-relaxed">
                          {card.group.description}
                        </CardDescription>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardPanel className="space-y-2 pt-0 text-xs text-muted-foreground">
                    {card.executiveLabel ? <div>{card.executiveLabel}</div> : null}
                    {card.orchestratorLabel ? <div>{card.orchestratorLabel}</div> : null}
                    {card.scopeSummary ? <div>{card.scopeSummary}</div> : null}
                    {card.group.kind === "detached" ? (
                      <div>
                        Missing Program id {(card.group.referencedProgramId ?? "").slice(0, 12)}
                      </div>
                    ) : null}
                    {card.currentTodoId ? (
                      <Badge className="h-5 border-0 bg-fuchsia-500/12 px-1.5 text-[10px] text-fuchsia-700 dark:text-fuchsia-300">
                        Current TODO {card.currentTodoId}
                      </Badge>
                    ) : null}
                  </CardPanel>
                  {isProgram ? (
                    <CardFooter className="gap-2 pt-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (program) {
                            props.onEditProgram(program);
                          }
                        }}
                      >
                        <PencilIcon className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (program) {
                            props.onEditStatus(program);
                          }
                        }}
                      >
                        Status
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (program) {
                            props.onDeleteProgram(program);
                          }
                        }}
                      >
                        <Trash2Icon className="size-3.5" />
                        Delete
                      </Button>
                    </CardFooter>
                  ) : null}
                </Card>
              );
            })}
            {props.groupCards.length === 0 ? (
              <Empty className="rounded-2xl border border-dashed border-border/70 bg-card/30 py-10">
                <EmptyHeader>
                  <Layers3Icon className="size-8 text-muted-foreground/60" />
                  <EmptyTitle>No matching Programs</EmptyTitle>
                  <EmptyDescription>Adjust the search or create a new Program.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </div>
        </ScrollArea>
      </CardPanel>
    </Card>
  );
});

const SelectedGroupPane = memo(function SelectedGroupPane(props: {
  agents: readonly string[];
  groupCard: GroupCardView | null;
  onCreateTodo: (programId?: string) => void;
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
  if (!props.groupCard) {
    return (
      <Card className="min-h-[24rem]">
        <Empty className="min-h-[24rem]">
          <EmptyHeader>
            <ListTodoIcon className="size-8 text-muted-foreground/60" />
            <EmptyTitle>Select a Program group</EmptyTitle>
            <EmptyDescription>
              Choose a Program, unassigned TODOs, or a detached Program bucket to review items.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  const activeGroupCard = props.groupCard;
  const selectedProgram =
    activeGroupCard.group.kind === "program" ? activeGroupCard.group.program : null;
  const title =
    activeGroupCard.group.kind === "program"
      ? activeGroupCard.group.program.title
      : activeGroupCard.group.label;

  return (
    <div className="flex flex-col gap-6">
      <ProgramOverviewCard
        action={
          <Button onClick={() => props.onCreateTodo(selectedProgram?.id)}>
            <PlusIcon className="size-3.5" />
            New TODO
          </Button>
        }
        currentTodoId={activeGroupCard.currentTodoId}
        description={activeGroupCard.group.description}
        executiveLabel={activeGroupCard.executiveLabel}
        orchestratorLabel={activeGroupCard.orchestratorLabel}
        scopeSummary={activeGroupCard.scopeSummary}
        status={activeGroupCard.status}
        title={title}
        totalTodoCount={activeGroupCard.group.todos.length}
        verdict={activeGroupCard.verdict}
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="min-w-0 flex-1">
            <CardTitle>{selectedProgram ? "Program TODOs" : "Grouped TODOs"}</CardTitle>
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
                const isCurrentTodo = activeGroupCard.currentTodoId === todo.todoId;
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
                      {todo.planLinks.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {todo.planLinks.map((link) => (
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
    </div>
  );
});

export function ProgramsTodosView() {
  useDocumentTitle(buildAppDocumentTitle({ parts: ["Programs"] }));
  useAgentsVxappSidebarAuthorityBootstrap();
  const queryClient = useQueryClient();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const authoritySnapshot = useAgentsVxappStore((store) => store.snapshot);
  const authorityStatus = useAgentsVxappStore((store) => store.status);
  const authorityError = useAgentsVxappStore((store) => store.error);
  const currentTodoByProgramId = useAgentsVxappStore((store) => store.currentTodoIdByProgramId);
  const refreshSidebarAuthority = useAgentsVxappStore((store) => store.refreshSidebarAuthority);
  const snapshotQuery = useQuery({
    ...agentsVxappControlPlaneSnapshotQueryOptions(),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [programSearch, setProgramSearch] = useState("");
  const [todoSearch, setTodoSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [todoStatusFilter, setTodoStatusFilter] = useState("all");
  const [programDialogMode, setProgramDialogMode] = useState<ProgramEditorMode>("create");
  const [editingProgram, setEditingProgram] = useState<ServerAgentsVxappProgramSnapshot | null>(
    null,
  );
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [programScopeBaseline, setProgramScopeBaseline] = useState(
    canonicalizeProgramScope(undefined),
  );
  const [programScopeTemplateSource, setProgramScopeTemplateSource] = useState<string | null>(null);
  const [programForm, setProgramForm] = useState<ProgramFormState>({
    currentOrchestratorThreadId: "",
    executiveKey: "",
    objective: "",
    scopeJson: "{}",
    title: "",
  });
  const [lifecycleProgram, setLifecycleProgram] = useState<ServerAgentsVxappProgramSnapshot | null>(
    null,
  );
  const [lifecycleDialogOpen, setLifecycleDialogOpen] = useState(false);
  const [lifecycleForm, setLifecycleForm] = useState<ProgramLifecycleState>(
    defaultLifecycleState(null, null),
  );
  const [programDeleteTarget, setProgramDeleteTarget] =
    useState<ServerAgentsVxappProgramSnapshot | null>(null);
  const [todoDialogMode, setTodoDialogMode] = useState<TodoEditorMode>("create");
  const [editingTodo, setEditingTodo] = useState<ServerAgentsVxappTodoSnapshot | null>(null);
  const [todoDialogOpen, setTodoDialogOpen] = useState(false);
  const [todoForm, setTodoForm] = useState<TodoFormState>(
    defaultTodoFormState(null, EMPTY_AGENTS, {
      priority: null,
      status: null,
    }),
  );
  const [todoDeleteTarget, setTodoDeleteTarget] = useState<ServerAgentsVxappTodoSnapshot | null>(
    null,
  );
  const programSearchInputRef = useRef<HTMLInputElement | null>(null);

  const deferredProgramSearch = useDeferredValue(programSearch);
  const deferredTodoSearch = useDeferredValue(todoSearch);

  const createProgramMutation = useMutation(
    createAgentsVxappProgramMutationOptions({ queryClient }),
  );
  const updateProgramMutation = useMutation(
    updateAgentsVxappProgramMutationOptions({ queryClient }),
  );
  const deleteProgramMutation = useMutation(
    deleteAgentsVxappProgramMutationOptions({ queryClient }),
  );
  const lifecycleMutation = useMutation(
    setAgentsVxappProgramLifecycleMutationOptions({ queryClient }),
  );
  const createTodoMutation = useMutation(createAgentsVxappTodoMutationOptions({ queryClient }));
  const updateTodoMutation = useMutation(updateAgentsVxappTodoMutationOptions({ queryClient }));
  const deleteTodoMutation = useMutation(deleteAgentsVxappTodoMutationOptions({ queryClient }));

  const snapshot = snapshotQuery.data;
  const agents = snapshot?.agents ?? EMPTY_AGENTS;
  const programs = useMemo(
    () => authoritySnapshot?.programs.map((card) => card.program) ?? EMPTY_PROGRAMS,
    [authoritySnapshot],
  );
  const todos = authoritySnapshot?.todos ?? EMPTY_TODOS;

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
        threadLinks: EMPTY_THREAD_LINKS,
      }),
    [programs, threads],
  );

  const allGroups = useMemo(
    () =>
      buildProgramTodoGroups({
        currentTodoByProgramId,
        programs,
        todos,
      }),
    [currentTodoByProgramId, programs, todos],
  );

  const groupCards = useMemo<GroupCardView[]>(
    () =>
      allGroups.map((group) => {
        if (group.kind !== "program") {
          return {
            currentTodoId: group.currentTodoId,
            executiveLabel: null,
            group,
            orchestratorLabel: null,
            scopeSummary: null,
            status: null,
            verdict: null,
          };
        }
        return {
          currentTodoId: group.currentTodoId,
          executiveLabel: resolveProgramExecutiveLabel(group.program, executiveOptions),
          group,
          orchestratorLabel: resolveProgramOrchestratorLabel(group.program, orchestratorOptions),
          scopeSummary: readProgramScopeSummary(group.program),
          status: ((display) => ({ label: display.label, tone: display.tone }))(
            resolveProgramDisplay(group.program),
          ),
          verdict: readProgramCloseoutVerdict(group.program),
        };
      }),
    [allGroups, executiveOptions, orchestratorOptions],
  );

  const visibleGroupCards = useMemo(() => {
    const query = deferredProgramSearch.trim().toLowerCase();
    if (!query) {
      return groupCards;
    }
    return groupCards.filter((card) =>
      [
        card.group.searchText,
        card.executiveLabel ?? "",
        card.orchestratorLabel ?? "",
        card.scopeSummary ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [deferredProgramSearch, groupCards]);

  useEffect(() => {
    if (visibleGroupCards.length === 0) {
      if (selectedGroupKey.length > 0) {
        setSelectedGroupKey("");
      }
      return;
    }
    if (!visibleGroupCards.some((card) => card.group.key === selectedGroupKey)) {
      setSelectedGroupKey(visibleGroupCards[0]!.group.key);
    }
  }, [selectedGroupKey, visibleGroupCards]);

  const selectedGroupCard = useMemo(
    () => groupCards.find((card) => card.group.key === selectedGroupKey) ?? null,
    [groupCards, selectedGroupKey],
  );
  const selectedProgram =
    selectedGroupCard?.group.kind === "program" ? selectedGroupCard.group.program : null;

  const visibleTodos = useMemo(() => {
    const groupTodos = selectedGroupCard?.group.todos ?? EMPTY_TODOS;
    const query = deferredTodoSearch.trim().toLowerCase();
    return groupTodos.filter((todo) => {
      if (agentFilter !== "all" && todo.agent !== agentFilter) {
        return false;
      }
      if (todoStatusFilter !== "all" && todo.status !== todoStatusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [todo.title, todo.summary ?? "", todo.nextAction ?? "", todo.todoId]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [agentFilter, deferredTodoSearch, selectedGroupCard, todoStatusFilter]);

  const programLifecycleOptions = useMemo(
    () => resolveProgramLifecycleOptions(snapshotQuery.data),
    [snapshotQuery.data],
  );
  const todoStatusOptions = useMemo(
    () => resolveTodoStatusOptions(snapshotQuery.data),
    [snapshotQuery.data],
  );
  const todoPriorityOptions = useMemo(
    () => resolveTodoPriorityOptions(snapshotQuery.data),
    [snapshotQuery.data],
  );
  const todoStatuses = useMemo(
    () =>
      todoStatusOptions.length > 0
        ? todoStatusOptions.map((option) => option.value)
        : [...new Set(todos.map((todo) => todo.status))].toSorted(),
    [todoStatusOptions, todos],
  );
  const todoPriorities = useMemo(
    () =>
      todoPriorityOptions.length > 0
        ? todoPriorityOptions.map((option) => option.value)
        : [...new Set(todos.map((todo) => todo.priority))].toSorted(),
    [todoPriorityOptions, todos],
  );

  const createScopeTemplate = useMemo(() => {
    const preferredPrograms = selectedProgram
      ? [selectedProgram, ...programs.filter((program) => program.id !== selectedProgram.id)]
      : [...programs];
    return chooseCreateProgramScopeTemplate(preferredPrograms);
  }, [programs, selectedProgram]);

  const refreshControlPlaneData = useCallback(async () => {
    await Promise.all([
      refreshSidebarAuthority({ force: true }),
      queryClient.refetchQueries({
        queryKey: agentsVxappControlPlaneQueryKeys.snapshot(),
        type: "active",
      }),
    ]);
  }, [queryClient, refreshSidebarAuthority]);

  const patchProgramSnapshot = useCallback(
    (
      programId: string,
      updater: (program: ServerAgentsVxappProgramSnapshot) => ServerAgentsVxappProgramSnapshot,
    ) => {
      queryClient.setQueryData<ServerGetAgentsVxappControlPlaneSnapshotResult | undefined>(
        agentsVxappControlPlaneQueryKeys.snapshot(),
        (current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            programs: current.programs.map((program) =>
              program.id === programId ? updater(program) : program,
            ),
          };
        },
      );
    },
    [queryClient],
  );

  const openCreateProgramDialog = useCallback(() => {
    const templateScopeJson = JSON.stringify(createScopeTemplate.scope, null, 2);
    setProgramDialogMode("create");
    setEditingProgram(null);
    setProgramScopeBaseline(canonicalizeProgramScope(createScopeTemplate.scope));
    setProgramScopeTemplateSource(createScopeTemplate.sourceProgramTitle);
    setProgramForm(
      defaultProgramFormState({
        executiveOptions,
        mode: "create",
        program: null,
        templateScopeJson,
      }),
    );
    setProgramDialogOpen(true);
  }, [createScopeTemplate, executiveOptions]);

  const openEditProgramDialog = useCallback(
    (program: ServerAgentsVxappProgramSnapshot) => {
      const scope = readProgramScope(program) ?? {};
      setProgramDialogMode("edit");
      setEditingProgram(program);
      setProgramScopeBaseline(canonicalizeProgramScope(scope));
      setProgramScopeTemplateSource(null);
      setProgramForm(
        defaultProgramFormState({
          executiveOptions,
          mode: "edit",
          program,
          templateScopeJson: JSON.stringify(scope, null, 2),
        }),
      );
      setProgramDialogOpen(true);
    },
    [executiveOptions],
  );

  const openLifecycleDialog = useCallback(
    (program: ServerAgentsVxappProgramSnapshot) => {
      setLifecycleProgram(program);
      setLifecycleForm(defaultLifecycleState(program, programLifecycleOptions[0]?.value ?? null));
      setLifecycleDialogOpen(true);
    },
    [programLifecycleOptions],
  );

  const openCreateTodoDialog = useCallback(
    (programId?: string) => {
      setTodoDialogMode("create");
      setEditingTodo(null);
      const next = defaultTodoFormState(null, agents, {
        priority: todoPriorityOptions[0]?.value ?? null,
        status: todoStatusOptions[0]?.value ?? null,
      });
      next.programId = programId ?? "";
      setTodoForm(next);
      setTodoDialogOpen(true);
    },
    [agents, todoPriorityOptions, todoStatusOptions],
  );

  const openEditTodoDialog = useCallback(
    (todo: ServerAgentsVxappTodoSnapshot) => {
      setTodoDialogMode("edit");
      setEditingTodo(todo);
      setTodoForm(
        defaultTodoFormState(todo, agents, {
          priority: todoPriorityOptions[0]?.value ?? null,
          status: todoStatusOptions[0]?.value ?? null,
        }),
      );
      setTodoDialogOpen(true);
    },
    [agents, todoPriorityOptions, todoStatusOptions],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (
        programDialogOpen ||
        lifecycleDialogOpen ||
        todoDialogOpen ||
        programDeleteTarget !== null ||
        todoDeleteTarget !== null
      ) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      programSearchInputRef.current?.focus();
      programSearchInputRef.current?.select();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    lifecycleDialogOpen,
    programDeleteTarget,
    programDialogOpen,
    todoDeleteTarget,
    todoDialogOpen,
  ]);

  async function submitProgramForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const title = programForm.title.trim();
      if (title.length === 0) {
        throw new Error("Program title is required.");
      }
      const executive = executiveOptions.find(
        (option) =>
          makeExecutiveKey(option.projectId, option.threadId) === programForm.executiveKey,
      );
      if (!executive) {
        throw new Error("Select an executive.");
      }

      const scope = parseScopeJson(programForm.scopeJson);
      const nextScopeCanonical = canonicalizeProgramScope(scope);
      const scopeChanged = nextScopeCanonical !== programScopeBaseline;
      if (programDialogMode === "create" || scopeChanged) {
        if (!scope) {
          throw new Error("Program scope is required.");
        }
        const scopeErrors = validateProgramScope(scope);
        if (scopeErrors.length > 0) {
          throw new Error(formatScopeErrors(scopeErrors));
        }
      }

      if (programDialogMode === "create") {
        const result = await createProgramMutation.mutateAsync({
          title,
          objective: programForm.objective.trim() || undefined,
          executiveProjectId: ProjectId.makeUnsafe(executive.projectId),
          executiveThreadId: ThreadId.makeUnsafe(executive.threadId),
          currentOrchestratorThreadId: programForm.currentOrchestratorThreadId
            ? ThreadId.makeUnsafe(programForm.currentOrchestratorThreadId)
            : null,
          scope,
        });
        const createdProgramId = mutationProgramId(result);
        await refreshControlPlaneData();
        if (createdProgramId) {
          setSelectedGroupKey(`program:${createdProgramId}`);
        }
        toastManager.add({ type: "success", title: "Program created" });
      } else if (editingProgram) {
        const trimmedObjective = programForm.objective.trim();
        const request: {
          clearCurrentOrchestratorThreadId: boolean;
          currentOrchestratorThreadId: Thread["id"] | null;
          executiveProjectId: Project["id"];
          executiveThreadId: Thread["id"];
          objective?: string;
          programId: ServerAgentsVxappProgramSnapshot["id"];
          scope?: Record<string, unknown>;
          title: string;
        } = {
          programId: editingProgram.id,
          title,
          executiveProjectId: ProjectId.makeUnsafe(executive.projectId),
          executiveThreadId: ThreadId.makeUnsafe(executive.threadId),
          currentOrchestratorThreadId: programForm.currentOrchestratorThreadId
            ? ThreadId.makeUnsafe(programForm.currentOrchestratorThreadId)
            : null,
          clearCurrentOrchestratorThreadId: programForm.currentOrchestratorThreadId.length === 0,
        };
        if (trimmedObjective.length > 0) {
          request.objective = trimmedObjective;
        }

        if (scopeChanged && scope) {
          request.scope = scope;
        }

        await updateProgramMutation.mutateAsync(request);
        await refreshControlPlaneData();
        toastManager.add({ type: "success", title: "Program updated" });
      }

      setProgramDialogOpen(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Program save failed",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  async function submitLifecycleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lifecycleProgram) {
      return;
    }

    try {
      const expectedStatus = nextLifecycleStatus(lifecycleForm);
      if (expectedStatus === "founder_review_ready") {
        await lifecycleMutation.mutateAsync({
          programId: lifecycleProgram.id,
          action: "founder-review-ready",
        });
      } else if (expectedStatus === "completed") {
        await lifecycleMutation.mutateAsync({
          programId: lifecycleProgram.id,
          action: "complete",
        });
      } else if (expectedStatus === "cancelled") {
        await lifecycleMutation.mutateAsync({
          programId: lifecycleProgram.id,
          action: "cancel",
          reason: lifecycleForm.reason,
          supersededByProgramId: lifecycleForm.supersededByProgramId
            ? ProgramId.makeUnsafe(lifecycleForm.supersededByProgramId)
            : null,
        });
      } else {
        await lifecycleMutation.mutateAsync({
          programId: lifecycleProgram.id,
          action: "set-status",
          nextStatus: expectedStatus as
            | "active"
            | "blocked"
            | "awaiting_founder"
            | "awaiting_external"
            | "closeout_in_progress",
        });
      }

      patchProgramSnapshot(lifecycleProgram.id, (program) => ({
        ...program,
        currentStatus: expectedStatus,
        status: expectedStatus as ServerAgentsVxappProgramSnapshot["status"],
        updatedAt: new Date().toISOString(),
      }));
      await refreshControlPlaneData();
      toastManager.add({ type: "success", title: "Program status updated" });
      setLifecycleDialogOpen(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Program status update failed",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  async function submitTodoForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const title = todoForm.title.trim();
      if (title.length === 0) {
        throw new Error("TODO title is required.");
      }
      const planLinks = todoForm.planLinks
        .filter((link) => link.repo.trim().length > 0 && link.planKey.trim().length > 0)
        .map((link) => ({
          repo: link.repo.trim(),
          planKey: link.planKey.trim(),
          phase: link.phase || null,
          step: link.step || null,
        }));
      const payload = {
        agent: todoDialogMode === "edit" ? (editingTodo?.agent ?? todoForm.agent) : todoForm.agent,
        title,
        programId: todoForm.programId ? ProgramId.makeUnsafe(todoForm.programId) : null,
        summary: todoForm.summary.trim() || undefined,
        nextAction: todoForm.nextAction.trim() || undefined,
        status: todoForm.status,
        priority: todoForm.priority,
        planLinks,
      };

      if (todoDialogMode === "create") {
        await createTodoMutation.mutateAsync({
          ...payload,
          todoId: todoForm.todoId.trim() || undefined,
        });
        toastManager.add({ type: "success", title: "TODO created" });
      } else if (editingTodo) {
        await updateTodoMutation.mutateAsync({
          ...payload,
          agent: editingTodo.agent,
          todoId: editingTodo.todoId,
        });
        toastManager.add({ type: "success", title: "TODO updated" });
      }

      await refreshControlPlaneData();
      setTodoDialogOpen(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "TODO save failed",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  const isBusy =
    createProgramMutation.isPending ||
    updateProgramMutation.isPending ||
    deleteProgramMutation.isPending ||
    lifecycleMutation.isPending ||
    createTodoMutation.isPending ||
    updateTodoMutation.isPending ||
    deleteTodoMutation.isPending;

  if (authorityStatus === "loading" && authoritySnapshot === null) {
    return (
      <main className="flex-1 overflow-y-auto bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-6 sm:px-6">
          <Empty className="min-h-[50vh]">
            <EmptyHeader>
              <Layers3Icon className="size-10 text-muted-foreground/60" />
              <EmptyTitle>Loading Programs</EmptyTitle>
              <EmptyDescription>Reading Program authority from agents-vxapp…</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </main>
    );
  }

  if (authorityStatus === "error" && authoritySnapshot === null) {
    return (
      <main className="flex-1 overflow-y-auto bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-2xl">
            <VortexErrorBanner
              heading="Programs unavailable"
              error={authorityError}
              fallbackMessage="Failed to load Program authority from agents-vxapp."
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="flex-1 overflow-y-auto bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/35">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <CardTitle>Programs and TODOs</CardTitle>
                <CardDescription>
                  Live `agents-vxapp` Program and TODO control-plane state, grouped for review and
                  CRUD.
                </CardDescription>
              </div>
              <CardAction className="gap-2">
                <Button variant="outline" onClick={() => void refreshControlPlaneData()}>
                  <RefreshCwIcon className="size-3.5" />
                  Refresh
                </Button>
                <Button onClick={openCreateProgramDialog}>
                  <PlusIcon className="size-3.5" />
                  New Program
                </Button>
              </CardAction>
            </CardHeader>
            <CardPanel className="grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Programs
                </div>
                <div className="mt-2 text-2xl font-semibold">{programs.length}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  TODOs
                </div>
                <div className="mt-2 text-2xl font-semibold">{todos.length}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Current TODOs
                </div>
                <div className="mt-2 text-2xl font-semibold">{currentTodoByProgramId.size}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  TODO agents
                </div>
                <div className="mt-2 text-2xl font-semibold">{snapshot?.agents.length ?? 0}</div>
              </div>
            </CardPanel>
            <CardFooter className="border-t bg-muted/20 text-xs text-muted-foreground">
              Control plane: {snapshot?.dbPath ?? "unavailable"}
            </CardFooter>
          </Card>

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
            <ProgramGroupsPane
              groupCards={visibleGroupCards}
              onCreateProgram={openCreateProgramDialog}
              onDeleteProgram={setProgramDeleteTarget}
              onEditProgram={openEditProgramDialog}
              onEditStatus={openLifecycleDialog}
              onRefresh={() => void refreshControlPlaneData()}
              onSearchChange={setProgramSearch}
              onSelectGroup={setSelectedGroupKey}
              programSearch={programSearch}
              programSearchInputRef={programSearchInputRef}
              selectedGroupKey={selectedGroupKey}
            />

            <SelectedGroupPane
              agents={agents}
              groupCard={selectedGroupCard}
              onCreateTodo={openCreateTodoDialog}
              onDeleteTodo={setTodoDeleteTarget}
              onEditTodo={openEditTodoDialog}
              onTodoSearchChange={setTodoSearch}
              selectedTodoAgent={agentFilter}
              selectedTodoStatus={todoStatusFilter}
              setSelectedTodoAgent={setAgentFilter}
              setSelectedTodoStatus={setTodoStatusFilter}
              todoSearch={todoSearch}
              todoStatuses={todoStatuses}
              visibleTodos={visibleTodos}
            />
          </div>
        </div>
      </main>

      <Dialog onOpenChange={setProgramDialogOpen} open={programDialogOpen}>
        <DialogPopup className="max-w-3xl">
          <form
            className="flex min-h-0 max-h-full flex-col"
            onSubmit={(event) => void submitProgramForm(event)}
          >
            <DialogHeader>
              <DialogTitle>
                {programDialogMode === "create" ? "Create Program" : "Edit Program"}
              </DialogTitle>
              <DialogDescription>
                {programDialogMode === "create"
                  ? programScopeTemplateSource
                    ? `Starts from the scope template used by ${programScopeTemplateSource}.`
                    : "Fill in a valid Program scope before saving."
                  : "Program scope is only written if the JSON actually changed."}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <Field>
                <FieldLabel>Title</FieldLabel>
                <Input
                  required
                  value={programForm.title}
                  onChange={(event) =>
                    setProgramForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Objective</FieldLabel>
                <Textarea
                  className="min-h-28"
                  value={programForm.objective}
                  onChange={(event) =>
                    setProgramForm((current) => ({ ...current, objective: event.target.value }))
                  }
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Executive</FieldLabel>
                  <Select
                    value={programForm.executiveKey}
                    onValueChange={(value) =>
                      setProgramForm((current) => ({ ...current, executiveKey: String(value) }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select executive" />
                    </SelectTrigger>
                    <SelectPopup>
                      {executiveOptions.map((option) => (
                        <SelectItem
                          key={makeExecutiveKey(option.projectId, option.threadId)}
                          value={makeExecutiveKey(option.projectId, option.threadId)}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Orchestrator</FieldLabel>
                  <Select
                    value={programForm.currentOrchestratorThreadId || "__none"}
                    onValueChange={(value) =>
                      setProgramForm((current) => ({
                        ...current,
                        currentOrchestratorThreadId:
                          String(value) === "__none" ? "" : String(value),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select orchestrator" />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__none">No orchestrator</SelectItem>
                      {orchestratorOptions.map((option) => (
                        <SelectItem key={option.threadId} value={option.threadId}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel>Scope JSON</FieldLabel>
                <FieldDescription>
                  Program creation requires at least one declared repo and one valid lane contract
                  per repo.
                </FieldDescription>
                <Textarea
                  className="min-h-[22rem] font-mono text-xs"
                  value={programForm.scopeJson}
                  onChange={(event) =>
                    setProgramForm((current) => ({ ...current, scopeJson: event.target.value }))
                  }
                />
              </Field>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setProgramDialogOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isBusy} type="submit">
                {programDialogMode === "create" ? "Create Program" : "Save Program"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog onOpenChange={setLifecycleDialogOpen} open={lifecycleDialogOpen}>
        <DialogPopup className="max-w-xl">
          <form
            className="flex min-h-0 max-h-full flex-col"
            onSubmit={(event) => void submitLifecycleForm(event)}
          >
            <DialogHeader>
              <DialogTitle>Update Program status</DialogTitle>
              <DialogDescription>
                Use lifecycle-safe status actions for founder review, completion, and cancellation.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={lifecycleForm.nextStatus}
                  onValueChange={(value) =>
                    setLifecycleForm((current) => ({ ...current, nextStatus: String(value) }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectPopup>
                    {(programLifecycleOptions.length > 0
                      ? programLifecycleOptions
                      : lifecycleProgram
                        ? [
                            {
                              action: null,
                              label: lifecycleProgram.status,
                              sortKey: null,
                              tone: null,
                              value: lifecycleProgram.status,
                            },
                          ]
                        : []
                    ).map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              {lifecycleForm.nextStatus === "cancelled" ? (
                <>
                  <Field>
                    <FieldLabel>Cancel reason</FieldLabel>
                    <Textarea
                      required
                      className="min-h-28"
                      value={lifecycleForm.reason}
                      onChange={(event) =>
                        setLifecycleForm((current) => ({ ...current, reason: event.target.value }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Superseded by Program ID</FieldLabel>
                    <Input
                      value={lifecycleForm.supersededByProgramId}
                      onChange={(event) =>
                        setLifecycleForm((current) => ({
                          ...current,
                          supersededByProgramId: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setLifecycleDialogOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isBusy} type="submit">
                Save status
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog onOpenChange={setTodoDialogOpen} open={todoDialogOpen}>
        <DialogPopup className="max-w-4xl">
          <form
            className="flex min-h-0 max-h-full flex-col"
            onSubmit={(event) => void submitTodoForm(event)}
          >
            <DialogHeader>
              <DialogTitle>{todoDialogMode === "create" ? "Create TODO" : "Edit TODO"}</DialogTitle>
              <DialogDescription>
                Manage TODO details, Program assignment, and linked plan references.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Title</FieldLabel>
                  <Input
                    required
                    value={todoForm.title}
                    onChange={(event) =>
                      setTodoForm((current) => ({ ...current, title: event.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>TODO ID</FieldLabel>
                  <Input
                    disabled={todoDialogMode === "edit"}
                    value={todoForm.todoId}
                    onChange={(event) =>
                      setTodoForm((current) => ({ ...current, todoId: event.target.value }))
                    }
                  />
                  <FieldDescription>
                    Optional. Leave blank to derive from the title.
                  </FieldDescription>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <Field>
                  <FieldLabel>Agent</FieldLabel>
                  <Select
                    value={
                      todoDialogMode === "edit"
                        ? (editingTodo?.agent ?? todoForm.agent)
                        : todoForm.agent
                    }
                    onValueChange={(value) =>
                      setTodoForm((current) => ({ ...current, agent: String(value) }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Agent" />
                    </SelectTrigger>
                    <SelectPopup>
                      {agents.map((agent) => (
                        <SelectItem key={agent} value={agent}>
                          {agent}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Program</FieldLabel>
                  <Select
                    value={todoForm.programId || "__none"}
                    onValueChange={(value) =>
                      setTodoForm((current) => ({
                        ...current,
                        programId: String(value) === "__none" ? "" : String(value),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Program" />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__none">Unassigned</SelectItem>
                      {programs.map((program) => (
                        <SelectItem key={program.id} value={program.id}>
                          {program.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <Select
                    value={todoForm.status}
                    onValueChange={(value) =>
                      setTodoForm((current) => ({ ...current, status: String(value) }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectPopup>
                      {(todoStatusOptions.length > 0
                        ? todoStatusOptions
                        : todoStatuses.map((status) => ({
                            action: null,
                            label: status,
                            sortKey: null,
                            tone: null,
                            value: status,
                          }))
                      ).map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Priority</FieldLabel>
                  <Select
                    value={todoForm.priority}
                    onValueChange={(value) =>
                      setTodoForm((current) => ({ ...current, priority: String(value) }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectPopup>
                      {(todoPriorityOptions.length > 0
                        ? todoPriorityOptions
                        : todoPriorities.map((priority) => ({
                            action: null,
                            label: priority,
                            sortKey: null,
                            tone: null,
                            value: priority,
                          }))
                      ).map((priority) => (
                        <SelectItem key={priority.value} value={priority.value}>
                          {priority.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel>Summary</FieldLabel>
                <Textarea
                  className="min-h-28"
                  value={todoForm.summary}
                  onChange={(event) =>
                    setTodoForm((current) => ({ ...current, summary: event.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Next action</FieldLabel>
                <Textarea
                  className="min-h-28"
                  value={todoForm.nextAction}
                  onChange={(event) =>
                    setTodoForm((current) => ({ ...current, nextAction: event.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Plan links</FieldLabel>
                <PlanLinksEditor
                  planLinks={todoForm.planLinks}
                  onChange={(planLinks) => setTodoForm((current) => ({ ...current, planLinks }))}
                />
              </Field>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setTodoDialogOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isBusy} type="submit">
                {todoDialogMode === "create" ? "Create TODO" : "Save TODO"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setProgramDeleteTarget(null);
          }
        }}
        open={programDeleteTarget !== null}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete Program?</DialogTitle>
            <DialogDescription>
              This removes the Program record and its closeout document.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setProgramDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (!programDeleteTarget) {
                  return;
                }
                try {
                  await deleteProgramMutation.mutateAsync({ programId: programDeleteTarget.id });
                  await refreshControlPlaneData();
                  toastManager.add({ type: "success", title: "Program deleted" });
                  setProgramDeleteTarget(null);
                } catch (error) {
                  toastManager.add({
                    type: "error",
                    title: "Program delete failed",
                    description: error instanceof Error ? error.message : "Unknown error.",
                  });
                }
              }}
            >
              Delete Program
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setTodoDeleteTarget(null);
          }
        }}
        open={todoDeleteTarget !== null}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete TODO?</DialogTitle>
            <DialogDescription>
              This removes the TODO JSON record and refreshes the local SQLite projection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setTodoDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (!todoDeleteTarget) {
                  return;
                }
                try {
                  await deleteTodoMutation.mutateAsync({
                    agent: todoDeleteTarget.agent,
                    todoId: todoDeleteTarget.todoId,
                  });
                  await refreshControlPlaneData();
                  toastManager.add({ type: "success", title: "TODO deleted" });
                  setTodoDeleteTarget(null);
                } catch (error) {
                  toastManager.add({
                    type: "error",
                    title: "TODO delete failed",
                    description: error instanceof Error ? error.message : "Unknown error.",
                  });
                }
              }}
            >
              Delete TODO
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
