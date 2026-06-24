# Fix Program/TODO Owner-Payload Crashes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/programs` and sidebar Program/TODO crashes caused by owner snapshots that omit nested TODO arrays such as `planLinks` and `notes`.

**Architecture:** Tighten the vxapp server boundary where owner snapshots cross into T3 by decoding raw Program/TODO payloads with the existing `@t3tools/contracts` schemas inside the server layers that serve those snapshots. Back that up with one small shared web normalization helper so render code and edit-form initialization never call `.length` or `.map` on undefined nested TODO fields, even if a malformed row slips through tests or future regressions.

**Tech Stack:** TypeScript, Effect Schema, React 19, Zustand, TanStack React Query, Vitest, Bun

---

## Current State Review

- `packages/contracts/src/server.ts` defines `ServerAgentsVxappTodoSnapshot`, but `planLinks` and `notes` are still required arrays without `Schema.withDecodingDefault`, so absent nested arrays fail contract intent even though top-level sidebar arrays already default.
- `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.ts` currently uses `sanitizeProgramsTodosSnapshot`, which only shallow-defaults `hints` and `pagination` and does nothing for nested TODO arrays.
- `apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.ts` currently forwards the owner snapshot straight through after transport error mapping; it does not contract-decode the raw owner payload at all.
- `apps/web/src/features/vxapp/components/ProgramsTodosView.tsx` still does `todo?.planLinks.map(...)` during edit-form initialization and `todo.planLinks.length` during TODO-card rendering.
- `apps/web/src/features/vxapp/components/ProgramTodosDialog.tsx` still does `todo.planLinks.length`, `todo.planLinks.map(...)`, `todo.notes.length`, and `todo.notes.map(...)` directly.
- `apps/web/src/features/vxapp/components/ProgramsTodosView.tsx` is already very large, so extracting the TODO list pane while adding shared normalization improves maintainability instead of piling more local guards into the same file.

## File Structure

- Modify: `packages/contracts/src/server.ts`
  - Add contract defaults for nested TODO arrays so missing owner payload fields decode to `[]`.
- Create: `packages/contracts/src/server.test.ts`
  - Lock down decode behavior for missing `planLinks` and `notes`.
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.ts`
  - Replace the shallow sanitizer with schema decoding for Program/TODO snapshots and surface structured decode failures.
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.ts`
  - Decode sidebar authority snapshots with the contract schema before returning them.
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.test.ts`
  - Add a regression test for missing nested TODO arrays in raw owner Program/TODO snapshots.
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.test.ts`
  - Add a regression test for missing nested TODO arrays in raw owner sidebar authority snapshots.
- Create: `apps/web/src/features/vxapp/components/programTodoSnapshot.ts`
  - Centralize render-safe TODO normalization and edit-form draft preparation.
- Create: `apps/web/src/features/vxapp/components/programTodoSnapshot.test.ts`
  - Pure tests for missing nested TODO arrays and edit-form initialization behavior.
- Create: `apps/web/src/features/vxapp/components/ProgramTodoListPane.tsx`
  - Extract the `SelectedGroupPane` TODO-list render path from `ProgramsTodosView.tsx` so it can be tested directly.
- Create: `apps/web/src/features/vxapp/components/ProgramTodoListPane.test.tsx`
  - Static-markup regression test for `/programs` TODO cards when `planLinks` is absent.
- Modify: `apps/web/src/features/vxapp/components/ProgramsTodosView.tsx`
  - Use the shared TODO normalization helper for edit-form initialization and render through the extracted pane.
- Create: `apps/web/src/features/vxapp/components/ProgramTodosDialog.test.tsx`
  - Static-markup regression test for missing `notes`.
- Modify: `apps/web/src/features/vxapp/components/ProgramTodosDialog.tsx`
  - Use shared TODO normalization instead of direct `.length` / `.map` reads.

### Task 1: Add Contract Defaults for Nested TODO Arrays

**Files:**

- Modify: `packages/contracts/src/server.ts`
- Create: `packages/contracts/src/server.test.ts`

- [ ] **Step 1: Write the failing contract decode tests**

```ts
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  ServerAgentsVxappTodoSnapshot,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
} from "./server";

const decodeTodo = Schema.decodeUnknownSync(ServerAgentsVxappTodoSnapshot);
const decodeSidebarSnapshot = Schema.decodeUnknownSync(
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
);

describe("ServerAgentsVxappTodoSnapshot", () => {
  it("defaults missing planLinks and notes to empty arrays", () => {
    expect(
      decodeTodo({
        todoId: "todo-1",
        agent: "jasper",
        programId: null,
        title: "Repair owner payload crash",
        summary: null,
        nextAction: null,
        status: "ready",
        priority: "normal",
        filePath: null,
        owner: null,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      }),
    ).toMatchObject({
      planLinks: [],
      notes: [],
    });
  });
});

describe("ServerGetAgentsVxappSidebarAuthoritySnapshotResult", () => {
  it("defaults nested currentTodo arrays through the TODO schema", () => {
    const snapshot = decodeSidebarSnapshot({
      programs: [
        {
          program: {
            id: "program-1",
            title: "Owner Program",
            objective: null,
            status: "active",
            baseStatus: null,
            currentStatus: null,
            executiveProjectId: null,
            executiveThreadId: null,
            currentOrchestratorThreadId: null,
            metadata: null,
            closeout: null,
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
            completedAt: null,
            deletedAt: null,
          },
          currentTodo: {
            todoId: "todo-1",
            agent: "jasper",
            programId: "program-1",
            title: "Repair owner payload crash",
            summary: null,
            nextAction: null,
            status: "ready",
            priority: "normal",
            filePath: null,
            owner: null,
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
          display: null,
          executive: null,
          orchestrator: null,
          workers: [],
          notifications: [],
          attentionItems: [],
          openWakes: [],
          watchProjection: null,
          activeAllocations: [],
          ownerDiagnostics: [],
        },
      ],
      todos: [],
      currentTodos: [],
      ownerDiagnostics: [],
      hints: [],
      pagination: null,
    });

    expect(snapshot.programs[0]?.currentTodo).toMatchObject({
      planLinks: [],
      notes: [],
    });
  });
});
```

- [ ] **Step 2: Run the focused contract test to verify it fails**

Run: `cd packages/contracts && bun run test src/server.test.ts`

Expected: FAIL because `ServerAgentsVxappTodoSnapshot` still treats `planLinks` and `notes` as required arrays.

- [ ] **Step 3: Implement the contract defaults**

```ts
export const ServerAgentsVxappTodoSnapshot = Schema.Struct({
  todoId: TrimmedNonEmptyString,
  agent: TrimmedNonEmptyString,
  programId: Schema.NullOr(ProgramId),
  title: TrimmedNonEmptyString,
  summary: Schema.NullOr(Schema.String),
  nextAction: Schema.NullOr(Schema.String),
  status: TrimmedNonEmptyString,
  priority: TrimmedNonEmptyString,
  filePath: Schema.NullOr(TrimmedNonEmptyString),
  owner: Schema.NullOr(JsonRecord),
  planLinks: Schema.Array(ServerAgentsVxappTodoPlanLink).pipe(Schema.withDecodingDefault(() => [])),
  notes: Schema.Array(JsonValue).pipe(Schema.withDecodingDefault(() => [])),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
```

- [ ] **Step 4: Run the focused contract test to verify it passes**

Run: `cd packages/contracts && bun run test src/server.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/server.ts packages/contracts/src/server.test.ts
git commit -m "fix: default nested vxapp todo arrays"
```

### Task 2: Decode Raw Owner Snapshots in the vxapp Server Layers

**Files:**

- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.ts`
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.ts`
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.test.ts`
- Modify: `apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.test.ts`

- [ ] **Step 1: Write the failing server-layer regression tests**

```ts
it("decodes missing nested TODO arrays in raw Program/TODO owner snapshots", async () => {
  mockedProgramsTodos.mockResolvedValueOnce({
    ...emptySnapshot,
    todos: [
      {
        todoId: "todo-owner",
        agent: "jasper",
        programId: null,
        title: "Repair crash",
        summary: null,
        nextAction: null,
        status: "ready",
        priority: "normal",
        filePath: null,
        owner: null,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    ],
  } as unknown as typeof emptySnapshot);

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const controlPlane = yield* AgentsVxappControlPlane;
      return yield* controlPlane.getProgramsTodosSnapshot({});
    }).pipe(Effect.provide(AgentsVxappControlPlaneLive)),
  );

  expect(result.todos[0]).toMatchObject({
    planLinks: [],
    notes: [],
  });
});
```

```ts
it("decodes missing nested TODO arrays in raw sidebar owner snapshots", async () => {
  mockedSidebarAuthoritySnapshot.mockResolvedValueOnce({
    programs: [
      {
        ...ownerAuthoritySnapshot.programs[0],
        currentTodo: {
          todoId: "todo-owner",
          agent: "jasper",
          programId: "program-owner",
          title: "Repair crash",
          summary: null,
          nextAction: null,
          status: "ready",
          priority: "normal",
          filePath: null,
          owner: null,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      },
    ],
    todos: [
      {
        todoId: "todo-owner",
        agent: "jasper",
        programId: "program-owner",
        title: "Repair crash",
        summary: null,
        nextAction: null,
        status: "ready",
        priority: "normal",
        filePath: null,
        owner: null,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    ],
    currentTodos: [],
    ownerDiagnostics: [],
    hints: [],
    pagination: null,
  } as unknown as typeof ownerAuthoritySnapshot);

  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      const sidebar = yield* AgentsVxappSidebar;
      return yield* sidebar.getAuthoritySnapshot({ page: 1, limit: 20 });
    }).pipe(Effect.provide(AgentsVxappSidebarLive)),
  );

  expect(snapshot.todos[0]).toMatchObject({ planLinks: [], notes: [] });
  expect(snapshot.programs[0]?.currentTodo).toMatchObject({ planLinks: [], notes: [] });
});
```

- [ ] **Step 2: Run the focused server tests to verify they fail**

Run: `cd apps/server && bun run test src/extensions/vxapp/Layers/AgentsVxappControlPlane.test.ts src/extensions/vxapp/Layers/AgentsVxappSidebar.test.ts`

Expected: FAIL because the layers currently forward malformed nested TODO fields unchanged.

- [ ] **Step 3: Replace the shallow sanitizer with contract decoding in both layers**

```ts
import {
  ProgramId,
  ProjectId,
  ThreadId,
  ServerGetAgentsVxappControlPlaneSnapshotResult,
  type ServerGetAgentsVxappControlPlaneSnapshotResult as ServerGetAgentsVxappControlPlaneSnapshotResultType,
} from "@t3tools/contracts";

const decodeProgramsTodosSnapshot = Schema.decodeUnknownSync(
  ServerGetAgentsVxappControlPlaneSnapshotResult,
);

function parseProgramsTodosSnapshot(
  snapshot: unknown,
): ServerGetAgentsVxappControlPlaneSnapshotResultType {
  try {
    return decodeProgramsTodosSnapshot(snapshot);
  } catch (cause) {
    throw new AgentsVxappControlPlaneError({
      operation: "ownerControlPlane.programsTodos.decode",
      detail:
        cause instanceof Error
          ? cause.message
          : "Owner Program/TODO snapshot failed contract decode.",
      cause,
      ownerCommand: "t3code-programs-todos-snapshot",
      authoritySurface: "programs_todos_snapshot",
    });
  }
}
```

```ts
getProgramsTodosSnapshot: (input) =>
  ownerPromise("ownerControlPlane.programsTodos.getProgramsTodosSnapshot", () =>
    fetchAgentsVxappProgramsTodosSnapshot(input).then(parseProgramsTodosSnapshot),
  ),
```

```ts
import {
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  type ServerGetAgentsVxappSidebarAuthoritySnapshotResult as ServerGetAgentsVxappSidebarAuthoritySnapshotResultType,
} from "@t3tools/contracts";

const decodeSidebarAuthoritySnapshot = Schema.decodeUnknownSync(
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
);

function parseSidebarAuthoritySnapshot(
  snapshot: unknown,
): ServerGetAgentsVxappSidebarAuthoritySnapshotResultType {
  try {
    return decodeSidebarAuthoritySnapshot(snapshot);
  } catch (cause) {
    throw new AgentsVxappSidebarError({
      message:
        cause instanceof Error
          ? cause.message
          : "Owner sidebar authority snapshot failed contract decode.",
      ownerCommand: "t3code-sidebar-authority-snapshot",
      authoritySurface: "sidebar_authority_snapshot",
    });
  }
}

const getAuthoritySnapshot: AgentsVxappSidebarShape["getAuthoritySnapshot"] = (input) =>
  Effect.tryPromise({
    try: () => fetchAgentsVxappSidebarAuthoritySnapshot(input).then(parseSidebarAuthoritySnapshot),
    catch: (error) =>
      mapSidebarError(
        error instanceof Error
          ? error.message
          : "Failed to fetch vxapp sidebar authority owner snapshot.",
        error,
      ),
  });
```

- [ ] **Step 4: Run the focused server tests to verify they pass**

Run: `cd apps/server && bun run test src/extensions/vxapp/Layers/AgentsVxappControlPlane.test.ts src/extensions/vxapp/Layers/AgentsVxappSidebar.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.ts apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.ts apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.test.ts apps/server/src/extensions/vxapp/Layers/AgentsVxappSidebar.test.ts
git commit -m "fix: decode vxapp owner program snapshots in server layers"
```

### Task 3: Add Shared Browser TODO Normalization and Extract the `/programs` TODO Pane

**Files:**

- Create: `apps/web/src/features/vxapp/components/programTodoSnapshot.ts`
- Create: `apps/web/src/features/vxapp/components/programTodoSnapshot.test.ts`
- Create: `apps/web/src/features/vxapp/components/ProgramTodoListPane.tsx`
- Create: `apps/web/src/features/vxapp/components/ProgramTodoListPane.test.tsx`
- Modify: `apps/web/src/features/vxapp/components/ProgramsTodosView.tsx`

- [ ] **Step 1: Write the failing browser helper and pane tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildEditableTodoPlanLinkDrafts,
  readTodoPlanLinks,
  readTodoNotes,
} from "./programTodoSnapshot";

const malformedTodo = {
  todoId: "todo-owner",
  agent: "jasper",
  programId: "program-1",
  title: "Repair crash",
  summary: null,
  nextAction: null,
  status: "ready",
  priority: "normal",
  filePath: null,
  owner: null,
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-23T00:00:00.000Z",
} as any;

describe("programTodoSnapshot", () => {
  it("treats missing nested owner arrays as empty arrays", () => {
    expect(readTodoPlanLinks(malformedTodo)).toEqual([]);
    expect(readTodoNotes(malformedTodo)).toEqual([]);
  });

  it("builds empty editable plan-link drafts when edit dialog data is malformed", () => {
    expect(buildEditableTodoPlanLinkDrafts(malformedTodo)).toEqual([]);
  });
});
```

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProgramTodoListPane } from "./ProgramTodoListPane";

it("renders TODO cards when planLinks is absent from the owner row", () => {
  const html = renderToStaticMarkup(
    <ProgramTodoListPane
      agents={["jasper"]}
      currentTodoId={null}
      description={null}
      executiveLabel={null}
      groupLabel="Owner Program"
      onCreateTodo={() => {}}
      onDeleteTodo={() => {}}
      onEditTodo={() => {}}
      onTodoSearchChange={() => {}}
      orchestratorLabel={null}
      scopeSummary={null}
      selectedTodoAgent="all"
      selectedTodoStatus="all"
      setSelectedTodoAgent={() => {}}
      setSelectedTodoStatus={() => {}}
      status={null}
      todoSearch=""
      todoStatuses={["ready"]}
      verdict={null}
      visibleTodos={[
        {
          todoId: "todo-owner",
          agent: "jasper",
          programId: "program-1",
          title: "Repair crash",
          summary: null,
          nextAction: null,
          status: "ready",
          priority: "normal",
          filePath: null,
          owner: null,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        } as any,
      ]}
    />,
  );

  expect(html).toContain("Repair crash");
  expect(html).toContain("No summary recorded.");
});
```

- [ ] **Step 2: Run the focused web tests to verify they fail**

Run: `cd apps/web && bun run test src/features/vxapp/components/programTodoSnapshot.test.ts src/features/vxapp/components/ProgramTodoListPane.test.tsx`

Expected: FAIL because the shared normalization helper and extracted TODO pane do not exist yet.

- [ ] **Step 3: Implement the shared helper and move the TODO-list render path out of `ProgramsTodosView.tsx`**

```ts
import type {
  ServerAgentsVxappTodoPlanLink,
  ServerAgentsVxappTodoSnapshot,
} from "@t3tools/contracts";

type TodoLike = ServerAgentsVxappTodoSnapshot & {
  notes?: unknown;
  planLinks?: unknown;
};

export type EditableTodoPlanLinkDraft = {
  phase: string | null;
  planKey: string;
  repo: string;
  step: string | null;
};

function isTodoPlanLink(value: unknown): value is ServerAgentsVxappTodoPlanLink {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).repo === "string" &&
    typeof (value as Record<string, unknown>).planKey === "string"
  );
}

export function readTodoPlanLinks(
  todo: ServerAgentsVxappTodoSnapshot | null | undefined,
): readonly ServerAgentsVxappTodoPlanLink[] {
  const planLinks = (todo as TodoLike | null | undefined)?.planLinks;
  return Array.isArray(planLinks) ? planLinks.filter(isTodoPlanLink) : [];
}

export function readTodoNotes(
  todo: ServerAgentsVxappTodoSnapshot | null | undefined,
): readonly unknown[] {
  const notes = (todo as TodoLike | null | undefined)?.notes;
  return Array.isArray(notes) ? notes : [];
}

export function buildEditableTodoPlanLinkDrafts(
  todo: ServerAgentsVxappTodoSnapshot | null | undefined,
): EditableTodoPlanLinkDraft[] {
  return readTodoPlanLinks(todo).map((link) => ({
    repo: link.repo,
    planKey: link.planKey,
    phase: link.phase ?? null,
    step: link.step ?? null,
  }));
}
```

```tsx
import type { ServerAgentsVxappTodoSnapshot } from "@t3tools/contracts";
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
import { ListTodoIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "~/lib/utils";
import { ProgramOverviewCard } from "./ProgramOverviewCard";
import { readTodoPlanLinks } from "./programTodoSnapshot";

const NEUTRAL_BADGE_CLASSNAME = "h-5 border border-border/70 bg-background/70 px-1.5 text-[10px]";

export function ProgramTodoListPane(props: {
  agents: readonly string[];
  currentTodoId: string | null;
  description: string | null;
  executiveLabel: string | null;
  groupLabel: string;
  onCreateTodo: () => void;
  onDeleteTodo: (todo: ServerAgentsVxappTodoSnapshot) => void;
  onEditTodo: (todo: ServerAgentsVxappTodoSnapshot) => void;
  onTodoSearchChange: (value: string) => void;
  orchestratorLabel: string | null;
  scopeSummary: string | null;
  selectedTodoAgent: string;
  selectedTodoStatus: string;
  setSelectedTodoAgent: (value: string) => void;
  setSelectedTodoStatus: (value: string) => void;
  status: { label: string | null; tone: string | null } | null;
  todoSearch: string;
  todoStatuses: readonly string[];
  verdict: string | null;
  visibleTodos: readonly ServerAgentsVxappTodoSnapshot[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <ProgramOverviewCard
        action={
          <Button onClick={props.onCreateTodo}>
            <PlusIcon className="size-3.5" />
            New TODO
          </Button>
        }
        currentTodoId={props.currentTodoId}
        description={props.description}
        executiveLabel={props.executiveLabel}
        orchestratorLabel={props.orchestratorLabel}
        scopeSummary={props.scopeSummary}
        status={props.status}
        title={props.groupLabel}
        totalTodoCount={props.visibleTodos.length}
        verdict={props.verdict}
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="min-w-0 flex-1">
            <CardTitle>Program TODOs</CardTitle>
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
    </div>
  );
}
```

```ts
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
    planLinks: buildEditableTodoPlanLinkDrafts(todo).map((link) =>
      makeEditablePlanLink({
        repo: link.repo,
        planKey: link.planKey,
        phase: link.phase,
        step: link.step,
      }),
    ),
    priority: todo?.priority ?? optionDefaults?.priority ?? "",
    programId: todo?.programId ?? "",
    status: todo?.status ?? optionDefaults?.status ?? "",
    summary: todo?.summary ?? "",
    title: todo?.title ?? "",
    todoId: todo?.todoId ?? "",
  };
}
```

```tsx
<ProgramTodoListPane
  agents={agents}
  currentTodoId={selectedGroupCard?.currentTodoId ?? null}
  description={selectedGroupCard?.group.description ?? null}
  executiveLabel={selectedGroupCard?.executiveLabel ?? null}
  groupLabel={selectedGroupCard ? title : "Grouped TODOs"}
  onCreateTodo={() => props.onCreateTodo(selectedProgram?.id)}
  onDeleteTodo={props.onDeleteTodo}
  onEditTodo={props.onEditTodo}
  onTodoSearchChange={props.onTodoSearchChange}
  orchestratorLabel={selectedGroupCard?.orchestratorLabel ?? null}
  scopeSummary={selectedGroupCard?.scopeSummary ?? null}
  selectedTodoAgent={props.selectedTodoAgent}
  selectedTodoStatus={props.selectedTodoStatus}
  setSelectedTodoAgent={props.setSelectedTodoAgent}
  setSelectedTodoStatus={props.setSelectedTodoStatus}
  status={selectedGroupCard?.status ?? null}
  todoSearch={props.todoSearch}
  todoStatuses={props.todoStatuses}
  verdict={selectedGroupCard?.verdict ?? null}
  visibleTodos={props.visibleTodos}
/>
```

- [ ] **Step 4: Run the focused web tests to verify they pass**

Run: `cd apps/web && bun run test src/features/vxapp/components/programTodoSnapshot.test.ts src/features/vxapp/components/ProgramTodoListPane.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/vxapp/components/programTodoSnapshot.ts apps/web/src/features/vxapp/components/programTodoSnapshot.test.ts apps/web/src/features/vxapp/components/ProgramTodoListPane.tsx apps/web/src/features/vxapp/components/ProgramTodoListPane.test.tsx apps/web/src/features/vxapp/components/ProgramsTodosView.tsx
git commit -m "fix: normalize malformed program todo rows in programs view"
```

### Task 4: Harden the Sidebar Program TODO Dialog and Run Full Verification

**Files:**

- Modify: `apps/web/src/features/vxapp/components/ProgramTodosDialog.tsx`
- Create: `apps/web/src/features/vxapp/components/ProgramTodosDialog.test.tsx`

- [ ] **Step 1: Write the failing dialog regression test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("~/features/vxapp/agentsVxappStore", () => ({
  useAgentsVxappSidebarAuthorityBootstrap: () => {},
  useAgentsVxappStore: (selector: (store: any) => unknown) =>
    selector({
      status: "ready",
      error: null,
      currentTodoIdByProgramId: new Map(),
      todosByProgramId: new Map(),
    }),
}));

import { ProgramTodosDialog } from "./ProgramTodosDialog";

it("renders TODO rows when notes is absent from dialog data", () => {
  const html = renderToStaticMarkup(
    <ProgramTodosDialog
      demoData={{
        status: "ready",
        error: null,
        currentTodoId: null,
        todos: [
          {
            todoId: "todo-owner",
            agent: "jasper",
            programId: "program-1",
            title: "Repair crash",
            summary: null,
            nextAction: null,
            status: "ready",
            priority: "normal",
            filePath: null,
            owner: null,
            planLinks: [],
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
          } as any,
        ],
      }}
      open
      onOpenChange={() => {}}
      programId="program-1"
      programTitle="Owner Program"
    />,
  );

  expect(html).toContain("Owner Program TODOs");
  expect(html).toContain("Repair crash");
});
```

- [ ] **Step 2: Run the focused dialog test to verify it fails**

Run: `cd apps/web && bun run test src/features/vxapp/components/ProgramTodosDialog.test.tsx`

Expected: FAIL because the dialog still reads `todo.notes.length` directly.

- [ ] **Step 3: Switch the dialog to shared normalized arrays**

```ts
import { readTodoNotes, readTodoPlanLinks } from "./programTodoSnapshot";
```

```tsx
{
  todos.map((todo) => {
    const isCurrent = resolvedCurrentTodoId === todo.todoId;
    const planLinks = readTodoPlanLinks(todo);
    const notes = readTodoNotes(todo);

    return (
      <section
        key={`${todo.agent}:${todo.todoId}`}
        className="rounded-2xl border border-border/70 bg-card/70 p-4"
      >
        {/* existing title / summary / nextAction blocks */}

        {planLinks.length > 0 ? (
          <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-background/70 p-3">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Linked plans
            </div>
            {planLinks.map((link) => (
              <div
                key={`${todo.todoId}:${link.repo}:${link.planKey}:${link.phase ?? ""}:${link.step ?? ""}`}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                {/* existing badge/body */}
              </div>
            ))}
          </div>
        ) : null}

        {notes.length > 0 ? (
          <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-background/70 p-3">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Notes
            </div>
            {notes.map((note) => (
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
  });
}
```

- [ ] **Step 4: Run the touched tests plus required repo verification**

Run: `cd packages/contracts && bun run test src/server.test.ts`

Expected: PASS

Run: `cd apps/server && bun run test src/extensions/vxapp/Layers/AgentsVxappControlPlane.test.ts src/extensions/vxapp/Layers/AgentsVxappSidebar.test.ts`

Expected: PASS

Run: `cd apps/web && bun run test src/features/vxapp/components/programTodoSnapshot.test.ts src/features/vxapp/components/ProgramTodoListPane.test.tsx src/features/vxapp/components/ProgramTodosDialog.test.tsx`

Expected: PASS

Run: `bun fmt`

Expected: PASS with no formatting errors

Run: `bun lint`

Expected: PASS with no lint errors

Run: `bun typecheck`

Expected: PASS with no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/vxapp/components/ProgramTodosDialog.tsx apps/web/src/features/vxapp/components/ProgramTodosDialog.test.tsx
git commit -m "fix: guard program todo dialog against malformed owner rows"
```
