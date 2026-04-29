import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetBootstrapSummaryResult,
  OrchestrationGetFileDiffInput,
  OrchestrationGetFileDiffResult,
  OrchestrationGetSnapshotInput,
  OrchestrationGetProjectByWorkspaceResult,
  OrchestrationGetReadinessResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  OrchestrationListProjectThreadsResult,
  OrchestrationCtoAttentionItem,
  OrchestrationReadModel,
  OrchestrationProgram,
  OrchestrationProgramNotification,
  OrchestrationSnapshotProfile,
  OrchestrationThread,
  OrchestratorWakeItem,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationSession,
  ProjectCreateCommand,
  ThreadOrchestratorWakeUpsertedPayload,
  ProgramCreateCommand,
  ProgramCreatedPayload,
  ProgramNotificationUpsertedPayload,
  ThreadMetaUpdatedPayload,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
} from "./orchestration";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeFileDiffInput = Schema.decodeUnknownEffect(OrchestrationGetFileDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeFileDiffResult = Schema.decodeUnknownEffect(OrchestrationGetFileDiffResult);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationGetBootstrapSummaryResult = Schema.decodeUnknownEffect(
  OrchestrationGetBootstrapSummaryResult,
);
const decodeOrchestrationGetSnapshotInput = Schema.decodeUnknownEffect(
  OrchestrationGetSnapshotInput,
);
const decodeOrchestrationGetReadinessResult = Schema.decodeUnknownEffect(
  OrchestrationGetReadinessResult,
);
const decodeOrchestrationGetProjectByWorkspaceResult = Schema.decodeUnknownEffect(
  OrchestrationGetProjectByWorkspaceResult,
);
const decodeOrchestrationListProjectThreadsResult = Schema.decodeUnknownEffect(
  OrchestrationListProjectThreadsResult,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const decodeOrchestrationThread = Schema.decodeUnknownEffect(OrchestrationThread);
const decodeOrchestrationProgram = Schema.decodeUnknownEffect(OrchestrationProgram);
const decodeOrchestrationProgramNotification = Schema.decodeUnknownEffect(
  OrchestrationProgramNotification,
);
const decodeOrchestrationCtoAttentionItem = Schema.decodeUnknownEffect(
  OrchestrationCtoAttentionItem,
);
const decodeOrchestrationReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const decodeOrchestratorWakeItem = Schema.decodeUnknownEffect(OrchestratorWakeItem);
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeProgramCreateCommand = Schema.decodeUnknownEffect(ProgramCreateCommand);
const decodeProgramCreatedPayload = Schema.decodeUnknownEffect(ProgramCreatedPayload);
const decodeProgramNotificationUpsertedPayload = Schema.decodeUnknownEffect(
  ProgramNotificationUpsertedPayload,
);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
const decodeThreadOrchestratorWakeUpsertedPayload = Schema.decodeUnknownEffect(
  ThreadOrchestratorWakeUpsertedPayload,
);

const PROGRAM_DELIVERY_SPEC = {
  declaredRepos: ["t3code-vxapp"],
  affectedAppTargets: ["web"],
  requiredLocalSuites: [
    {
      repo: "t3code-vxapp",
      suiteId: "lint",
      description: "Run lint before closeout.",
    },
  ],
  requiredExternalE2ESuites: [
    {
      target: "web",
      suiteId: "founder-e2e",
      description: "Founder-visible E2E contract.",
    },
  ],
  requireDevelopmentDeploy: true,
  requireExternalE2E: true,
  requireCleanPostFlight: true,
  requirePrPerRepo: true,
} as const;

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects thread turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeThreadTurnDiff({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("parses file diff input and defaults fromTurnCount to zero", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeFileDiffInput({
      threadId: "thread-1",
      path: "src/index.ts",
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.path, "src/index.ts");
    assert.strictEqual(parsed.fromTurnCount, 0);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("rejects file diff input when path is empty or range is inverted", () =>
  Effect.gen(function* () {
    const emptyPathResult = yield* Effect.exit(
      decodeFileDiffInput({
        threadId: "thread-1",
        path: "   ",
        fromTurnCount: 0,
        toTurnCount: 1,
      }),
    );
    assert.strictEqual(emptyPathResult._tag, "Failure");

    const invertedRangeResult = yield* Effect.exit(
      decodeFileDiffInput({
        threadId: "thread-1",
        path: "src/index.ts",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(invertedRangeResult._tag, "Failure");
  }),
);

it.effect("rejects file diff results when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeFileDiffResult({
        threadId: "thread-1",
        path: "src/index.ts",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      provider: "codex",
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes thread.create and thread.meta.update labels with trimming", () =>
  Effect.gen(function* () {
    const created = yield* decodeOrchestrationCommand({
      type: "thread.create",
      commandId: "cmd-thread-create",
      threadId: "thread-1",
      projectId: "project-1",
      title: " Thread Title ",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      labels: [" orchestrator ", "worker"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual((created as { labels: readonly string[] }).labels, [
      "orchestrator",
      "worker",
    ]);

    const updated = yield* decodeOrchestrationCommand({
      type: "thread.meta.update",
      commandId: "cmd-thread-update",
      threadId: "thread-1",
      labels: [" worker ", " orchestrator "],
    });
    assert.deepStrictEqual((updated as { labels: readonly string[] }).labels, [
      "worker",
      "orchestrator",
    ]);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.provider, "codex");
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.provider, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.provider, "codex");
    assert.deepStrictEqual(parsed.labels, []);
  }),
);

it.effect("decodes thread snapshots with default labels", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
      session: null,
    });

    assert.deepStrictEqual(parsed.labels, []);
    assert.deepStrictEqual(parsed.proposedPlans, []);
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "claudeAgent");
  }),
);

it.effect("decodes thread label payloads", () =>
  Effect.gen(function* () {
    const created = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      labels: [" orchestrator ", " jasper "],
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const updated = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      labels: [" worker ", " codex "],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(created.labels, ["orchestrator", "jasper"]);
    assert.deepStrictEqual(updated.labels, ["worker", "codex"]);
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.strictEqual(archived.type, "thread.archived");
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
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
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.provider, "codex");
    assert.strictEqual(parsed.modelSelection?.options?.reasoningEffort, "high");
    assert.strictEqual(parsed.modelSelection?.options?.fastMode, true);
  }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);

it.effect("decodes thread.create command with lineage metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.create",
      commandId: "cmd-lineage-1",
      threadId: "thread-worker-1",
      projectId: "project-1",
      title: "Worker Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      orchestratorProjectId: "project-1",
      orchestratorThreadId: "thread-orch-1",
      parentThreadId: "thread-orch-1",
      spawnRole: "worker",
      spawnedBy: "jasper",
      workflowId: "workflow-abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "thread.create");
    if (parsed.type !== "thread.create") return;
    assert.strictEqual(parsed.orchestratorProjectId, "project-1");
    assert.strictEqual(parsed.orchestratorThreadId, "thread-orch-1");
    assert.strictEqual(parsed.parentThreadId, "thread-orch-1");
    assert.strictEqual(parsed.spawnRole, "worker");
    assert.strictEqual(parsed.spawnedBy, "jasper");
    assert.strictEqual(parsed.workflowId, "workflow-abc");
  }),
);

it.effect("decodes thread.meta.update command with lineage metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.meta.update",
      commandId: "cmd-lineage-meta-1",
      threadId: "thread-worker-1",
      orchestratorProjectId: "project-1",
      orchestratorThreadId: "thread-orch-1",
      parentThreadId: "thread-orch-1",
      spawnRole: "supervisor",
      spawnedBy: "jasper",
      workflowId: "workflow-xyz",
    });
    assert.strictEqual(parsed.type, "thread.meta.update");
    if (parsed.type !== "thread.meta.update") return;
    assert.strictEqual(parsed.orchestratorProjectId, "project-1");
    assert.strictEqual(parsed.orchestratorThreadId, "thread-orch-1");
    assert.strictEqual(parsed.parentThreadId, "thread-orch-1");
    assert.strictEqual(parsed.spawnRole, "supervisor");
    assert.strictEqual(parsed.spawnedBy, "jasper");
    assert.strictEqual(parsed.workflowId, "workflow-xyz");
  }),
);

it.effect("defaults lineage fields to undefined when omitted from thread.created payload", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-plain-1",
      projectId: "project-1",
      title: "Plain Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.orchestratorProjectId, undefined);
    assert.strictEqual(parsed.orchestratorThreadId, undefined);
    assert.strictEqual(parsed.parentThreadId, undefined);
    assert.strictEqual(parsed.spawnRole, undefined);
    assert.strictEqual(parsed.spawnedBy, undefined);
    assert.strictEqual(parsed.workflowId, undefined);
  }),
);

it.effect("OrchestrationThread schema includes lineage fields with undefined defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationThread({
      id: "thread-legacy-1",
      projectId: "project-1",
      title: "Legacy Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
      session: null,
    });
    // Legacy threads without lineage fields should decode with undefined defaults
    assert.strictEqual(parsed.orchestratorProjectId, undefined);
    assert.strictEqual(parsed.orchestratorThreadId, undefined);
    assert.strictEqual(parsed.parentThreadId, undefined);
    assert.strictEqual(parsed.spawnRole, undefined);
    assert.strictEqual(parsed.spawnedBy, undefined);
    assert.strictEqual(parsed.workflowId, undefined);

    // Now decode a thread that carries full lineage
    const withLineage = yield* decodeOrchestrationThread({
      id: "thread-worker-2",
      projectId: "project-1",
      title: "Worker Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
      session: null,
      orchestratorProjectId: "project-1",
      orchestratorThreadId: "thread-orch-1",
      parentThreadId: "thread-orch-1",
      spawnRole: "worker",
      spawnedBy: "jasper",
      workflowId: "workflow-abc",
    });
    assert.strictEqual(withLineage.orchestratorProjectId, "project-1");
    assert.strictEqual(withLineage.orchestratorThreadId, "thread-orch-1");
    assert.strictEqual(withLineage.parentThreadId, "thread-orch-1");
    assert.strictEqual(withLineage.spawnRole, "worker");
    assert.strictEqual(withLineage.spawnedBy, "jasper");
    assert.strictEqual(withLineage.workflowId, "workflow-abc");
  }),
);

it.effect("decodes orchestrator wake items with expected defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestratorWakeItem({
      wakeId: "wake:worker-1:turn-1:completed",
      orchestratorThreadId: "thread-orch-1",
      orchestratorProjectId: "project-orch-1",
      workerThreadId: "thread-worker-1",
      workerProjectId: "project-worker-1",
      workerTurnId: "turn-1",
      workerTitleSnapshot: "Worker One",
      outcome: "completed",
      summary: "Updated the wake queue projection",
      queuedAt: "2026-04-05T10:00:00.000Z",
      state: "pending",
    });

    assert.strictEqual(parsed.workflowId, undefined);
    assert.strictEqual(parsed.deliveryMessageId, undefined);
    assert.strictEqual(parsed.deliveredAt, null);
    assert.strictEqual(parsed.consumedAt, null);
    assert.strictEqual(parsed.consumeReason, undefined);
  }),
);

it.effect("decodes wake upsert command and event payloads", () =>
  Effect.gen(function* () {
    const command = yield* decodeOrchestrationCommand({
      type: "thread.orchestrator-wake.upsert",
      commandId: "cmd-wake-1",
      threadId: "thread-orch-1",
      createdAt: "2026-04-05T10:01:00.000Z",
      wakeItem: {
        wakeId: "wake:worker-1:turn-1:failed",
        orchestratorThreadId: "thread-orch-1",
        orchestratorProjectId: "project-orch-1",
        workerThreadId: "thread-worker-1",
        workerProjectId: "project-worker-1",
        workerTurnId: "turn-1",
        workflowId: "wf-1",
        workerTitleSnapshot: "Worker One",
        outcome: "failed",
        summary: "Worker failed with a lint error",
        queuedAt: "2026-04-05T10:00:00.000Z",
        state: "pending",
      },
    });
    assert.strictEqual(command.type, "thread.orchestrator-wake.upsert");
    if (command.type !== "thread.orchestrator-wake.upsert") return;
    assert.strictEqual(command.wakeItem.outcome, "failed");

    const payload = yield* decodeThreadOrchestratorWakeUpsertedPayload({
      threadId: "thread-orch-1",
      wakeItem: {
        wakeId: "wake:worker-1:turn-1:failed",
        orchestratorThreadId: "thread-orch-1",
        orchestratorProjectId: "project-orch-1",
        workerThreadId: "thread-worker-1",
        workerProjectId: "project-worker-1",
        workerTurnId: "turn-1",
        workerTitleSnapshot: "Worker One",
        outcome: "failed",
        summary: "Worker failed with a lint error",
        queuedAt: "2026-04-05T10:00:00.000Z",
        state: "consumed",
        consumedAt: "2026-04-05T10:02:00.000Z",
        consumeReason: "worker_superseded_by_new_turn",
      },
    });
    assert.strictEqual(payload.wakeItem.state, "consumed");
    assert.strictEqual(payload.wakeItem.consumeReason, "worker_superseded_by_new_turn");

    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-wake-1",
      aggregateKind: "thread",
      aggregateId: "thread-orch-1",
      occurredAt: "2026-04-05T10:01:00.000Z",
      commandId: "cmd-wake-1",
      causationEventId: null,
      correlationId: "cmd-wake-1",
      metadata: {},
      type: "thread.orchestrator-wake-upserted",
      payload,
    });
    assert.strictEqual(event.type, "thread.orchestrator-wake-upserted");
  }),
);

it.effect("decodes snapshots containing orchestrator wake items", () =>
  Effect.gen(function* () {
    const snapshot = yield* decodeOrchestrationReadModel({
      snapshotSequence: 4,
      projects: [],
      threads: [],
      orchestratorWakeItems: [
        {
          wakeId: "wake:worker-1:turn-1:completed",
          orchestratorThreadId: "thread-orch-1",
          orchestratorProjectId: "project-orch-1",
          workerThreadId: "thread-worker-1",
          workerProjectId: "project-worker-1",
          workerTurnId: "turn-1",
          workerTitleSnapshot: "Worker One",
          outcome: "completed",
          summary: "Worker completed the task",
          queuedAt: "2026-04-05T10:00:00.000Z",
          state: "delivered",
          deliveryMessageId: "msg-wake-1",
          deliveredAt: "2026-04-05T10:03:00.000Z",
        },
      ],
      updatedAt: "2026-04-05T10:03:00.000Z",
    });

    assert.strictEqual(snapshot.orchestratorWakeItems.length, 1);
    assert.strictEqual(snapshot.orchestratorWakeItems[0]?.state, "delivered");
    assert.strictEqual(snapshot.orchestratorWakeItems[0]?.deliveryMessageId, "msg-wake-1");
  }),
);

it.effect("decodes bounded orchestration read results", () =>
  Effect.gen(function* () {
    const snapshotInput = yield* decodeOrchestrationGetSnapshotInput({});
    assert.strictEqual(snapshotInput.profile, "operational");
    assert.strictEqual(snapshotInput.threadId, undefined);
    assert.strictEqual(snapshotInput.allowDebugExport, false);

    const activeThreadSnapshotInput = yield* decodeOrchestrationGetSnapshotInput({
      profile: "active-thread",
      threadId: "thread-1",
    });
    assert.strictEqual(activeThreadSnapshotInput.profile, "active-thread");
    assert.strictEqual(activeThreadSnapshotInput.threadId, "thread-1");

    const commandStateSnapshotInput = yield* decodeOrchestrationGetSnapshotInput({
      profile: "command-state",
    });
    assert.strictEqual(commandStateSnapshotInput.profile, "command-state");

    const debugSnapshotInput = yield* decodeOrchestrationGetSnapshotInput({
      profile: "debug-export",
      allowDebugExport: true,
    });
    assert.strictEqual(debugSnapshotInput.allowDebugExport, true);

    const bootstrapSummary = yield* decodeOrchestrationGetBootstrapSummaryResult({
      snapshotSequence: 6,
      snapshotProfile: "bootstrap-summary",
      projects: [],
      threads: [],
      orchestratorWakeItems: [],
      updatedAt: "2026-04-05T10:00:00.000Z",
    });
    assert.strictEqual(bootstrapSummary.snapshotSequence, 6);
    assert.strictEqual(bootstrapSummary.snapshotProfile, "bootstrap-summary");

    const readiness = yield* decodeOrchestrationGetReadinessResult({
      snapshotSequence: 7,
      projectCount: 2,
      threadCount: 5,
    });
    assert.strictEqual(readiness.snapshotSequence, 7);
    assert.strictEqual(readiness.projectCount, 2);
    assert.strictEqual(readiness.threadCount, 5);

    const project = yield* decodeOrchestrationGetProjectByWorkspaceResult({
      id: "project-1",
      title: "Project One",
      workspaceRoot: "/tmp/project-one",
      createdAt: "2026-04-05T10:00:00.000Z",
      updatedAt: "2026-04-05T10:00:00.000Z",
    });
    assert.strictEqual(project?.id, "project-1");
    assert.strictEqual(project?.defaultModelSelection, null);

    const threads = yield* decodeOrchestrationListProjectThreadsResult([
      {
        id: "thread-1",
        projectId: "project-1",
        title: "Thread One",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: "2026-04-05T10:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z",
      },
    ]);
    assert.strictEqual(threads.length, 1);
    assert.deepStrictEqual(threads[0]?.labels, []);
    assert.strictEqual(threads[0]?.latestTurn, null);
    assert.strictEqual(threads[0]?.session, null);

    const snapshot = yield* decodeOrchestrationReadModel({
      snapshotSequence: 8,
      snapshotProfile: "operational",
      snapshotCoverage: {
        includeArchivedThreads: true,
        wakeItemCount: 4,
        wakeItemLimit: 100,
        wakeItemsTruncated: false,
        warnings: ["orchestrator wake total 12000 exceeds warning threshold 10000."],
      },
      projects: [],
      threads: [
        {
          id: "thread-1",
          projectId: "project-1",
          title: "Thread One",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
          snapshotCoverage: {
            messageCount: 12,
            messageLimit: 200,
            messagesTruncated: true,
            proposedPlanCount: 3,
            proposedPlanLimit: 50,
            proposedPlansTruncated: false,
            activityCount: 8,
            activityLimit: 100,
            activitiesTruncated: false,
            checkpointCount: 1,
            checkpointLimit: 50,
            checkpointsTruncated: false,
            warnings: ["thread thread-1 message total 12000 exceeds warning threshold 10000."],
          },
        },
      ],
      orchestratorWakeItems: [],
      updatedAt: "2026-04-05T10:01:00.000Z",
    });
    assert.strictEqual(snapshot.snapshotProfile, "operational");
    assert.strictEqual(snapshot.snapshotCoverage?.includeArchivedThreads, true);
    assert.deepStrictEqual(snapshot.snapshotCoverage?.warnings, [
      "orchestrator wake total 12000 exceeds warning threshold 10000.",
    ]);
    assert.strictEqual(snapshot.threads[0]?.snapshotCoverage?.messagesTruncated, true);
  }),
);

it.effect("decodes executive program contracts and read-model defaults", () =>
  Effect.gen(function* () {
    const program = yield* decodeOrchestrationProgram({
      id: "program-cto",
      title: "Founder task",
      objective: "Run founder task through CTO and Jasper.",
      status: "active",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      currentOrchestratorThreadId: "thread-jasper",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:01.000Z",
      completedAt: null,
      deletedAt: null,
    });
    assert.strictEqual(program.id, "program-cto");
    assert.strictEqual(program.status, "active");
    assert.strictEqual(program.currentOrchestratorThreadId, "thread-jasper");
    assert.deepStrictEqual(program.declaredRepos, []);
    assert.deepStrictEqual(program.requiredLocalSuites, []);
    assert.deepStrictEqual(program.requiredExternalE2ESuites, []);
    assert.deepStrictEqual(program.repoPrs, []);
    assert.deepStrictEqual(program.localValidation, []);
    assert.deepStrictEqual(program.appValidations, []);
    assert.deepStrictEqual(program.observedRepos, []);
    assert.strictEqual(program.requireDevelopmentDeploy, false);
    assert.strictEqual(program.requireExternalE2E, false);
    assert.strictEqual(program.requireCleanPostFlight, false);
    assert.strictEqual(program.requirePrPerRepo, false);
    assert.strictEqual(program.postFlight, null);
    assert.strictEqual(program.cancelReason, null);
    assert.strictEqual(program.cancelledAt, null);
    assert.strictEqual(program.supersededByProgramId, null);

    const createCommand = yield* decodeProgramCreateCommand({
      type: "program.create",
      commandId: "cmd-program",
      programId: "program-cto",
      title: "Founder task",
      objective: "Run founder task through CTO and Jasper.",
      ...PROGRAM_DELIVERY_SPEC,
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      currentOrchestratorThreadId: "thread-jasper",
      createdAt: "2026-04-20T00:00:00.000Z",
    });
    assert.strictEqual(createCommand.status, undefined);
    assert.deepStrictEqual(createCommand.declaredRepos, ["t3code-vxapp"]);

    const createdPayload = yield* decodeProgramCreatedPayload({
      programId: "program-cto",
      title: "Founder task",
      objective: null,
      status: "active",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      currentOrchestratorThreadId: null,
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      completedAt: null,
    });
    assert.strictEqual(createdPayload.currentOrchestratorThreadId, null);
    assert.deepStrictEqual(createdPayload.declaredRepos, []);
    assert.deepStrictEqual(createdPayload.repoPrs, []);
    assert.strictEqual(createdPayload.postFlight, null);

    const notification = yield* decodeOrchestrationProgramNotification({
      notificationId: "notif-cto",
      programId: "program-cto",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      orchestratorThreadId: "thread-jasper",
      kind: "decision_required",
      severity: "warning",
      summary: "Choose the next lane.",
      evidence: { workerThreadId: "thread-worker" },
      state: "pending",
      queuedAt: "2026-04-20T00:01:00.000Z",
      deliveredAt: null,
      consumedAt: null,
      droppedAt: null,
      createdAt: "2026-04-20T00:01:00.000Z",
      updatedAt: "2026-04-20T00:01:00.000Z",
    });
    assert.strictEqual(notification.kind, "decision_required");
    assert.deepStrictEqual(notification.evidence, { workerThreadId: "thread-worker" });

    const finalReviewNotification = yield* decodeOrchestrationProgramNotification({
      notificationId: "notif-final-review",
      programId: "program-cto",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      orchestratorThreadId: null,
      kind: "final_review_ready",
      severity: "info",
      summary: "The review is ready.",
      evidence: {},
      state: "pending",
      queuedAt: "2026-04-20T00:02:00.000Z",
      deliveredAt: null,
      consumedAt: null,
      droppedAt: null,
      createdAt: "2026-04-20T00:02:00.000Z",
      updatedAt: "2026-04-20T00:02:00.000Z",
    });
    assert.strictEqual(finalReviewNotification.kind, "final_review_ready");

    const closeoutReadyNotification = yield* decodeOrchestrationProgramNotification({
      notificationId: "notif-closeout",
      programId: "program-cto",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      orchestratorThreadId: null,
      kind: "closeout_ready",
      severity: "warning",
      summary: "Legacy closeout notification.",
      evidence: {},
      state: "pending",
      queuedAt: "2026-04-20T00:03:00.000Z",
      deliveredAt: null,
      consumedAt: null,
      droppedAt: null,
      createdAt: "2026-04-20T00:03:00.000Z",
      updatedAt: "2026-04-20T00:03:00.000Z",
    });
    assert.strictEqual(closeoutReadyNotification.kind, "closeout_ready");

    const notificationCommand = yield* decodeOrchestrationCommand({
      type: "program.notification.upsert",
      commandId: "cmd-notif",
      notificationId: "notif-cto",
      programId: "program-cto",
      kind: "blocked",
      severity: "critical",
      summary: "The task is blocked.",
      evidence: { reason: "missing approval" },
      createdAt: "2026-04-20T00:01:00.000Z",
    });
    assert.strictEqual(notificationCommand.type, "program.notification.upsert");

    const notificationPayload = yield* decodeProgramNotificationUpsertedPayload({
      ...notification,
      evidence: {},
    });
    assert.strictEqual(notificationPayload.notificationId, "notif-cto");

    const ctoAttentionItem = yield* decodeOrchestrationCtoAttentionItem({
      attentionId: "attention-cto",
      attentionKey:
        "program:program-cto|kind:final_review_ready|source-thread:thread-worker|source-role:worker|correlation:notif-final-review",
      notificationId: "notif-final-review",
      programId: "program-cto",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      sourceThreadId: "thread-worker",
      sourceRole: "worker",
      kind: "final_review_ready",
      severity: "info",
      summary: "The review is ready.",
      evidence: { correlationId: "notif-final-review" },
      state: "required",
      queuedAt: "2026-04-20T00:02:00.000Z",
      acknowledgedAt: null,
      resolvedAt: null,
      droppedAt: null,
      createdAt: "2026-04-20T00:02:00.000Z",
      updatedAt: "2026-04-20T00:02:00.000Z",
    });
    assert.strictEqual(ctoAttentionItem.state, "required");
    assert.strictEqual(ctoAttentionItem.kind, "final_review_ready");

    const notificationEvent = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-notif",
      aggregateKind: "program",
      aggregateId: "program-cto",
      occurredAt: "2026-04-20T00:01:00.000Z",
      commandId: "cmd-notif",
      causationEventId: null,
      correlationId: "cmd-notif",
      metadata: {},
      type: "program.notification-upserted",
      payload: notificationPayload,
    });
    assert.strictEqual(notificationEvent.type, "program.notification-upserted");

    const legacyReadModel = yield* decodeOrchestrationReadModel({
      snapshotSequence: 1,
      snapshotProfile: "operational",
      projects: [],
      threads: [],
      orchestratorWakeItems: [],
      updatedAt: "2026-04-20T00:00:00.000Z",
    });
    assert.deepStrictEqual(legacyReadModel.programs, []);
    assert.deepStrictEqual(legacyReadModel.programNotifications, []);
    assert.deepStrictEqual(legacyReadModel.ctoAttentionItems, []);
  }),
);

it.effect("rejects program.create without declaredRepos", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProgramCreateCommand({
        type: "program.create",
        commandId: "cmd-program-missing-scope",
        programId: "program-cto",
        title: "Founder task",
        objective: "Run founder task through CTO and Jasper.",
        affectedAppTargets: [],
        requiredLocalSuites: [],
        requiredExternalE2ESuites: [],
        requireDevelopmentDeploy: false,
        requireExternalE2E: false,
        requireCleanPostFlight: false,
        requirePrPerRepo: true,
        executiveProjectId: "project-cto",
        executiveThreadId: "thread-cto",
        createdAt: "2026-04-20T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects program.create with empty declaredRepos", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProgramCreateCommand({
        type: "program.create",
        commandId: "cmd-program-empty-scope",
        programId: "program-cto",
        title: "Founder task",
        objective: "Run founder task through CTO and Jasper.",
        declaredRepos: [],
        affectedAppTargets: [],
        requiredLocalSuites: [],
        requiredExternalE2ESuites: [],
        requireDevelopmentDeploy: false,
        requireExternalE2E: false,
        requireCleanPostFlight: false,
        requirePrPerRepo: true,
        executiveProjectId: "project-cto",
        executiveThreadId: "thread-cto",
        createdAt: "2026-04-20T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts the expanded program status set", () =>
  Effect.gen(function* () {
    for (const status of [
      "active",
      "blocked",
      "awaiting_founder",
      "awaiting_external",
      "closeout_in_progress",
      "founder_review_ready",
      "completed",
      "cancelled",
    ] as const) {
      const command = yield* decodeProgramCreateCommand({
        type: "program.create",
        commandId: `cmd-program-${status}`,
        programId: `program-${status}`,
        title: "Founder task",
        ...PROGRAM_DELIVERY_SPEC,
        status,
        executiveProjectId: "project-cto",
        executiveThreadId: "thread-cto",
        createdAt: "2026-04-20T00:00:00.000Z",
      });
      assert.strictEqual(command.status, status);
    }
  }),
);

it.effect("rejects invalid snapshot profiles", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      Schema.decodeUnknownEffect(OrchestrationSnapshotProfile)("bogus"),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
