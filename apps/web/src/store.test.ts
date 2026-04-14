import {
  CheckpointRef,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("./notificationDispatch", () => ({
  dispatchNotification: vi.fn(),
}));

import {
  accumulateFileChanges,
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  syncServerReadModel,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    labels: [],
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    persistedFileChanges: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

type ReadModelThreadWithLabels = OrchestrationReadModel["threads"][number] & {
  labels?: readonly string[] | undefined;
};

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        hooks: [],
      },
    ],
    threads: [thread],
    orchestratorWakeItems: [],
    bootstrapComplete: true,
  };
}

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId:
      "threadId" in payload
        ? payload.threadId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.makeUnsafe("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

function makeReadModelThread(overrides: Partial<ReadModelThreadWithLabels> = {}) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    labels: [],
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies ReadModelThreadWithLabels;
}

function makeReadModel(
  thread: OrchestrationReadModel["threads"][number],
  overrides: Partial<OrchestrationReadModel> = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
        },
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
        hooks: [],
      },
    ],
    threads: [thread],
    orchestratorWakeItems: [],
    ...overrides,
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    hooks: [],
    ...overrides,
  };
}

describe("store read model sync", () => {
  it("marks bootstrap complete after snapshot sync", () => {
    const initialState: AppState = {
      ...makeState(makeThread()),
      bootstrapComplete: false,
    };

    const next = syncServerReadModel(initialState, makeReadModel(makeReadModelThread({})));

    expect(next.bootstrapComplete).toBe(true);
  });

  it("keeps omitted sidebar parent metadata undefined after bootstrap summary sync", () => {
    const next = syncServerReadModel(
      makeState(makeThread()),
      makeReadModel(makeReadModelThread({}), {
        snapshotProfile: "bootstrap-summary",
        projects: [
          makeReadModelProject({
            id: ProjectId.makeUnsafe("project-parent"),
            title: "Parent Project",
            workspaceRoot: "/repos/project-parent",
          }),
          makeReadModelProject({
            id: ProjectId.makeUnsafe("project-worktree"),
            title: "Parent Project Feature",
            workspaceRoot: "/repos/project-parent/.worktrees/feature",
          }),
        ],
      }),
    );

    const parentProject = next.projects.find((project) => project.id === "project-parent");
    const worktreeProject = next.projects.find((project) => project.id === "project-worktree");

    expect(parentProject).toEqual(expect.not.objectContaining({ sidebarParentProjectId: null }));
    expect(parentProject?.sidebarParentProjectId).toBeUndefined();
    expect(worktreeProject).toEqual(expect.not.objectContaining({ sidebarParentProjectId: null }));
    expect(worktreeProject?.sidebarParentProjectId).toBeUndefined();
  });

  it("preserves explicit sidebar parent metadata from bootstrap summary sync", () => {
    const next = syncServerReadModel(
      makeState(makeThread()),
      makeReadModel(makeReadModelThread({}), {
        snapshotProfile: "bootstrap-summary",
        projects: [
          makeReadModelProject({
            id: ProjectId.makeUnsafe("project-parent"),
            title: "Parent Project",
            workspaceRoot: "/repos/project-parent",
          }),
          makeReadModelProject({
            id: ProjectId.makeUnsafe("project-worktree"),
            title: "Parent Project Feature",
            workspaceRoot: "/repos/project-parent/.worktrees/feature",
            sidebarParentProjectId: ProjectId.makeUnsafe("project-parent"),
          }),
        ],
      }),
    );

    expect(next.projects.find((project) => project.id === "project-worktree")).toEqual(
      expect.objectContaining({ sidebarParentProjectId: "project-parent" }),
    );
  });

  it("merges bootstrap summary payloads without dropping unrelated hydrated threads", () => {
    const initialState: AppState = {
      ...makeState(makeThread()),
      threads: [
        makeThread({
          messages: [
            {
              id: MessageId.makeUnsafe("message-preserved"),
              role: "assistant",
              text: "preserved",
              turnId: null,
              streaming: false,
              createdAt: "2026-02-27T00:00:00.000Z",
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          projectId: ProjectId.makeUnsafe("project-2"),
          title: "Other thread",
        }),
      ],
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [],
          hooks: [],
        },
        {
          id: ProjectId.makeUnsafe("project-2"),
          name: "Other project",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [],
          hooks: [],
        },
      ],
    };

    const next = syncServerReadModel(
      initialState,
      makeReadModel(makeReadModelThread({ title: "Updated summary thread" }), {
        snapshotProfile: "bootstrap-summary",
      }),
    );

    expect(next.threads).toHaveLength(2);
    expect(next.projects).toHaveLength(2);
    expect(next.threads.find((thread) => thread.id === "thread-1")?.title).toBe(
      "Updated summary thread",
    );
    expect(next.threads.find((thread) => thread.id === "thread-1")?.messages).toEqual(
      initialState.threads[0]?.messages,
    );
    expect(next.threads.find((thread) => thread.id === "thread-2")?.title).toBe("Other thread");
  });

  it("merges active-thread snapshots into the existing store", () => {
    const initialState: AppState = {
      ...makeState(makeThread()),
      threads: [
        makeThread(),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          projectId: ProjectId.makeUnsafe("project-2"),
          title: "Other thread",
        }),
      ],
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [],
          hooks: [],
        },
        {
          id: ProjectId.makeUnsafe("project-2"),
          name: "Other project",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          scripts: [],
          hooks: [],
        },
      ],
    };

    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-1"),
          messages: [
            {
              id: MessageId.makeUnsafe("message-1"),
              role: "assistant",
              text: "hydrated",
              turnId: null,
              streaming: false,
              createdAt: "2026-02-27T00:00:00.000Z",
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          ],
          snapshotCoverage: {
            messageCount: 1,
            messageLimit: 500,
            messagesTruncated: false,
            proposedPlanCount: 0,
            proposedPlanLimit: 100,
            proposedPlansTruncated: false,
            activityCount: 0,
            activityLimit: 250,
            activitiesTruncated: false,
            checkpointCount: 0,
            checkpointLimit: 100,
            checkpointsTruncated: false,
          },
        }),
        {
          snapshotProfile: "active-thread",
        },
      ),
    );

    expect(next.threads).toHaveLength(2);
    expect(next.threads.find((thread) => thread.id === "thread-1")?.messages).toHaveLength(1);
    expect(next.threads.find((thread) => thread.id === "thread-2")?.title).toBe("Other thread");
  });

  it("applies bounded thread detail carried by a bootstrap-summary read model", () => {
    const initialState: AppState = {
      ...makeState(
        makeThread({
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-1"),
            state: "completed",
            requestedAt: "2026-02-27T00:00:00.000Z",
            startedAt: "2026-02-27T00:00:01.000Z",
            completedAt: "2026-02-27T00:00:02.000Z",
            assistantMessageId: null,
          },
        }),
      ),
    };

    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          messages: [
            {
              id: MessageId.makeUnsafe("message-hydrated"),
              role: "assistant",
              text: "hydrated history",
              turnId: TurnId.makeUnsafe("turn-1"),
              streaming: false,
              createdAt: "2026-02-27T00:00:02.000Z",
              updatedAt: "2026-02-27T00:00:02.000Z",
            },
          ],
          activities: [
            {
              id: EventId.makeUnsafe("activity-hydrated"),
              tone: "info",
              kind: "turn.completed",
              summary: "completed",
              payload: {},
              turnId: TurnId.makeUnsafe("turn-1"),
              createdAt: "2026-02-27T00:00:02.000Z",
            },
          ],
          snapshotCoverage: {
            messageCount: 1,
            messageLimit: 500,
            messagesTruncated: false,
            proposedPlanCount: 0,
            proposedPlanLimit: 0,
            proposedPlansTruncated: false,
            activityCount: 1,
            activityLimit: 250,
            activitiesTruncated: false,
            checkpointCount: 0,
            checkpointLimit: 0,
            checkpointsTruncated: false,
          },
        }),
        {
          snapshotProfile: "bootstrap-summary",
        },
      ),
    );

    const thread = next.threads.find((entry) => entry.id === "thread-1");
    expect(thread?.messages).toEqual([expect.objectContaining({ text: "hydrated history" })]);
    expect(thread?.activities).toEqual([expect.objectContaining({ summary: "completed" })]);
    expect(thread?.snapshotCoverage).toEqual(
      expect.objectContaining({
        messageCount: 1,
        messageLimit: 500,
        activityCount: 1,
        activityLimit: 250,
      }),
    );
  });

  it("preserves detail groups omitted from bounded current-state hydration", () => {
    const initialState: AppState = {
      ...makeState(
        makeThread({
          proposedPlans: [
            {
              id: "plan-existing",
              turnId: TurnId.makeUnsafe("turn-existing"),
              planMarkdown: "keep me",
              implementedAt: null,
              implementationThreadId: null,
              createdAt: "2026-02-27T00:00:00.000Z",
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
          ],
          turnDiffSummaries: [
            {
              turnId: TurnId.makeUnsafe("turn-existing"),
              completedAt: "2026-02-27T00:00:01.000Z",
              status: "ready",
              checkpointTurnCount: 1,
              checkpointRef: CheckpointRef.makeUnsafe("checkpoint-existing"),
              files: [{ path: "src/existing.ts", additions: 2, deletions: 0, kind: "modified" }],
            },
          ],
          persistedFileChanges: [
            {
              path: "src/existing.ts",
              kind: "modified",
              totalInsertions: 2,
              totalDeletions: 0,
              firstTurnId: TurnId.makeUnsafe("turn-existing"),
              lastTurnId: TurnId.makeUnsafe("turn-existing"),
            },
          ],
        }),
      ),
    };

    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          messages: [
            {
              id: MessageId.makeUnsafe("message-new"),
              role: "assistant",
              text: "new bounded detail",
              turnId: null,
              streaming: false,
              createdAt: "2026-02-27T00:00:02.000Z",
              updatedAt: "2026-02-27T00:00:02.000Z",
            },
          ],
          proposedPlans: [],
          checkpoints: [],
          snapshotCoverage: {
            messageCount: 1,
            messageLimit: 500,
            messagesTruncated: false,
            proposedPlanCount: 1,
            proposedPlanLimit: 0,
            proposedPlansTruncated: false,
            activityCount: 0,
            activityLimit: 250,
            activitiesTruncated: false,
            checkpointCount: 1,
            checkpointLimit: 0,
            checkpointsTruncated: false,
          },
        }),
        {
          snapshotProfile: "bootstrap-summary",
        },
      ),
    );

    const thread = next.threads.find((entry) => entry.id === "thread-1");
    expect(thread?.messages).toEqual([expect.objectContaining({ text: "new bounded detail" })]);
    expect(thread?.proposedPlans).toEqual([
      expect.objectContaining({ id: "plan-existing", planMarkdown: "keep me" }),
    ]);
    expect(thread?.turnDiffSummaries).toEqual([
      expect.objectContaining({ checkpointRef: "checkpoint-existing" }),
    ]);
    expect(thread?.persistedFileChanges).toEqual([
      expect.objectContaining({ path: "src/existing.ts" }),
    ]);
  });

  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-opus-4-6");
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          model: "sonnet",
        },
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-sonnet-4-6");
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });

  it("maps thread labels from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        labels: ["alpha", "beta"],
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.labels).toEqual(["alpha", "beta"]);
  });

  it("maps project kind from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = {
      ...makeReadModel(makeReadModelThread({})),
      projects: [makeReadModelProject({ kind: "orchestrator" })],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.kind).toBe("orchestrator");
  });

  it("maps archivedAt from the read model", () => {
    const initialState = makeState(makeThread());
    const archivedAt = "2026-02-28T00:00:00.000Z";
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          archivedAt,
        }),
      ),
    );

    expect(next.threads[0]?.archivedAt).toBe(archivedAt);
  });

  it("maps snapshot coverage from bounded thread payloads", () => {
    const initialState = makeState(makeThread());
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          snapshotCoverage: {
            messageCount: 240,
            messageLimit: 200,
            messagesTruncated: true,
            proposedPlanCount: 10,
            proposedPlanLimit: 50,
            proposedPlansTruncated: false,
            activityCount: 120,
            activityLimit: 100,
            activitiesTruncated: true,
            checkpointCount: 3,
            checkpointLimit: 50,
            checkpointsTruncated: false,
          },
        }),
      ),
    );

    expect(next.threads[0]?.snapshotCoverage).toEqual({
      messageCount: 240,
      messageLimit: 200,
      messagesTruncated: true,
      proposedPlanCount: 10,
      proposedPlanLimit: 50,
      proposedPlansTruncated: false,
      activityCount: 120,
      activityLimit: 100,
      activitiesTruncated: true,
      checkpointCount: 3,
      checkpointLimit: 50,
      checkpointsTruncated: false,
    });
  });

  it("maps thread labels from the read model", () => {
    const initialState = makeState(makeThread());
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          labels: ["orchestrator", "jasper"],
        }),
      ),
    );

    expect(next.threads[0]?.labels).toEqual(["orchestrator", "jasper"]);
  });

  it("excludes deleted threads during full snapshot sync", () => {
    const initialState: AppState = {
      ...makeState(
        makeThread({
          id: ThreadId.makeUnsafe("worker-deleted"),
          title: "Stale deleted worker",
        }),
      ),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("worker-deleted"),
          title: "Stale deleted worker",
        }),
      ],
    };

    const next = syncServerReadModel(
      initialState,
      makeReadModel(makeReadModelThread({ id: ThreadId.makeUnsafe("thread-active") }), {
        threads: [
          makeReadModelThread({
            id: ThreadId.makeUnsafe("thread-active"),
            title: "Active thread",
          }),
          makeReadModelThread({
            id: ThreadId.makeUnsafe("worker-deleted"),
            title: "Deleted worker",
            deletedAt: "2026-02-27T00:00:01.000Z",
          }),
        ],
      }),
    );

    expect(next.threads.map((thread) => thread.id)).toEqual(["thread-active"]);
    expect(next.threads.some((thread) => thread.id === "worker-deleted")).toBe(false);
  });

  it("removes existing threads when partial read-model payload marks them deleted", () => {
    const initialState: AppState = {
      ...makeState(
        makeThread({
          id: ThreadId.makeUnsafe("thread-keep"),
          title: "Keep thread",
        }),
      ),
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-keep"),
          title: "Keep thread",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("worker-deleted"),
          title: "Stale deleted worker",
        }),
      ],
    };

    const next = syncServerReadModel(
      initialState,
      makeReadModel(makeReadModelThread({ id: ThreadId.makeUnsafe("worker-deleted") }), {
        snapshotProfile: "active-thread",
        threads: [
          makeReadModelThread({
            id: ThreadId.makeUnsafe("worker-deleted"),
            spawnRole: "worker",
            deletedAt: "2026-02-27T00:00:01.000Z",
          }),
        ],
      }),
    );

    expect(next.threads.map((thread) => thread.id)).toEqual(["thread-keep"]);
    expect(next.threads.some((thread) => thread.id === "worker-deleted")).toBe(false);
  });

  it("replaces projects using snapshot order during recovery", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          scripts: [],
          hooks: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          scripts: [],
          hooks: [],
        },
      ],
      threads: [],
      orchestratorWakeItems: [],
      bootstrapComplete: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      orchestratorWakeItems: [],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project1, project2, project3]);
  });
});

describe("lineage metadata mapping", () => {
  it("maps all 6 lineage fields from OrchestrationThread to Thread via syncServerReadModel", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        orchestratorProjectId: ProjectId.makeUnsafe("proj-orchestrator"),
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orchestrator"),
        parentThreadId: ThreadId.makeUnsafe("thread-parent"),
        spawnRole: "worker",
        spawnedBy: "jasper",
        workflowId: "wf-2026-04-03",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.orchestratorProjectId).toBe("proj-orchestrator");
    expect(next.threads[0]?.orchestratorThreadId).toBe("thread-orchestrator");
    expect(next.threads[0]?.parentThreadId).toBe("thread-parent");
    expect(next.threads[0]?.spawnRole).toBe("worker");
    expect(next.threads[0]?.spawnedBy).toBe("jasper");
    expect(next.threads[0]?.workflowId).toBe("wf-2026-04-03");
  });

  it("maps thread with no lineage fields as undefined", () => {
    const initialState = makeState(makeThread());
    const next = syncServerReadModel(initialState, makeReadModel(makeReadModelThread({})));

    expect(next.threads[0]?.orchestratorProjectId).toBeUndefined();
    expect(next.threads[0]?.orchestratorThreadId).toBeUndefined();
    expect(next.threads[0]?.parentThreadId).toBeUndefined();
    expect(next.threads[0]?.spawnRole).toBeUndefined();
    expect(next.threads[0]?.spawnedBy).toBeUndefined();
    expect(next.threads[0]?.workflowId).toBeUndefined();
  });

  it("maps partial lineage — only provided fields are set, rest are undefined", () => {
    const initialState = makeState(makeThread());
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          spawnRole: "supervisor",
          parentThreadId: ThreadId.makeUnsafe("thread-parent"),
        }),
      ),
    );

    expect(next.threads[0]?.spawnRole).toBe("supervisor");
    expect(next.threads[0]?.parentThreadId).toBe("thread-parent");
    expect(next.threads[0]?.orchestratorProjectId).toBeUndefined();
    expect(next.threads[0]?.orchestratorThreadId).toBeUndefined();
    expect(next.threads[0]?.spawnedBy).toBeUndefined();
    expect(next.threads[0]?.workflowId).toBeUndefined();
  });

  it("thread.meta-updated preserves existing lineage when event omits lineage fields", () => {
    const thread = makeThread({
      orchestratorProjectId: "proj-orch",
      orchestratorThreadId: "thread-orch",
      parentThreadId: "thread-parent",
      spawnRole: "worker",
      spawnedBy: "jasper",
      workflowId: "wf-abc",
    });

    const next = applyOrchestrationEvent(
      makeState(thread),
      makeEvent("thread.meta-updated", {
        threadId: thread.id,
        title: "New Title",
        updatedAt: "2026-04-03T00:00:01.000Z",
      }),
    );

    expect(next.threads[0]?.orchestratorProjectId).toBe("proj-orch");
    expect(next.threads[0]?.orchestratorThreadId).toBe("thread-orch");
    expect(next.threads[0]?.parentThreadId).toBe("thread-parent");
    expect(next.threads[0]?.spawnRole).toBe("worker");
    expect(next.threads[0]?.spawnedBy).toBe("jasper");
    expect(next.threads[0]?.workflowId).toBe("wf-abc");
  });

  it("thread.meta-updated can set lineage fields on a thread that had none", () => {
    const thread = makeThread({});

    const next = applyOrchestrationEvent(
      makeState(thread),
      makeEvent("thread.meta-updated", {
        threadId: thread.id,
        spawnRole: "worker",
        updatedAt: "2026-04-03T00:00:01.000Z",
      }),
    );

    expect(next.threads[0]?.spawnRole).toBe("worker");
    expect(next.threads[0]?.orchestratorProjectId).toBeUndefined();
  });

  it("thread.created maps lineage fields immediately for live-created workers", () => {
    const next = applyOrchestrationEvent(
      makeState(makeThread()),
      makeEvent("thread.created", {
        threadId: ThreadId.makeUnsafe("thread-worker"),
        projectId: ProjectId.makeUnsafe("project-worker"),
        title: "Worker thread",
        labels: ["worker", "model:gpt-5.4"],
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: "feature/worker",
        worktreePath: "/tmp/project-worker",
        orchestratorProjectId: ProjectId.makeUnsafe("project-orchestrator"),
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orchestrator"),
        parentThreadId: ThreadId.makeUnsafe("thread-parent"),
        spawnRole: "worker",
        spawnedBy: "thread-orchestrator",
        workflowId: "wf-2026-04-10",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    );

    const createdThread = next.threads.find((thread) => thread.id === "thread-worker");

    expect(createdThread?.orchestratorProjectId).toBe("project-orchestrator");
    expect(createdThread?.orchestratorThreadId).toBe("thread-orchestrator");
    expect(createdThread?.parentThreadId).toBe("thread-parent");
    expect(createdThread?.spawnRole).toBe("worker");
    expect(createdThread?.spawnedBy).toBe("thread-orchestrator");
    expect(createdThread?.workflowId).toBe("wf-2026-04-10");
  });
});

describe("incremental orchestration updates", () => {
  it("does not mark bootstrap complete for incremental events", () => {
    const state: AppState = {
      ...makeState(makeThread()),
      bootstrapComplete: false,
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.meta-updated", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "Updated title",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.bootstrapComplete).toBe(false);
  });

  it("preserves state identity for no-op project and thread deletes", () => {
    const thread = makeThread();
    const state = makeState(thread);

    const nextAfterProjectDelete = applyOrchestrationEvent(
      state,
      makeEvent("project.deleted", {
        projectId: ProjectId.makeUnsafe("project-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
    );
    const nextAfterThreadDelete = applyOrchestrationEvent(
      state,
      makeEvent("thread.deleted", {
        threadId: ThreadId.makeUnsafe("thread-missing"),
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(nextAfterProjectDelete).toBe(state);
    expect(nextAfterThreadDelete).toBe(state);
  });

  it("reuses an existing project row when project.created arrives with a new id for the same cwd", () => {
    const originalProjectId = ProjectId.makeUnsafe("project-1");
    const recreatedProjectId = ProjectId.makeUnsafe("project-2");
    const state: AppState = {
      projects: [
        {
          id: originalProjectId,
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          scripts: [],
          hooks: [],
        },
      ],
      threads: [],
      orchestratorWakeItems: [],
      bootstrapComplete: true,
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("project.created", {
        projectId: recreatedProjectId,
        title: "Project Recreated",
        workspaceRoot: "/tmp/project",
        kind: "orchestrator",
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        scripts: [],
        hooks: [],
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.id).toBe(recreatedProjectId);
    expect(next.projects[0]?.cwd).toBe("/tmp/project");
    expect(next.projects[0]?.name).toBe("Project Recreated");
    expect(next.projects[0]?.kind).toBe("orchestrator");
  });

  it("updates project kind when project.meta-updated arrives", () => {
    const state: AppState = {
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          scripts: [],
          hooks: [],
        },
      ],
      threads: [],
      orchestratorWakeItems: [],
      bootstrapComplete: true,
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("project.meta-updated", {
        projectId: ProjectId.makeUnsafe("project-1"),
        kind: "orchestrator",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.projects[0]?.kind).toBe("orchestrator");
  });

  it("updates thread labels when thread.meta-updated arrives", () => {
    const next = applyOrchestrationEvent(
      makeState(makeThread()),
      makeEvent("thread.meta-updated", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        labels: ["worker", "codex"],
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.threads[0]?.labels).toEqual(["worker", "codex"]);
  });

  it("updates only the affected thread for message events", () => {
    const thread1 = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      messages: [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "hello",
          turnId: TurnId.makeUnsafe("turn-1"),
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:00.000Z",
          streaming: false,
        },
      ],
    });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2") });
    const state: AppState = {
      ...makeState(thread1),
      threads: [thread1, thread2],
    };

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: thread1.id,
        messageId: MessageId.makeUnsafe("message-1"),
        role: "assistant",
        text: " world",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: true,
        createdAt: "2026-02-27T00:00:01.000Z",
        updatedAt: "2026-02-27T00:00:01.000Z",
      }),
    );

    expect(next.threads[0]?.messages[0]?.text).toBe("hello world");
    expect(next.threads[0]?.latestTurn?.state).toBe("running");
    expect(next.threads[1]).toBe(thread2);
  });

  it("applies replay batches in sequence and updates session state", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "running",
        requestedAt: "2026-02-27T00:00:00.000Z",
        startedAt: "2026-02-27T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvents(state, [
      makeEvent(
        "thread.session-set",
        {
          threadId: thread.id,
          session: {
            threadId: thread.id,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.makeUnsafe("turn-1"),
            lastError: null,
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
        },
        { sequence: 2 },
      ),
      makeEvent(
        "thread.message-sent",
        {
          threadId: thread.id,
          messageId: MessageId.makeUnsafe("assistant-1"),
          role: "assistant",
          text: "done",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-27T00:00:03.000Z",
          updatedAt: "2026-02-27T00:00:03.000Z",
        },
        { sequence: 3 },
      ),
    ]);

    expect(next.threads[0]?.session?.status).toBe("running");
    expect(next.threads[0]?.latestTurn?.state).toBe("completed");
    expect(next.threads[0]?.messages).toHaveLength(1);
  });

  it("does not regress latestTurn when an older turn diff completes late", () => {
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-2"),
          state: "running",
          requestedAt: "2026-02-27T00:00:02.000Z",
          startedAt: "2026-02-27T00:00:03.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-diff-completed", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant-1"),
        completedAt: "2026-02-27T00:00:04.000Z",
      }),
    );

    expect(next.threads[0]?.turnDiffSummaries).toHaveLength(1);
    expect(next.threads[0]?.latestTurn).toEqual(state.threads[0]?.latestTurn);
  });

  it("keeps running turns active through provisional missing diffs", () => {
    const turnId = TurnId.makeUnsafe("turn-running-missing-diff");
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:01.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    );

    const afterMissing = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-diff-completed", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("provider-diff:running-missing-diff"),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant:turn-running-missing-diff"),
        completedAt: "2026-02-27T00:00:02.000Z",
      }),
    );

    expect(afterMissing.threads[0]?.latestTurn).toMatchObject({
      turnId,
      state: "running",
      completedAt: null,
    });
    expect(afterMissing.threads[0]?.turnDiffSummaries[0]?.status).toBe("missing");

    const afterAssistantComplete = applyOrchestrationEvent(
      afterMissing,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("assistant-real"),
        role: "assistant",
        text: "done",
        turnId,
        streaming: false,
        createdAt: "2026-02-27T00:00:03.000Z",
        updatedAt: "2026-02-27T00:00:03.000Z",
      }),
    );

    expect(afterAssistantComplete.threads[0]?.latestTurn).toMatchObject({
      turnId,
      state: "completed",
      completedAt: "2026-02-27T00:00:03.000Z",
      assistantMessageId: MessageId.makeUnsafe("assistant-real"),
    });
  });

  it("rebinds live turn diffs to the authoritative assistant message when it arrives later", () => {
    const turnId = TurnId.makeUnsafe("turn-1");
    const state = makeState(
      makeThread({
        latestTurn: {
          turnId,
          state: "completed",
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:02.000Z",
          assistantMessageId: MessageId.makeUnsafe("assistant:turn-1"),
        },
        turnDiffSummaries: [
          {
            turnId,
            completedAt: "2026-02-27T00:00:02.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
            assistantMessageId: MessageId.makeUnsafe("assistant:turn-1"),
            files: [{ path: "src/app.ts", additions: 1, deletions: 0 }],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.message-sent", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        messageId: MessageId.makeUnsafe("assistant-real"),
        role: "assistant",
        text: "final answer",
        turnId,
        streaming: false,
        createdAt: "2026-02-27T00:00:03.000Z",
        updatedAt: "2026-02-27T00:00:03.000Z",
      }),
    );

    expect(next.threads[0]?.turnDiffSummaries[0]?.assistantMessageId).toBe(
      MessageId.makeUnsafe("assistant-real"),
    );
    expect(next.threads[0]?.latestTurn?.assistantMessageId).toBe(
      MessageId.makeUnsafe("assistant-real"),
    );
  });

  it("reverts messages, plans, activities, and checkpoints by retained turns", () => {
    const state = makeState(
      makeThread({
        messages: [
          {
            id: MessageId.makeUnsafe("user-1"),
            role: "user",
            text: "first",
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
            completedAt: "2026-02-27T00:00:00.000Z",
            streaming: false,
          },
          {
            id: MessageId.makeUnsafe("assistant-1"),
            role: "assistant",
            text: "first reply",
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:00:01.000Z",
            completedAt: "2026-02-27T00:00:01.000Z",
            streaming: false,
          },
          {
            id: MessageId.makeUnsafe("user-2"),
            role: "user",
            text: "second",
            turnId: TurnId.makeUnsafe("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
            completedAt: "2026-02-27T00:00:02.000Z",
            streaming: false,
          },
        ],
        proposedPlans: [
          {
            id: "plan-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            planMarkdown: "plan 1",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: "plan-2",
            turnId: TurnId.makeUnsafe("turn-2"),
            planMarkdown: "plan 2",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-27T00:00:02.000Z",
            updatedAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        activities: [
          {
            id: EventId.makeUnsafe("activity-1"),
            tone: "info",
            kind: "step",
            summary: "one",
            payload: {},
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-02-27T00:00:00.000Z",
          },
          {
            id: EventId.makeUnsafe("activity-2"),
            tone: "info",
            kind: "step",
            summary: "two",
            payload: {},
            turnId: TurnId.makeUnsafe("turn-2"),
            createdAt: "2026-02-27T00:00:02.000Z",
          },
        ],
        turnDiffSummaries: [
          {
            turnId: TurnId.makeUnsafe("turn-1"),
            completedAt: "2026-02-27T00:00:01.000Z",
            status: "ready",
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.makeUnsafe("ref-1"),
            files: [],
          },
          {
            turnId: TurnId.makeUnsafe("turn-2"),
            completedAt: "2026-02-27T00:00:03.000Z",
            status: "ready",
            checkpointTurnCount: 2,
            checkpointRef: CheckpointRef.makeUnsafe("ref-2"),
            files: [],
          },
        ],
      }),
    );

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.reverted", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnCount: 1,
      }),
    );

    expect(next.threads[0]?.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(next.threads[0]?.proposedPlans.map((plan) => plan.id)).toEqual(["plan-1"]);
    expect(next.threads[0]?.activities.map((activity) => activity.id)).toEqual([
      EventId.makeUnsafe("activity-1"),
    ]);
    expect(next.threads[0]?.turnDiffSummaries.map((summary) => summary.turnId)).toEqual([
      TurnId.makeUnsafe("turn-1"),
    ]);
  });

  it("clears pending source proposed plans after revert before a new session-set event", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-2"),
        state: "completed",
        requestedAt: "2026-02-27T00:00:02.000Z",
        startedAt: "2026-02-27T00:00:02.000Z",
        completedAt: "2026-02-27T00:00:03.000Z",
        assistantMessageId: MessageId.makeUnsafe("assistant-2"),
        sourceProposedPlan: {
          threadId: ThreadId.makeUnsafe("thread-source"),
          planId: "plan-2" as never,
        },
      },
      pendingSourceProposedPlan: {
        threadId: ThreadId.makeUnsafe("thread-source"),
        planId: "plan-2" as never,
      },
      turnDiffSummaries: [
        {
          turnId: TurnId.makeUnsafe("turn-1"),
          completedAt: "2026-02-27T00:00:01.000Z",
          status: "ready",
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("ref-1"),
          files: [],
        },
        {
          turnId: TurnId.makeUnsafe("turn-2"),
          completedAt: "2026-02-27T00:00:03.000Z",
          status: "ready",
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("ref-2"),
          files: [],
        },
      ],
    });
    const reverted = applyOrchestrationEvent(
      makeState(thread),
      makeEvent("thread.reverted", {
        threadId: thread.id,
        turnCount: 1,
      }),
    );

    expect(reverted.threads[0]?.pendingSourceProposedPlan).toBeUndefined();

    const next = applyOrchestrationEvent(
      reverted,
      makeEvent("thread.session-set", {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.makeUnsafe("turn-3"),
          lastError: null,
          updatedAt: "2026-02-27T00:00:04.000Z",
        },
      }),
    );

    expect(next.threads[0]?.latestTurn).toMatchObject({
      turnId: TurnId.makeUnsafe("turn-3"),
      state: "running",
    });
    expect(next.threads[0]?.latestTurn?.sourceProposedPlan).toBeUndefined();
  });
});

// ── accumulateFileChanges ─────────────────────────────────────────────────────

describe("accumulateFileChanges", () => {
  it("returns empty array for empty summaries", () => {
    expect(accumulateFileChanges([])).toEqual([]);
  });

  it("accumulates a single turn with multiple files", () => {
    const result = accumulateFileChanges([
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-07T00:00:00.000Z",
        status: "ready",
        files: [
          { path: "src/index.ts", kind: "modified", additions: 10, deletions: 3 },
          { path: "src/utils.ts", kind: "added", additions: 25, deletions: 0 },
        ],
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      path: "src/index.ts",
      kind: "modified",
      totalInsertions: 10,
      totalDeletions: 3,
      firstTurnId: TurnId.makeUnsafe("turn-1"),
      lastTurnId: TurnId.makeUnsafe("turn-1"),
    });
    expect(result).toContainEqual({
      path: "src/utils.ts",
      kind: "added",
      totalInsertions: 25,
      totalDeletions: 0,
      firstTurnId: TurnId.makeUnsafe("turn-1"),
      lastTurnId: TurnId.makeUnsafe("turn-1"),
    });
  });

  it("accumulates file changes across multiple turns", () => {
    const result = accumulateFileChanges([
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-07T00:00:00.000Z",
        status: "ready",
        files: [{ path: "src/index.ts", kind: "modified", additions: 10, deletions: 3 }],
      },
      {
        turnId: TurnId.makeUnsafe("turn-2"),
        completedAt: "2026-04-07T00:01:00.000Z",
        status: "ready",
        files: [{ path: "src/index.ts", kind: "modified", additions: 5, deletions: 2 }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "src/index.ts",
      kind: "modified",
      totalInsertions: 15,
      totalDeletions: 5,
      firstTurnId: TurnId.makeUnsafe("turn-1"),
      lastTurnId: TurnId.makeUnsafe("turn-2"),
    });
  });

  it("skips turns with missing or error status", () => {
    const result = accumulateFileChanges([
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-07T00:00:00.000Z",
        status: "ready",
        files: [{ path: "src/a.ts", kind: "modified", additions: 5, deletions: 0 }],
      },
      {
        turnId: TurnId.makeUnsafe("turn-2"),
        completedAt: "2026-04-07T00:01:00.000Z",
        status: "missing",
        files: [{ path: "src/b.ts", kind: "added", additions: 20, deletions: 0 }],
      },
      {
        turnId: TurnId.makeUnsafe("turn-3"),
        completedAt: "2026-04-07T00:02:00.000Z",
        status: "error",
        files: [{ path: "src/c.ts", kind: "added", additions: 10, deletions: 0 }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("src/a.ts");
  });

  it("preserves 'added' kind when a file is later modified", () => {
    const result = accumulateFileChanges([
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-07T00:00:00.000Z",
        status: "ready",
        files: [{ path: "src/new.ts", kind: "added", additions: 20, deletions: 0 }],
      },
      {
        turnId: TurnId.makeUnsafe("turn-2"),
        completedAt: "2026-04-07T00:01:00.000Z",
        status: "ready",
        files: [{ path: "src/new.ts", kind: "modified", additions: 5, deletions: 1 }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("added");
    expect(result[0]?.totalInsertions).toBe(25);
    expect(result[0]?.totalDeletions).toBe(1);
  });

  it("upgrades kind to 'deleted' when a file is deleted", () => {
    const result = accumulateFileChanges([
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-07T00:00:00.000Z",
        status: "ready",
        files: [{ path: "src/old.ts", kind: "modified", additions: 5, deletions: 3 }],
      },
      {
        turnId: TurnId.makeUnsafe("turn-2"),
        completedAt: "2026-04-07T00:01:00.000Z",
        status: "ready",
        files: [{ path: "src/old.ts", kind: "deleted", additions: 0, deletions: 50 }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("deleted");
  });

  it("handles files with undefined additions/deletions", () => {
    const result = accumulateFileChanges([
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-07T00:00:00.000Z",
        status: "ready",
        files: [{ path: "src/unknown.ts" }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "src/unknown.ts",
      kind: undefined,
      totalInsertions: 0,
      totalDeletions: 0,
      firstTurnId: TurnId.makeUnsafe("turn-1"),
      lastTurnId: TurnId.makeUnsafe("turn-1"),
    });
  });

  it("wires into turn-diff-completed event and updates persistedFileChanges", () => {
    const thread = makeThread({
      turnDiffSummaries: [],
      persistedFileChanges: [],
    });
    const state = makeState(thread);

    const next = applyOrchestrationEvent(
      state,
      makeEvent("thread.turn-diff-completed", {
        threadId: thread.id,
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("cp-1"),
        status: "ready",
        files: [{ path: "src/app.ts", kind: "modified", additions: 8, deletions: 2 }],
        assistantMessageId: null,
        completedAt: "2026-04-07T00:00:00.000Z",
      }),
    );

    expect(next.threads[0]?.persistedFileChanges).toHaveLength(1);
    expect(next.threads[0]?.persistedFileChanges[0]).toMatchObject({
      path: "src/app.ts",
      kind: "modified",
      totalInsertions: 8,
      totalDeletions: 2,
    });
  });
});
