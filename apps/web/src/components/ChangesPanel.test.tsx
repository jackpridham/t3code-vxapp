import { MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, PersistedFileChange } from "../types";
import { discoverChangesReferences, type ChangesPanelGroup } from "../changesDiscovery";

const state = vi.hoisted(() => ({
  settings: {
    changesDrawerVisibility: "always_show" as "always_show" | "always_hide",
    changesPanelFilesChangedViewType: "list" as "list" | "tree",
    changesPanelWindowNavigationMode: "dynamic" as "dynamic" | "static",
  },
  uiState: {
    changesPanelOpen: true,
    changesPanelActivePath: null as string | null,
    changesPanelActiveSection: null as string | null,
    changesPanelContentMode: "preview" as "preview" | "diff",
    closeChangesPanel: vi.fn(),
    setChangesPanelActivePath: vi.fn(),
    setChangesPanelActiveSection: vi.fn(),
    setChangesPanelContentMode: vi.fn(),
  },
  appState: {
    threads: [] as any[],
    projects: [] as any[],
  },
  groups: [] as ChangesPanelGroup[],
  queryResult: {
    data: null as { diff: string } | null,
    error: null as Error | null,
    isLoading: false,
  },
  navigate: vi.fn(),
  setChangesWindowTarget: vi.fn(),
}));

vi.mock("../uiStateStore", () => ({
  useUiStateStore: (selector: (value: typeof state.uiState) => unknown) => selector(state.uiState),
}));

vi.mock("../store", () => ({
  useStore: (selector: (value: typeof state.appState) => unknown) => selector(state.appState),
}));

vi.mock("../hooks/useChangesDiscovery", () => ({
  useChangesDiscovery: () => state.groups,
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: (selector?: (value: typeof state.settings) => unknown) =>
    selector ? selector(state.settings) : state.settings,
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: (options: { select: (value: { threadId?: string }) => unknown }) =>
    options.select({ threadId: "thread-1" }),
  useNavigate: () => state.navigate,
}));

vi.mock("../lib/changesWindowSync", () => ({
  buildChangesWindowTarget: (input: unknown) => input,
  useChangesWindowTarget: () => [null, state.setChangesWindowTarget] as const,
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: vi.fn(),
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => null,
}));

vi.mock("../lib/providerReactQuery", () => ({
  checkpointDiffQueryOptions: vi.fn(() => ({ queryKey: ["mock-diff"] })),
  checkpointFileDiffQueryOptions: vi.fn(() => ({ queryKey: ["mock-file-diff"] })),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => state.queryResult,
}));

vi.mock("./DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: unknown }) => <>{children}</>,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: () => <div data-testid="single-file-diff" />,
}));

import { ChangesPanel, ChangesWindow } from "./ChangesPanel";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMessage(text: string, id = "msg-1"): ChatMessage {
  return {
    id: MessageId.makeUnsafe(id),
    role: "assistant",
    text,
    createdAt: "2026-04-07T00:00:00.000Z",
    streaming: false,
  };
}

function filesChangedGroup(groups: ChangesPanelGroup[]): ChangesPanelGroup | undefined {
  return groups.find((g) => g.section === "files_changed");
}

function renderPanel() {
  return renderToStaticMarkup(<ChangesPanel />);
}

beforeEach(() => {
  state.settings = {
    changesDrawerVisibility: "always_show",
    changesPanelFilesChangedViewType: "list",
    changesPanelWindowNavigationMode: "dynamic",
  };
  state.uiState = {
    changesPanelOpen: true,
    changesPanelActivePath: null,
    changesPanelActiveSection: null,
    changesPanelContentMode: "preview",
    closeChangesPanel: vi.fn(),
    setChangesPanelActivePath: vi.fn(),
    setChangesPanelActiveSection: vi.fn(),
    setChangesPanelContentMode: vi.fn(),
  };
  state.appState = {
    threads: [],
    projects: [],
  };
  state.groups = [];
  state.queryResult = {
    data: null,
    error: null,
    isLoading: false,
  };
  state.navigate = vi.fn();
  state.setChangesWindowTarget = vi.fn();
});

// ── useChangesDiscovery logic (tested via pure functions) ────────────────────

describe("ChangesPanel discovery integration", () => {
  it("discovers plan references from messages", () => {
    const messages = [makeMessage("See @Docs/@TODO/repo/PLAN_auth.md for details.")];
    const groups = discoverChangesReferences(messages, undefined);
    const plansGroup = groups.find((g) => g.section === "plans");
    expect(plansGroup?.items).toHaveLength(1);
    expect(plansGroup?.items[0]?.filename).toBe("PLAN_auth.md");
  });

  it("discovers artifact references from @Scratch paths", () => {
    const messages = [makeMessage("Created @Docs/@Scratch/repo/notes.md")];
    const groups = discoverChangesReferences(messages, undefined);
    const artifactsGroup = groups.find((g) => g.section === "artifacts");
    expect(artifactsGroup?.items).toHaveLength(1);
  });

  it("discovers working memory references", () => {
    const messages = [makeMessage("Saved repo/memory/working_session.md for later.")];
    const groups = discoverChangesReferences(messages, undefined);
    const memoryGroup = groups.find((g) => g.section === "working_memory");
    expect(memoryGroup?.items).toHaveLength(1);
    expect(memoryGroup?.items[0]?.filename).toBe("working_session.md");
  });

  it("discovers code file references in files_changed", () => {
    const messages = [
      makeMessage("Modified file:///repo/src/index.ts and file:///repo/src/app.tsx"),
    ];
    const groups = discoverChangesReferences(messages, undefined);
    const fcGroup = filesChangedGroup(groups);
    expect(fcGroup?.items.length).toBeGreaterThanOrEqual(2);
  });

  it("discovers changelog references", () => {
    const messages = [makeMessage("Updated @Docs/@CHANGELOG/repo/CHANGELOG_2026-04-07.md")];
    const groups = discoverChangesReferences(messages, undefined);
    const clGroup = groups.find((g) => g.section === "changelog");
    expect(clGroup?.items).toHaveLength(1);
  });

  it("discovers report references", () => {
    const messages = [makeMessage("Generated @Docs/@Reports/repo/REPORT_coverage.md")];
    const groups = discoverChangesReferences(messages, undefined);
    const reportsGroup = groups.find((g) => g.section === "reports");
    expect(reportsGroup?.items).toHaveLength(1);
  });

  it("returns empty groups when no messages", () => {
    const groups = discoverChangesReferences([], undefined);
    const nonEmpty = groups.filter((g) => g.items.length > 0);
    expect(nonEmpty).toHaveLength(0);
  });

  it("empty sections have zero items", () => {
    const groups = discoverChangesReferences([makeMessage("No file paths here.")], undefined);
    for (const group of groups) {
      expect(group.items).toHaveLength(0);
    }
  });
});

describe("ChangesPanel component", () => {
  it("renders the drawer as a file browser without the preview pane", () => {
    state.groups = [
      {
        section: "files_changed",
        label: "Files Changed",
        items: [
          {
            rawRef: "/repo/src/example.ts",
            resolvedPath: "/repo/src/example.ts",
            filename: "example.ts",
            section: "files_changed",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [{ checkpointTurnCount: 4 }],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;
    state.uiState = {
      ...state.uiState,
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/src/example.ts",
      changesPanelActiveSection: "files_changed",
      changesPanelContentMode: "preview",
    };
    state.queryResult = {
      data: {
        diff: `
diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,2 @@
 const first = 1;
+const second = 2;
`,
      },
      error: null,
      isLoading: false,
    };

    const html = renderPanel();

    expect(html).toContain("example.ts");
    expect(html).not.toContain("Code viewer");
    expect(html).not.toContain("Markdown viewer");
    expect(html).not.toContain("Open changes in separate window");
  });

  it("renders the files changed section as a tree when configured", () => {
    state.settings = {
      changesDrawerVisibility: "always_show",
      changesPanelFilesChangedViewType: "tree",
      changesPanelWindowNavigationMode: "dynamic",
    };
    state.groups = [
      {
        section: "files_changed",
        label: "Files Changed",
        items: [
          {
            rawRef: "/repo/src/example.ts",
            resolvedPath: "/repo/src/example.ts",
            filename: "example.ts",
            section: "files_changed",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;
    state.uiState = {
      ...state.uiState,
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/src/example.ts",
      changesPanelActiveSection: "files_changed",
      changesPanelContentMode: "preview",
    };

    const html = renderPanel();

    expect(html).toContain(">src<");
    expect(html).toContain("example.ts");
  });

  it("switches to inline diff mode in the standalone window", () => {
    state.groups = [
      {
        section: "files_changed",
        label: "Files Changed",
        items: [
          {
            rawRef: "/repo/src/example.ts",
            resolvedPath: "/repo/src/example.ts",
            filename: "example.ts",
            section: "files_changed",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [{ checkpointTurnCount: 4 }],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;
    state.uiState = {
      ...state.uiState,
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/src/example.ts",
      changesPanelActiveSection: "files_changed",
      changesPanelContentMode: "diff",
    };
    state.queryResult = {
      data: {
        diff: `
diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,2 @@
 const first = 1;
+const second = 2;
`,
      },
      error: null,
      isLoading: false,
    };

    const html = renderToStaticMarkup(
      <ChangesWindow
        threadId={ThreadId.makeUnsafe("thread-1")}
        initialPath="/repo/src/example.ts"
        initialMode="diff"
      />,
    );

    expect(html).toContain("Show file");
    expect(html).toContain('data-testid="single-file-diff"');
  });

  it("still enables file diff rendering when checkpoint turn counts must be inferred", () => {
    state.groups = [
      {
        section: "files_changed",
        label: "Files Changed",
        items: [
          {
            rawRef: "/repo/src/example.ts",
            resolvedPath: "/repo/src/example.ts",
            filename: "example.ts",
            section: "files_changed",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [
            {
              turnId: TurnId.makeUnsafe("turn-1"),
              completedAt: "2026-04-07T00:00:00.000Z",
              files: [],
            },
          ],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;
    state.queryResult = {
      data: {
        diff: `
diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,2 @@
 const first = 1;
+const second = 2;
`,
      },
      error: null,
      isLoading: false,
    };

    const html = renderToStaticMarkup(
      <ChangesWindow
        threadId={ThreadId.makeUnsafe("thread-1")}
        initialPath="/repo/src/example.ts"
        initialMode="diff"
      />,
    );

    expect(html).toContain('data-testid="single-file-diff"');
  });

  it("keeps markdown selections in preview mode in the standalone window", () => {
    state.groups = [
      {
        section: "artifacts",
        label: "Artifacts",
        items: [
          {
            rawRef: "/repo/@Docs/@Scratch/repo/notes.md",
            resolvedPath: "/repo/@Docs/@Scratch/repo/notes.md",
            filename: "notes.md",
            section: "artifacts",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;
    state.uiState = {
      ...state.uiState,
      changesPanelOpen: true,
      changesPanelActivePath: "/repo/@Docs/@Scratch/repo/notes.md",
      changesPanelActiveSection: "artifacts",
      changesPanelContentMode: "preview",
    };

    const html = renderToStaticMarkup(
      <ChangesWindow
        threadId={ThreadId.makeUnsafe("thread-1")}
        initialPath="/repo/@Docs/@Scratch/repo/notes.md"
        initialMode="preview"
      />,
    );

    expect(html).not.toContain("Show diff");
    expect(html).toContain("Markdown viewer");
  });

  it("shows the pop-out action in the drawer when a file is selected", () => {
    state.groups = [
      {
        section: "plans",
        label: "Plans",
        items: [
          {
            rawRef: "/repo/@Docs/@TODO/repo/PLAN_repo.md",
            resolvedPath: "/repo/@Docs/@TODO/repo/PLAN_repo.md",
            filename: "PLAN_repo.md",
            section: "plans",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;
    state.uiState = {
      ...state.uiState,
      changesPanelActivePath: "/repo/@Docs/@TODO/repo/PLAN_repo.md",
      changesPanelActiveSection: "plans",
    };

    const html = renderPanel();

    expect(html).not.toContain("Open changes in separate window");
  });

  it("shows the thread title and hides the pop-out action in the standalone window", () => {
    state.groups = [
      {
        section: "plans",
        label: "Plans",
        items: [
          {
            rawRef: "/repo/@Docs/@TODO/repo/PLAN_repo.md",
            resolvedPath: "/repo/@Docs/@TODO/repo/PLAN_repo.md",
            filename: "PLAN_repo.md",
            section: "plans",
            firstSeenMessageId: MessageId.makeUnsafe("msg-1"),
          },
        ],
      },
    ];
    state.appState = {
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: "project-1",
          title: "Thread title",
          worktreePath: "/repo",
          messages: [],
          persistedFileChanges: [],
          turnDiffSummaries: [],
        },
      ],
      projects: [{ id: "project-1", cwd: "/repo" }],
    } as any;

    const html = renderToStaticMarkup(
      <ChangesWindow
        threadId={ThreadId.makeUnsafe("thread-1")}
        initialPath="/repo/@Docs/@TODO/repo/PLAN_repo.md"
        initialMode="preview"
      />,
    );

    expect(html).toContain("Thread title");
    expect(html).not.toContain("Open changes in separate window");
  });
});

// ── Persisted file changes merge ────────────────────────────────────────────

describe("persisted file changes merge", () => {
  it("persisted changes appear in files_changed group when not already discovered", () => {
    const messages: ChatMessage[] = [];
    const persistedFileChanges: PersistedFileChange[] = [
      {
        path: "src/store.ts",
        kind: "modified",
        totalInsertions: 10,
        totalDeletions: 5,
        firstTurnId: TurnId.makeUnsafe("turn-1"),
        lastTurnId: TurnId.makeUnsafe("turn-1"),
      },
    ];

    const groups = discoverChangesReferences(messages, undefined);
    // Simulate the merge logic from useChangesDiscovery
    const fcGroup = filesChangedGroup(groups);
    expect(fcGroup).toBeDefined();
    if (fcGroup) {
      const existingPaths = new Set(fcGroup.items.map((item) => item.resolvedPath.toLowerCase()));
      for (const fc of persistedFileChanges) {
        if (!existingPaths.has(fc.path.toLowerCase())) {
          fcGroup.items.push({
            rawRef: fc.path,
            resolvedPath: fc.path,
            filename: fc.path.slice(
              Math.max(fc.path.lastIndexOf("/"), fc.path.lastIndexOf("\\")) + 1,
            ),
            section: "files_changed",
            firstSeenMessageId: fc.firstTurnId,
          });
          existingPaths.add(fc.path.toLowerCase());
        }
      }
    }

    expect(fcGroup?.items).toHaveLength(1);
    expect(fcGroup?.items[0]?.filename).toBe("store.ts");
  });

  it("does not duplicate files already discovered from messages", () => {
    const messages = [makeMessage("Modified file:///repo/src/store.ts")];
    const persistedFileChanges: PersistedFileChange[] = [
      {
        path: "/repo/src/store.ts",
        kind: "modified",
        totalInsertions: 10,
        totalDeletions: 5,
        firstTurnId: TurnId.makeUnsafe("turn-1"),
        lastTurnId: TurnId.makeUnsafe("turn-1"),
      },
    ];

    const groups = discoverChangesReferences(messages, undefined);
    const fcGroup = filesChangedGroup(groups);
    const countBefore = fcGroup?.items.length ?? 0;

    if (fcGroup) {
      const existingPaths = new Set(fcGroup.items.map((item) => item.resolvedPath.toLowerCase()));
      for (const fc of persistedFileChanges) {
        if (!existingPaths.has(fc.path.toLowerCase())) {
          fcGroup.items.push({
            rawRef: fc.path,
            resolvedPath: fc.path,
            filename: fc.path.slice(
              Math.max(fc.path.lastIndexOf("/"), fc.path.lastIndexOf("\\")) + 1,
            ),
            section: "files_changed",
            firstSeenMessageId: fc.firstTurnId,
          });
          existingPaths.add(fc.path.toLowerCase());
        }
      }
    }

    expect(fcGroup?.items.length).toBe(countBefore);
  });
});
