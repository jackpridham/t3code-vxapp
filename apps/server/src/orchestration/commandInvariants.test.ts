import { describe, expect, it } from "vitest";
import {
  MessageId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";

import {
  findThreadById,
  listActiveThreadsByProjectId,
  listThreadsByProjectId,
  requireNonNegativeInteger,
  requireProjectCanBecomeOrchestrator,
  requireOrchestratorProjectThreadSlotAvailable,
  requireThread,
  requireThreadAbsent,
} from "./commandInvariants.ts";

const now = new Date().toISOString();

const readModel: OrchestrationReadModel = {
  snapshotSequence: 2,
  updatedAt: now,
  projects: [
    {
      id: ProjectId.makeUnsafe("project-a"),
      title: "Project A",
      workspaceRoot: "/tmp/project-a",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      scripts: [],
      hooks: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: ProjectId.makeUnsafe("project-b"),
      title: "Project B",
      workspaceRoot: "/tmp/project-b",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      scripts: [],
      hooks: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-a"),
      title: "Thread A",
      labels: [],
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
    {
      id: ThreadId.makeUnsafe("thread-2"),
      projectId: ProjectId.makeUnsafe("project-b"),
      title: "Thread B",
      labels: [],
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
  ],
};

const messageSendCommand: OrchestrationCommand = {
  type: "thread.turn.start",
  commandId: CommandId.makeUnsafe("cmd-1"),
  threadId: ThreadId.makeUnsafe("thread-1"),
  message: {
    messageId: MessageId.makeUnsafe("msg-1"),
    role: "user",
    text: "hello",
    attachments: [],
  },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "approval-required",
  createdAt: now,
};

describe("commandInvariants", () => {
  it("finds threads by id and project", () => {
    expect(findThreadById(readModel, ThreadId.makeUnsafe("thread-1"))?.projectId).toBe("project-a");
    expect(findThreadById(readModel, ThreadId.makeUnsafe("missing"))).toBeUndefined();
    expect(
      listActiveThreadsByProjectId(readModel, ProjectId.makeUnsafe("project-b")).map(
        (thread) => thread.id,
      ),
    ).toEqual([ThreadId.makeUnsafe("thread-2")]);
    expect(
      listThreadsByProjectId(readModel, ProjectId.makeUnsafe("project-b")).map(
        (thread) => thread.id,
      ),
    ).toEqual([ThreadId.makeUnsafe("thread-2")]);
  });

  it("treats deleted threads as inactive for orchestrator slot enforcement", () => {
    const deletedThreadReadModel: OrchestrationReadModel = {
      ...readModel,
      threads: readModel.threads.map((thread) =>
        thread.id === ThreadId.makeUnsafe("thread-1") ? { ...thread, deletedAt: now } : thread,
      ),
    };

    expect(
      listActiveThreadsByProjectId(deletedThreadReadModel, ProjectId.makeUnsafe("project-a")),
    ).toEqual([]);
  });

  it("requires existing thread", async () => {
    const thread = await Effect.runPromise(
      requireThread({
        readModel,
        command: messageSendCommand,
        threadId: ThreadId.makeUnsafe("thread-1"),
      }),
    );
    expect(thread.id).toBe(ThreadId.makeUnsafe("thread-1"));

    await expect(
      Effect.runPromise(
        requireThread({
          readModel,
          command: messageSendCommand,
          threadId: ThreadId.makeUnsafe("missing"),
        }),
      ),
    ).rejects.toThrow("does not exist");
  });

  it("requires missing thread for create flows", async () => {
    await Effect.runPromise(
      requireThreadAbsent({
        readModel,
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-2"),
          threadId: ThreadId.makeUnsafe("thread-3"),
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "new",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        threadId: ThreadId.makeUnsafe("thread-3"),
      }),
    );

    await expect(
      Effect.runPromise(
        requireThreadAbsent({
          readModel,
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-3"),
            threadId: ThreadId.makeUnsafe("thread-1"),
            projectId: ProjectId.makeUnsafe("project-a"),
            title: "dup",
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          threadId: ThreadId.makeUnsafe("thread-1"),
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("rejects a second active thread in an orchestrator project", async () => {
    const orchestratorReadModel: OrchestrationReadModel = {
      ...readModel,
      projects: readModel.projects.map((project) =>
        project.id === ProjectId.makeUnsafe("project-a")
          ? { ...project, kind: "orchestrator" as const }
          : project,
      ),
    };

    await expect(
      Effect.runPromise(
        requireOrchestratorProjectThreadSlotAvailable({
          readModel: orchestratorReadModel,
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-4"),
            threadId: ThreadId.makeUnsafe("thread-4"),
            projectId: ProjectId.makeUnsafe("project-a"),
            title: "next orchestrator session",
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          project: orchestratorReadModel.projects[0]!,
        }),
      ),
    ).rejects.toThrow("already has an active thread");
  });

  it("allows a new orchestrator thread when the previous thread was deleted", async () => {
    const orchestratorReadModel: OrchestrationReadModel = {
      ...readModel,
      projects: readModel.projects.map((project) =>
        project.id === ProjectId.makeUnsafe("project-a")
          ? { ...project, kind: "orchestrator" as const }
          : project,
      ),
      threads: readModel.threads.map((thread) =>
        thread.id === ThreadId.makeUnsafe("thread-1") ? { ...thread, deletedAt: now } : thread,
      ),
    };

    await Effect.runPromise(
      requireOrchestratorProjectThreadSlotAvailable({
        readModel: orchestratorReadModel,
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-5"),
          threadId: ThreadId.makeUnsafe("thread-5"),
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "replacement orchestrator session",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        project: orchestratorReadModel.projects[0]!,
      }),
    );
  });

  it("rejects converting a multi-thread project into an orchestrator", async () => {
    const crowdedReadModel: OrchestrationReadModel = {
      ...readModel,
      threads: [
        ...readModel.threads,
        {
          ...readModel.threads[0]!,
          id: ThreadId.makeUnsafe("thread-3"),
          title: "Thread A2",
        },
      ],
    };

    await expect(
      Effect.runPromise(
        requireProjectCanBecomeOrchestrator({
          readModel: crowdedReadModel,
          command: {
            type: "project.meta.update",
            commandId: CommandId.makeUnsafe("cmd-project-update-kind"),
            projectId: ProjectId.makeUnsafe("project-a"),
            kind: "orchestrator",
          },
          project: crowdedReadModel.projects[0]!,
        }),
      ),
    ).rejects.toThrow("cannot be converted to an orchestrator");
  });

  it("requires non-negative integers", async () => {
    await Effect.runPromise(
      requireNonNegativeInteger({
        commandType: "thread.checkpoint.revert",
        field: "turnCount",
        value: 0,
      }),
    );

    await expect(
      Effect.runPromise(
        requireNonNegativeInteger({
          commandType: "thread.checkpoint.revert",
          field: "turnCount",
          value: -1,
        }),
      ),
    ).rejects.toThrow("greater than or equal to 0");
  });
});
