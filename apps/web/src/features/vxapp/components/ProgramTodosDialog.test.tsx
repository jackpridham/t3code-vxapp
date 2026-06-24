import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ServerAgentsVxappTodoSnapshot } from "@t3tools/contracts";

vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogPanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { ProgramTodosDialog } from "./ProgramTodosDialog";

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
    programId: "program-1" as ServerAgentsVxappTodoSnapshot["programId"],
    status: "ready",
    summary: null,
    title,
    todoId,
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...rest,
  };
}

describe("ProgramTodosDialog", () => {
  it("renders TODO rows even when notes is absent from demoData", () => {
    const markup = renderToStaticMarkup(
      <ProgramTodosDialog
        demoData={{
          currentTodoId: null,
          error: null,
          status: "ready",
          todos: [
            {
              ...makeTodo({
                agent: "jasper",
                title: "Owner row without notes",
                todoId: "todo-1",
              }),
              notes: undefined,
            } as unknown as ServerAgentsVxappTodoSnapshot,
          ],
        }}
        onOpenChange={() => {}}
        open
        programId="program-1"
        programTitle="Program Alpha"
      />,
    );

    expect(markup).toContain("Program Alpha TODOs");
    expect(markup).toContain("Owner row without notes");
  });
});
