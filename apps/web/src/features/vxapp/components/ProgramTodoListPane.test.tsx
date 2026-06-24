import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ServerAgentsVxappTodoSnapshot } from "@t3tools/contracts";

import { ProgramTodoListPane } from "./ProgramTodoListPane";

function makeTodo(
  overrides: Partial<ServerAgentsVxappTodoSnapshot> &
    Pick<ServerAgentsVxappTodoSnapshot, "agent" | "title" | "todoId">,
): ServerAgentsVxappTodoSnapshot {
  const { agent, title, todoId, ...rest } = overrides;
  return {
    agent,
    createdAt: "2026-05-10T00:00:00.000Z",
    filePath: null,
    nextAction: null,
    notes: [],
    owner: null,
    planLinks: [],
    priority: "normal",
    programId: null,
    status: "ready",
    summary: null,
    title,
    todoId,
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...rest,
  };
}

describe("ProgramTodoListPane", () => {
  it("renders TODO cards even when planLinks is absent from the owner row", () => {
    const markup = renderToStaticMarkup(
      <ProgramTodoListPane
        agents={["jasper"]}
        currentTodoId={null}
        isProgramSelection
        onDeleteTodo={() => {}}
        onEditTodo={() => {}}
        onTodoSearchChange={() => {}}
        selectedTodoAgent="all"
        selectedTodoStatus="all"
        setSelectedTodoAgent={() => {}}
        setSelectedTodoStatus={() => {}}
        todoSearch=""
        todoStatuses={["ready"]}
        visibleTodos={[
          {
            ...makeTodo({
              agent: "jasper",
              title: "Owner row without plan links",
              todoId: "todo-1",
            }),
            planLinks: undefined,
          } as unknown as ServerAgentsVxappTodoSnapshot,
        ]}
      />,
    );

    expect(markup).toContain("Owner row without plan links");
    expect(markup).toContain("No summary recorded.");
  });

  it("preserves current-todo and plan-link badge rendering in the extracted pane", () => {
    const markup = renderToStaticMarkup(
      <ProgramTodoListPane
        agents={["jasper"]}
        currentTodoId="todo-current"
        isProgramSelection
        onDeleteTodo={() => {}}
        onEditTodo={() => {}}
        onTodoSearchChange={() => {}}
        selectedTodoAgent="all"
        selectedTodoStatus="all"
        setSelectedTodoAgent={() => {}}
        setSelectedTodoStatus={() => {}}
        todoSearch=""
        todoStatuses={["ready"]}
        visibleTodos={[
          makeTodo({
            agent: "jasper",
            title: "Current TODO",
            todoId: "todo-current",
            planLinks: [
              {
                repo: "api-vxapp",
                planKey: "plan-123",
                phase: null,
                step: null,
                linkedAt: null,
              },
            ],
          }),
        ]}
      />,
    );

    expect(markup).toContain("Current TODO");
    expect(markup).toContain(">Current<");
    expect(markup).toContain("api-vxapp:plan-123");
  });
});
