import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);

describe("decider project scripts", () => {
  it("defaults project.create kind to project", async () => {
    const now = new Date().toISOString();
    const readModel = createEmptyReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create-kind-default"),
          projectId: asProjectId("project-kind-default"),
          title: "Kind Default",
          workspaceRoot: "/tmp/project-kind-default",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect((event.payload as { kind?: string }).kind).toBe("project");
  });

  it("emits empty scripts on project.create", async () => {
    const now = new Date().toISOString();
    const readModel = createEmptyReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create-scripts"),
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect((event.payload as { scripts: unknown[] }).scripts).toEqual([]);
  });

  it("propagates scripts in project.meta.update payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-scripts"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-scripts"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-scripts"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-scripts"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const scripts = [
      {
        id: "lint",
        name: "Lint",
        command: "bun run lint",
        icon: "lint",
        runOnWorktreeCreate: false,
      },
    ] as const;

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-update-scripts"),
          projectId: asProjectId("project-scripts"),
          scripts: Array.from(scripts),
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.meta-updated");
    expect((event.payload as { scripts?: unknown[] }).scripts).toEqual(scripts);
  });

  it("propagates orchestrator kind in project.meta.update payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-kind"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-kind"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-kind"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-kind"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-kind"),
          title: "Kind",
          workspaceRoot: "/tmp/project-kind",
          kind: "project",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-update-kind"),
          projectId: asProjectId("project-kind"),
          kind: "orchestrator",
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events[0]!.type).toBe("project.meta-updated");
    expect((events[0]!.payload as { kind?: string }).kind).toBe("orchestrator");
  });

  it("propagates thread.create labels into thread.created payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-labels"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-labels"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-labels"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-labels"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-labels"),
          title: "Project",
          workspaceRoot: "/tmp/project-labels",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-labels"),
          threadId: ThreadId.makeUnsafe("thread-labels"),
          projectId: asProjectId("project-labels"),
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          labels: ["orchestrator", "worker"],
          createdAt: now,
        },
        readModel: withProject,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("thread.created");
    expect((event.payload as { labels?: string[] }).labels).toEqual(["orchestrator", "worker"]);
  });

  it("defaults orchestrator thread labels from the project title", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-orchestrator-default-labels"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-jasper"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-orchestrator-default-labels"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-orchestrator-default-labels"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-jasper"),
          title: "Jasper",
          workspaceRoot: "/tmp/jasper",
          kind: "orchestrator",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-orchestrator-default-labels"),
          threadId: ThreadId.makeUnsafe("thread-jasper"),
          projectId: asProjectId("project-jasper"),
          title: "Session",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        readModel: withProject,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("thread.created");
    expect((event.payload as { labels?: string[] }).labels).toEqual(["orchestrator", "jasper"]);
  });

  it("propagates thread.meta.update labels into thread.meta-updated payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-labels-update"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-labels-update"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-labels-update"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-labels-update"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-labels-update"),
          title: "Project",
          workspaceRoot: "/tmp/project-labels-update",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-labels-update"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-labels-update"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-labels-update"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-labels-update"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-labels-update"),
          projectId: asProjectId("project-labels-update"),
          title: "Thread",
          labels: ["initial"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-thread-update-labels"),
          threadId: ThreadId.makeUnsafe("thread-labels-update"),
          labels: ["worker", "orchestrator"],
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("thread.meta-updated");
    expect((event.payload as { labels?: string[] }).labels).toEqual(["worker", "orchestrator"]);
  });

  it("reconciles active thread labels when converting a project into an orchestrator", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-convert"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-convert"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-convert"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-convert"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-convert"),
          title: "Support Desk",
          workspaceRoot: "/tmp/project-convert",
          kind: "project",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-convert"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-convert"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-convert"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-convert"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-convert"),
          projectId: asProjectId("project-convert"),
          title: "Thread",
          labels: ["worker", "triage"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-convert-to-orchestrator"),
          projectId: asProjectId("project-convert"),
          kind: "orchestrator",
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "project.meta-updated",
      "thread.meta-updated",
    ]);
    expect((events[1]!.payload as { labels?: string[] }).labels).toEqual([
      "orchestrator",
      "support-desk",
      "worker",
      "triage",
    ]);
  });

  it("renames managed orchestrator labels for active threads when the project title changes", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-rename"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-rename"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-rename"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-rename"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-rename"),
          title: "Jasper",
          workspaceRoot: "/tmp/project-rename",
          kind: "orchestrator",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-rename"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-rename"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-rename"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-rename"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-rename"),
          projectId: asProjectId("project-rename"),
          title: "Thread",
          labels: ["orchestrator", "jasper", "worker"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-rename-orchestrator"),
          projectId: asProjectId("project-rename"),
          title: "Jasper Prime",
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "project.meta-updated",
      "thread.meta-updated",
    ]);
    expect((events[1]!.payload as { labels?: string[] }).labels).toEqual([
      "orchestrator",
      "jasper-prime",
      "worker",
    ]);
  });

  it("strips managed orchestrator labels when a project is converted back to a regular project", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-demote"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-demote"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-demote"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-demote"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-demote"),
          title: "Jasper",
          workspaceRoot: "/tmp/project-demote",
          kind: "orchestrator",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-demote"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-demote"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-demote"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-demote"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-demote"),
          projectId: asProjectId("project-demote"),
          title: "Thread",
          labels: ["orchestrator", "jasper", "worker", "triage"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-demote"),
          projectId: asProjectId("project-demote"),
          kind: "project",
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "project.meta-updated",
      "thread.meta-updated",
    ]);
    expect((events[1]!.payload as { labels?: string[] }).labels).toEqual(["worker", "triage"]);
  });

  it("preserves custom labels when demoting an orchestrator project and renaming it", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-demote-rename"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-demote-rename"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-demote-rename"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-demote-rename"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-demote-rename"),
          title: "Jasper",
          workspaceRoot: "/tmp/project-demote-rename",
          kind: "orchestrator",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-demote-rename"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-demote-rename"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-demote-rename"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-demote-rename"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-demote-rename"),
          projectId: asProjectId("project-demote-rename"),
          title: "Thread",
          labels: ["orchestrator", "jasper", "support-desk", "worker"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-demote-rename"),
          projectId: asProjectId("project-demote-rename"),
          kind: "project",
          title: "Support Desk",
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "project.meta-updated",
      "thread.meta-updated",
    ]);
    expect((events[1]!.payload as { labels?: string[] }).labels).toEqual([
      "support-desk",
      "worker",
    ]);
  });

  it("rejects converting a project with multiple active threads into an orchestrator", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-multi"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-multi"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-multi"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-multi"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-multi"),
          title: "Multi",
          workspaceRoot: "/tmp/project-multi",
          kind: "project",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withFirstThread = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-multi-1"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-multi-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-multi-1"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-multi-1"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-multi-1"),
          projectId: asProjectId("project-multi"),
          title: "Thread 1",
          labels: [],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withFirstThread, {
        sequence: 3,
        eventId: asEventId("evt-thread-create-multi-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-multi-2"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-multi-2"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-multi-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-multi-2"),
          projectId: asProjectId("project-multi"),
          title: "Thread 2",
          labels: [],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "project.meta.update",
            commandId: CommandId.makeUnsafe("cmd-project-multi-to-orchestrator"),
            projectId: asProjectId("project-multi"),
            kind: "orchestrator",
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("cannot be converted to an orchestrator");
  });

  it("rejects unarchiving a second active thread in an orchestrator project", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-unarchive"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-unarchive"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-unarchive"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-unarchive"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-unarchive"),
          title: "Unarchive",
          workspaceRoot: "/tmp/project-unarchive",
          kind: "orchestrator",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withActiveThread = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create-unarchive-active"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-unarchive-active"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-unarchive-active"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-unarchive-active"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-unarchive-active"),
          projectId: asProjectId("project-unarchive"),
          title: "Active",
          labels: ["orchestrator", "unarchive"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withArchivedThread = await Effect.runPromise(
      projectEvent(withActiveThread, {
        sequence: 3,
        eventId: asEventId("evt-thread-create-unarchive-archived"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-unarchive-archived"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-unarchive-archived"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-unarchive-archived"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-unarchive-archived"),
          projectId: asProjectId("project-unarchive"),
          title: "Archived",
          labels: ["orchestrator", "unarchive"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withArchivedThread, {
        sequence: 4,
        eventId: asEventId("evt-thread-archive-unarchive-archived"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-unarchive-archived"),
        type: "thread.archived",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-archive-unarchive-archived"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-archive-unarchive-archived"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-unarchive-archived"),
          archivedAt: now,
          updatedAt: now,
        },
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.unarchive",
            commandId: CommandId.makeUnsafe("cmd-thread-unarchive-conflict"),
            threadId: ThreadId.makeUnsafe("thread-unarchive-archived"),
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("already has an active thread");
  });

  it("emits user message and turn-start-requested events for thread.turn.start", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          labels: [],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-turn-start"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          message: {
            messageId: asMessageId("message-user-1"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              reasoningEffort: "high",
              fastMode: true,
            },
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    const events = Array.isArray(result) ? result : [result];
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("thread.message-sent");
    const turnStartEvent = events[1];
    expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
    expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
    if (turnStartEvent?.type !== "thread.turn-start-requested") {
      return;
    }
    expect(turnStartEvent.payload).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      messageId: asMessageId("message-user-1"),
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: {
          reasoningEffort: "high",
          fastMode: true,
        },
      },
      runtimeMode: "approval-required",
    });
  });

  it("emits thread.runtime-mode-set from thread.runtime-mode.set", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
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
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.runtime-mode.set",
          commandId: CommandId.makeUnsafe("cmd-runtime-mode-set"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      }),
    );

    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single runtime-mode-set event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.runtime-mode-set",
      payload: {
        threadId: ThreadId.makeUnsafe("thread-1"),
        runtimeMode: "approval-required",
      },
    });
  });

  it("emits thread.interaction-mode-set from thread.interaction-mode.set", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          labels: [],
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.interaction-mode.set",
          commandId: CommandId.makeUnsafe("cmd-interaction-mode-set"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          interactionMode: "plan",
          createdAt: now,
        },
        readModel,
      }),
    );

    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single interaction-mode-set event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.interaction-mode-set",
      payload: {
        threadId: ThreadId.makeUnsafe("thread-1"),
        interactionMode: "plan",
      },
    });
  });
});
