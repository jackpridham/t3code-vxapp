import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notificationSettings";
import {
  clearProjectLabelFilters,
  clearSelectedOrchestrationSessionRoot,
  clearThreadUi,
  closeArtifactPanel,
  closeChangesPanel,
  focusIdeExplorerSection,
  initializeChangesPanelFromSettings,
  markThreadUnread,
  openArtifactPanel,
  openChangesPanel,
  reorderProjects,
  setChangesPanelActivePath,
  setChangesPanelActiveSection,
  setChangesPanelContentMode,
  setDiscoveredArtifacts,
  setIdeSelectedFile,
  setProjectExpanded,
  setProjectLabelFilter,
  setSelectedOrchestrationSessionRoot,
  syncProjects,
  syncThreads,
  toggleChangesPanel,
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
    selectedOrchestrationSessionRootByProjectId: {},
    artifactPanelOpen: false,
    artifactPanelPath: null,
    artifactPanelArtifacts: [],
    changesPanelOpen: false,
    changesPanelInitializedFromSettings: false,
    changesPanelActivePath: null,
    changesPanelActiveSection: null,
    changesPanelContentMode: "preview",
    ideExplorerOpen: true,
    ideExplorerExpandedSections: ["changes"],
    ideChatDrawerOpen: true,
    ideOrchestrationManagerOpen: false,
    ideSelectedFile: null,
    ideSelectedDrawerThreadId: null,
    ideMarkdownPreviewEnabled: false,
    ideDiffEnabled: false,
    notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
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

  it("syncProjects prunes selected orchestration roots for removed projects", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const root1 = ThreadId.makeUnsafe("root-1");
    const root2 = ThreadId.makeUnsafe("root-2");
    const initialState = makeUiState({
      projectExpandedById: {
        [project1]: true,
        [project2]: true,
      },
      projectOrder: [project1, project2],
      selectedOrchestrationSessionRootByProjectId: {
        [project1]: root1,
        [project2]: root2,
      },
    });

    const next = syncProjects(initialState, [{ id: project1, cwd: "/tmp/project-1" }]);

    expect(next.selectedOrchestrationSessionRootByProjectId).toEqual({
      [project1]: root1,
    });
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

  it("toggleProjectLabelFilter appends new labels in selection order", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState({
      labelFiltersByProject: { [projectId]: ["worker"] },
    });

    const next = toggleProjectLabelFilter(initialState, projectId, "model:gpt-5.4");

    expect(next.labelFiltersByProject[projectId]).toEqual(["worker", "model:gpt-5.4"]);
  });

  it("toggleProjectLabelFilter removes only the targeted active label", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState({
      labelFiltersByProject: { [projectId]: ["worker", "model:gpt-5.4", "review"] },
    });

    const next = toggleProjectLabelFilter(initialState, projectId, "model:gpt-5.4");

    expect(next.labelFiltersByProject[projectId]).toEqual(["worker", "review"]);
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

  it("setSelectedOrchestrationSessionRoot stores the active root per project", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const next = setSelectedOrchestrationSessionRoot(
      makeUiState(),
      projectId,
      ThreadId.makeUnsafe("root-1"),
    );

    expect(next.selectedOrchestrationSessionRootByProjectId[projectId]).toBe("root-1");
  });

  it("clearSelectedOrchestrationSessionRoot removes the selected root for a project", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    const initialState = makeUiState({
      selectedOrchestrationSessionRootByProjectId: {
        [projectId]: ThreadId.makeUnsafe("root-1"),
      },
    });

    const next = clearSelectedOrchestrationSessionRoot(initialState, projectId);

    expect(next.selectedOrchestrationSessionRootByProjectId[projectId]).toBeUndefined();
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

// ── Artifact panel ───────────────────────────────────────────────────────────

describe("artifact panel pure functions", () => {
  it("openArtifactPanel sets open=true and currentPath", () => {
    const state = makeUiState();
    const next = openArtifactPanel(state, "/repo/@Docs/@Scratch/repo/plan.md");
    expect(next.artifactPanelOpen).toBe(true);
    expect(next.artifactPanelPath).toBe("/repo/@Docs/@Scratch/repo/plan.md");
  });

  it("openArtifactPanel returns same reference when already open at same path", () => {
    const state = makeUiState({
      artifactPanelOpen: true,
      artifactPanelPath: "/repo/plan.md",
    });
    const next = openArtifactPanel(state, "/repo/plan.md");
    expect(next).toBe(state);
  });

  it("openArtifactPanel navigates to a different path", () => {
    const state = makeUiState({
      artifactPanelOpen: true,
      artifactPanelPath: "/repo/old.md",
    });
    const next = openArtifactPanel(state, "/repo/new.md");
    expect(next.artifactPanelOpen).toBe(true);
    expect(next.artifactPanelPath).toBe("/repo/new.md");
  });

  it("closeArtifactPanel sets open=false and path=null", () => {
    const state = makeUiState({
      artifactPanelOpen: true,
      artifactPanelPath: "/repo/plan.md",
    });
    const next = closeArtifactPanel(state);
    expect(next.artifactPanelOpen).toBe(false);
    expect(next.artifactPanelPath).toBeNull();
  });

  it("closeArtifactPanel returns same reference when already closed", () => {
    const state = makeUiState({ artifactPanelOpen: false, artifactPanelPath: null });
    expect(closeArtifactPanel(state)).toBe(state);
  });

  it("setDiscoveredArtifacts replaces the artifact list", () => {
    const state = makeUiState();
    const artifacts = [
      {
        path: "/repo/@Docs/@Scratch/repo/plan.md",
        title: "Plan",
        repo: "repo",
        relativePath: "@Docs/@Scratch/repo/plan.md",
      },
    ];
    const next = setDiscoveredArtifacts(state, artifacts);
    expect(next.artifactPanelArtifacts).toEqual(artifacts);
  });

  it("setDiscoveredArtifacts with empty array clears the list", () => {
    const state = makeUiState({
      artifactPanelArtifacts: [
        {
          path: "/repo/@Docs/@Scratch/repo/plan.md",
          title: "Plan",
          repo: "repo",
          relativePath: "@Docs/@Scratch/repo/plan.md",
        },
      ],
    });
    const next = setDiscoveredArtifacts(state, []);
    expect(next.artifactPanelArtifacts).toHaveLength(0);
  });
});

// ── Changes panel ───────────────────────────────────────────────────────────

describe("changes panel pure functions", () => {
  it("openChangesPanel sets open=true", () => {
    const state = makeUiState();
    const next = openChangesPanel(state);
    expect(next.changesPanelOpen).toBe(true);
    expect(next.changesPanelInitializedFromSettings).toBe(true);
    expect(next.changesPanelActivePath).toBeNull();
  });

  it("openChangesPanel sets open=true with a path", () => {
    const state = makeUiState();
    const next = openChangesPanel(state, "/repo/src/index.ts");
    expect(next.changesPanelOpen).toBe(true);
    expect(next.changesPanelInitializedFromSettings).toBe(true);
    expect(next.changesPanelActivePath).toBe("/repo/src/index.ts");
  });

  it("openChangesPanel returns same reference when already open at same path", () => {
    const state = makeUiState({
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/plan.md",
    });
    const next = openChangesPanel(state, "/repo/plan.md");
    expect(next).toBe(state);
  });

  it("openChangesPanel navigates to a different path", () => {
    const state = makeUiState({
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/old.md",
    });
    const next = openChangesPanel(state, "/repo/new.md");
    expect(next.changesPanelOpen).toBe(true);
    expect(next.changesPanelActivePath).toBe("/repo/new.md");
  });

  it("openChangesPanel preserves previous activePath when no path given", () => {
    const state = makeUiState({
      changesPanelOpen: false,
      changesPanelActivePath: "/repo/last.md",
      changesPanelContentMode: "diff",
    });
    const next = openChangesPanel(state);
    expect(next.changesPanelOpen).toBe(true);
    expect(next.changesPanelActivePath).toBe("/repo/last.md");
    expect(next.changesPanelContentMode).toBe("diff");
  });

  it("closeChangesPanel sets open=false but preserves activePath", () => {
    const state = makeUiState({
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/plan.md",
      changesPanelContentMode: "diff",
    });
    const next = closeChangesPanel(state);
    expect(next.changesPanelOpen).toBe(false);
    expect(next.changesPanelInitializedFromSettings).toBe(true);
    expect(next.changesPanelActivePath).toBe("/repo/plan.md");
    expect(next.changesPanelContentMode).toBe("diff");
  });

  it("closeChangesPanel returns same reference when already closed", () => {
    const state = makeUiState({ changesPanelOpen: false });
    expect(closeChangesPanel(state)).toBe(state);
  });

  it("toggleChangesPanel opens when closed", () => {
    const state = makeUiState({ changesPanelOpen: false });
    const next = toggleChangesPanel(state);
    expect(next.changesPanelOpen).toBe(true);
  });

  it("toggleChangesPanel closes when open", () => {
    const state = makeUiState({ changesPanelOpen: true });
    const next = toggleChangesPanel(state);
    expect(next.changesPanelOpen).toBe(false);
  });

  it("initializeChangesPanelFromSettings opens once when default is open", () => {
    const state = makeUiState();
    const next = initializeChangesPanelFromSettings(state, true);
    expect(next.changesPanelOpen).toBe(true);
    expect(next.changesPanelInitializedFromSettings).toBe(true);
  });

  it("initializeChangesPanelFromSettings closes once when default is closed", () => {
    const state = makeUiState({ changesPanelOpen: true });
    const next = initializeChangesPanelFromSettings(state, false);
    expect(next.changesPanelOpen).toBe(false);
    expect(next.changesPanelInitializedFromSettings).toBe(true);
  });

  it("initializeChangesPanelFromSettings does not overwrite an explicit user choice", () => {
    const state = makeUiState({
      changesPanelOpen: false,
      changesPanelInitializedFromSettings: true,
    });
    expect(initializeChangesPanelFromSettings(state, true)).toBe(state);
  });

  it("setChangesPanelActivePath updates the path", () => {
    const state = makeUiState();
    const next = setChangesPanelActivePath(state, "/repo/src/index.ts");
    expect(next.changesPanelActivePath).toBe("/repo/src/index.ts");
  });

  it("setChangesPanelActivePath returns same reference when path unchanged", () => {
    const state = makeUiState({ changesPanelActivePath: "/repo/foo.ts" });
    expect(setChangesPanelActivePath(state, "/repo/foo.ts")).toBe(state);
  });

  it("setChangesPanelActiveSection updates the section", () => {
    const state = makeUiState();
    const next = setChangesPanelActiveSection(state, "plans");
    expect(next.changesPanelActiveSection).toBe("plans");
  });

  it("setChangesPanelActiveSection returns same reference when section unchanged", () => {
    const state = makeUiState({ changesPanelActiveSection: "plans" });
    expect(setChangesPanelActiveSection(state, "plans")).toBe(state);
  });

  it("setChangesPanelActiveSection clears with null", () => {
    const state = makeUiState({ changesPanelActiveSection: "plans" });
    const next = setChangesPanelActiveSection(state, null);
    expect(next.changesPanelActiveSection).toBeNull();
  });

  it("setChangesPanelContentMode updates the mode", () => {
    const state = makeUiState();
    const next = setChangesPanelContentMode(state, "diff");
    expect(next.changesPanelContentMode).toBe("diff");
  });

  it("setChangesPanelContentMode returns same reference when mode unchanged", () => {
    const state = makeUiState({ changesPanelContentMode: "preview" });
    expect(setChangesPanelContentMode(state, "preview")).toBe(state);
  });
});

describe("IDE mode pure functions", () => {
  it("focusIdeExplorerSection opens the explorer and retracts other sections", () => {
    const next = focusIdeExplorerSection(
      makeUiState({
        ideExplorerOpen: false,
        ideExplorerExpandedSections: ["changes", "threads"],
      }),
      "explorer",
    );

    expect(next.ideExplorerOpen).toBe(true);
    expect(next.ideExplorerExpandedSections).toEqual(["explorer"]);
  });

  it("focusIdeExplorerSection toggles the explorer closed when the same section is already focused", () => {
    const next = focusIdeExplorerSection(
      makeUiState({
        ideExplorerOpen: true,
        ideExplorerExpandedSections: ["explorer"],
      }),
      "explorer",
    );

    expect(next.ideExplorerOpen).toBe(false);
    expect(next.ideExplorerExpandedSections).toEqual(["explorer"]);
  });

  it("setIdeSelectedFile resets markdown preview and diff mode", () => {
    const next = setIdeSelectedFile(
      makeUiState({
        ideMarkdownPreviewEnabled: true,
        ideDiffEnabled: true,
      }),
      {
        absolutePath: "/repo/README.md",
        relativePath: "README.md",
        displayPath: "README.md",
        fileName: "README.md",
        source: "explorer",
        section: "explorer",
        threadId: ThreadId.makeUnsafe("thread-1"),
        worktreePath: "/repo",
        sourcePath: "README.md",
        latestCheckpointTurnCount: 4,
      },
    );

    expect(next.ideSelectedFile?.absolutePath).toBe("/repo/README.md");
    expect(next.ideMarkdownPreviewEnabled).toBe(false);
    expect(next.ideDiffEnabled).toBe(false);
  });
});
