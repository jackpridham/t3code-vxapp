import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  clearProjectLabelFilters,
  clearThreadUi,
  markThreadUnread,
  reorderProjects,
  setProjectExpanded,
  setProjectLabelFilter,
  syncProjects,
  syncThreads,
  toggleProjectLabelFilter,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    orchestratorProjectCwds: [],
    threadLastVisitedAtById: {},
    labelFiltersByProject: {},
    ...overrides,
  };
}

describe("uiStateStore pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, latestTurnCompletedAt);

    expect(next.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:29:59.999Z");
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, null);

    expect(next).toBe(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState = makeUiState({
      projectOrder: [project1, project2, project3],
    });

    const next = reorderProjects(initialState, project1, project3);

    expect(next.projectOrder).toEqual([project2, project3, project1]);
  });

  it("syncProjects preserves current project order during snapshot recovery", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
        [project2]: false,
      },
      projectOrder: [project2, project1],
    });

    const next = syncProjects(initialState, [
      { id: project1, cwd: "/tmp/project-1" },
      { id: project2, cwd: "/tmp/project-2" },
      { id: project3, cwd: "/tmp/project-3" },
    ]);

    expect(next.projectOrder).toEqual([project2, project1, project3]);
    expect(next.projectExpandedById[project2]).toBe(false);
  });

  it("syncProjects preserves manual order when a project is recreated with the same cwd", () => {
    const oldProject1 = ProjectId.makeUnsafe("project-1");
    const oldProject2 = ProjectId.makeUnsafe("project-2");
    const recreatedProject2 = ProjectId.makeUnsafe("project-2b");
    const initialState = syncProjects(
      makeUiState({
        projectExpandedById: {
          [oldProject1]: true,
          [oldProject2]: false,
        },
        projectOrder: [oldProject2, oldProject1],
      }),
      [
        { id: oldProject1, cwd: "/tmp/project-1" },
        { id: oldProject2, cwd: "/tmp/project-2" },
      ],
    );

    const next = syncProjects(initialState, [
      { id: oldProject1, cwd: "/tmp/project-1" },
      { id: recreatedProject2, cwd: "/tmp/project-2" },
    ]);

    expect(next.projectOrder).toEqual([recreatedProject2, oldProject1]);
    expect(next.projectExpandedById[recreatedProject2]).toBe(false);
  });

  it("syncProjects returns a new state when only project cwd changes", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = syncProjects(
      makeUiState({
        projectExpandedById: {
          [project1]: false,
        },
        projectOrder: [project1],
      }),
      [{ id: project1, cwd: "/tmp/project-1" }],
    );

    const next = syncProjects(initialState, [{ id: project1, cwd: "/tmp/project-1-renamed" }]);

    expect(next).not.toBe(initialState);
    expect(next.projectOrder).toEqual([project1]);
    expect(next.projectExpandedById[project1]).toBe(false);
  });

  it("syncThreads prunes missing thread UI state", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const thread2 = ThreadId.makeUnsafe("thread-2");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
        [thread2]: "2026-02-25T12:36:00.000Z",
      },
    });

    const next = syncThreads(initialState, [{ id: thread1 }]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
  });

  it("syncThreads seeds visit state for unseen snapshot threads", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const initialState = makeUiState();

    const next = syncThreads(initialState, [
      {
        id: thread1,
        seedVisitedAt: "2026-02-25T12:35:00.000Z",
      },
    ]);

    expect(next.threadLastVisitedAtById).toEqual({
      [thread1]: "2026-02-25T12:35:00.000Z",
    });
  });

  it("setProjectExpanded updates expansion without touching order", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
      },
      projectOrder: [project1],
    });

    const next = setProjectExpanded(initialState, project1, false);

    expect(next.projectExpandedById[project1]).toBe(false);
    expect(next.projectOrder).toEqual([project1]);
  });

  it("clearThreadUi removes visit state for deleted threads", () => {
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [thread1]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = clearThreadUi(initialState, thread1);

    expect(next.threadLastVisitedAtById).toEqual({});
  });

  it("toggleProjectLabelFilter adds a label when not present", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState();

    const next = toggleProjectLabelFilter(initialState, projectId, "worker");

    expect(next.labelFiltersByProject[projectId]).toEqual(["worker"]);
  });

  it("toggleProjectLabelFilter removes a label when already active", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState({
      labelFiltersByProject: { [projectId]: ["worker"] },
    });

    const next = toggleProjectLabelFilter(initialState, projectId, "worker");

    expect(next.labelFiltersByProject[projectId]).toEqual([]);
  });

  it("clearProjectLabelFilters removes all filters for a project", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState({
      labelFiltersByProject: { [projectId]: ["worker", "model:sonnet"] },
    });

    const next = clearProjectLabelFilters(initialState, projectId);

    expect(next.labelFiltersByProject[projectId]).toBeUndefined();
  });

  it("clearProjectLabelFilters returns same state if project has no filters", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState();

    const next = clearProjectLabelFilters(initialState, projectId);

    expect(next).toBe(initialState);
  });

  it("setProjectLabelFilter replaces existing filters", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState({
      labelFiltersByProject: { [projectId]: ["old"] },
    });

    const next = setProjectLabelFilter(initialState, projectId, ["new"]);

    expect(next.labelFiltersByProject[projectId]).toEqual(["new"]);
  });

  it("filter state persists in store reference (not lost across reads)", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState();

    const afterToggle = toggleProjectLabelFilter(initialState, projectId, "worker");
    const afterRead = afterToggle.labelFiltersByProject[projectId];

    expect(afterRead).toEqual(["worker"]);
  });

  it("filter state is per-project (project A filters do not affect project B)", () => {
    const projectA = ProjectId.makeUnsafe("project-a");
    const projectB = ProjectId.makeUnsafe("project-b");
    const initialState = makeUiState();

    const next = setProjectLabelFilter(initialState, projectA, ["worker"]);

    expect(next.labelFiltersByProject[projectA]).toEqual(["worker"]);
    expect(next.labelFiltersByProject[projectB]).toBeUndefined();
  });
});
