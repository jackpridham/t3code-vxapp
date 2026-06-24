import { describe, expect, it, vi } from "vitest";

import {
  buildEditableTodoPlanLinkDrafts,
  readTodoNotes,
  readTodoPlanLinks,
} from "./programTodoSnapshot";

describe("programTodoSnapshot", () => {
  it("treats missing nested owner arrays as empty arrays", () => {
    const todo = {
      agent: "jasper",
      todoId: "todo-1",
      title: "Missing nested arrays",
    };

    expect(readTodoPlanLinks(todo)).toEqual([]);
    expect(readTodoNotes(todo)).toEqual([]);
  });

  it("preserves valid notes arrays during normalization", () => {
    const todo = {
      notes: ["first note", { kind: "status", value: "blocked" }, 7],
    };

    expect(readTodoNotes(todo)).toEqual(["first note", { kind: "status", value: "blocked" }, 7]);
  });

  it("builds empty editable plan-link drafts when edit dialog data is malformed", () => {
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID");
    randomUuidSpy.mockImplementation(() => "00000000-0000-4000-8000-000000000000");

    try {
      const malformedTodos = [
        { planLinks: null },
        { planLinks: {} },
        { planLinks: [{ repo: "repo-only" }] },
      ];

      for (const todo of malformedTodos) {
        expect(buildEditableTodoPlanLinkDrafts(todo)).toEqual([]);
      }

      expect(randomUuidSpy).not.toHaveBeenCalled();
    } finally {
      randomUuidSpy.mockRestore();
    }
  });

  it("preserves minimally valid plan links during normalization and draft building", () => {
    const randomUuidSpy = vi.spyOn(crypto, "randomUUID");
    randomUuidSpy.mockImplementation(() => "00000000-0000-4000-8000-000000000000");

    try {
      const todo = {
        planLinks: [
          {
            repo: "api-vxapp",
            planKey: "plan-123",
          },
        ],
      };

      expect(readTodoPlanLinks(todo)).toEqual([
        {
          repo: "api-vxapp",
          planKey: "plan-123",
        },
      ]);
      expect(buildEditableTodoPlanLinkDrafts(todo)).toEqual([
        {
          id: "00000000-0000-4000-8000-000000000000",
          repo: "api-vxapp",
          planKey: "plan-123",
          phase: null,
          step: null,
        },
      ]);
    } finally {
      randomUuidSpy.mockRestore();
    }
  });
});
