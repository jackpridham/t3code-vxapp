import { Option, Schema, SchemaIssue, Struct } from "effect";
import { ClaudeModelOptions, CodexModelOptions } from "./model";
import { ProjectHooks } from "./projectHooks";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  CtoAttentionId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ProgramId,
  ProgramNotificationId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";

export const ORCHESTRATION_WS_METHODS = {
  getBootstrapSummary: "orchestration.getBootstrapSummary",
  getSnapshot: "orchestration.getSnapshot",
  getReadiness: "orchestration.getReadiness",
  getCurrentState: "orchestration.getCurrentState",
  listProjects: "orchestration.listProjects",
  getProjectById: "orchestration.getProjectById",
  getProjectByWorkspace: "orchestration.getProjectByWorkspace",
  listProjectThreads: "orchestration.listProjectThreads",
  getThreadById: "orchestration.getThreadById",
  listSessionThreads: "orchestration.listSessionThreads",
  listThreadMessages: "orchestration.listThreadMessages",
  listThreadActivities: "orchestration.listThreadActivities",
  listThreadSessions: "orchestration.listThreadSessions",
  listOrchestratorWakes: "orchestration.listOrchestratorWakes",
  dispatchCommand: "orchestration.dispatchCommand",
  dryRunCommand: "orchestration.dryRunCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFileDiff: "orchestration.getFileDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
} as const;

export const ORCHESTRATION_WS_CHANNELS = {
  domainEvent: "orchestration.domainEvent",
} as const;

export const ProviderKind = Schema.Literals(["codex", "claudeAgent"]);
export type ProviderKind = typeof ProviderKind.Type;
export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const DEFAULT_PROVIDER_KIND: ProviderKind = "codex";

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(CodexModelOptions),
});
export type CodexModelSelection = typeof CodexModelSelection.Type;

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal("claudeAgent"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ClaudeModelOptions),
});
export type ClaudeModelSelection = typeof ClaudeModelSelection.Type;

export const ModelSelection = Schema.Union([CodexModelSelection, ClaudeModelSelection]);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals(["approval-required", "full-access"]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

const THREAD_LABEL_MAX_LENGTH = 64;
const THREAD_LABEL_MAX_COUNT = 16;

export const ThreadLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_LABEL_MAX_LENGTH));
export type ThreadLabel = typeof ThreadLabel.Type;
export const ThreadLabels = Schema.Array(ThreadLabel).check(
  Schema.isMaxLength(THREAD_LABEL_MAX_COUNT),
);
export type ThreadLabels = typeof ThreadLabels.Type;

export const OrchestrationProjectKind = Schema.Literals(["project", "orchestrator", "executive"]);
export type OrchestrationProjectKind = typeof OrchestrationProjectKind.Type;

export const OrchestrationProgramStatus = Schema.Literals([
  "active",
  "blocked",
  "completed",
  "cancelled",
]);
export type OrchestrationProgramStatus = typeof OrchestrationProgramStatus.Type;

export const OrchestrationProgramNotificationKind = Schema.Literals([
  "decision_required",
  "blocked",
  "milestone_completed",
  "closeout_ready",
  "risk_escalated",
  "founder_update_required",
  "final_review_ready",
  "program_completed",
  "worker_started",
  "worker_progress",
  "worker_completed",
  "routine_status",
  "test_retry",
  "implementation_progress",
  "status_update",
]);
export type OrchestrationProgramNotificationKind = typeof OrchestrationProgramNotificationKind.Type;

export const OrchestrationCtoAttentionKind = Schema.Literals([
  "decision_required",
  "blocked",
  "risk_escalated",
  "founder_update_required",
  "final_review_ready",
  "program_completed",
]);
export type OrchestrationCtoAttentionKind = typeof OrchestrationCtoAttentionKind.Type;

export const OrchestrationCtoAttentionState = Schema.Literals([
  "required",
  "acknowledged",
  "resolved",
  "dropped",
]);
export type OrchestrationCtoAttentionState = typeof OrchestrationCtoAttentionState.Type;

export const OrchestrationProgramNotificationSeverity = Schema.Literals([
  "info",
  "warning",
  "critical",
]);
export type OrchestrationProgramNotificationSeverity =
  typeof OrchestrationProgramNotificationSeverity.Type;

export const OrchestrationProgramNotificationState = Schema.Literals([
  "pending",
  "delivering",
  "delivered",
  "consumed",
  "dropped",
]);
export type OrchestrationProgramNotificationState =
  typeof OrchestrationProgramNotificationState.Type;

export const ProgramNotificationEvidence = Schema.Record(Schema.String, Schema.Unknown);
export type ProgramNotificationEvidence = typeof ProgramNotificationEvidence.Type;

export const OrchestrationSnapshotProfile = Schema.Literals([
  "bootstrap-summary",
  "command-state",
  "operational",
  "active-thread",
  "debug-export",
]);
export type OrchestrationSnapshotProfile = typeof OrchestrationSnapshotProfile.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  kind: Schema.optional(OrchestrationProjectKind),
  sidebarParentProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  currentSessionRootThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  hooks: ProjectHooks,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationProgram = Schema.Struct({
  id: ProgramId,
  title: TrimmedNonEmptyString,
  objective: Schema.NullOr(TrimmedNonEmptyString),
  status: OrchestrationProgramStatus,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  currentOrchestratorThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProgram = typeof OrchestrationProgram.Type;

export const OrchestrationProgramNotification = Schema.Struct({
  notificationId: ProgramNotificationId,
  programId: ProgramId,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  orchestratorThreadId: Schema.NullOr(ThreadId),
  kind: OrchestrationProgramNotificationKind,
  severity: OrchestrationProgramNotificationSeverity,
  summary: TrimmedNonEmptyString,
  evidence: ProgramNotificationEvidence.pipe(Schema.withDecodingDefault(() => ({}))),
  state: OrchestrationProgramNotificationState,
  queuedAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  consumedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  droppedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  consumeReason: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  dropReason: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProgramNotification = typeof OrchestrationProgramNotification.Type;

export const OrchestrationCtoAttentionItem = Schema.Struct({
  attentionId: CtoAttentionId,
  attentionKey: TrimmedNonEmptyString,
  notificationId: ProgramNotificationId,
  programId: ProgramId,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  sourceThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  sourceRole: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  kind: OrchestrationCtoAttentionKind,
  severity: OrchestrationProgramNotificationSeverity,
  summary: TrimmedNonEmptyString,
  evidence: ProgramNotificationEvidence.pipe(Schema.withDecodingDefault(() => ({}))),
  state: OrchestrationCtoAttentionState,
  queuedAt: IsoDateTime,
  acknowledgedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  resolvedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  droppedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationCtoAttentionItem = typeof OrchestrationCtoAttentionItem.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "thinking",
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationThreadSnapshotCoverage = Schema.Struct({
  messageCount: NonNegativeInt,
  messageLimit: Schema.NullOr(NonNegativeInt),
  messagesTruncated: Schema.Boolean,
  proposedPlanCount: NonNegativeInt,
  proposedPlanLimit: Schema.NullOr(NonNegativeInt),
  proposedPlansTruncated: Schema.Boolean,
  activityCount: NonNegativeInt,
  activityLimit: Schema.NullOr(NonNegativeInt),
  activitiesTruncated: Schema.Boolean,
  checkpointCount: NonNegativeInt,
  checkpointLimit: Schema.NullOr(NonNegativeInt),
  checkpointsTruncated: Schema.Boolean,
  warnings: Schema.optional(Schema.Array(Schema.String)).pipe(Schema.withDecodingDefault(() => [])),
});
export type OrchestrationThreadSnapshotCoverage = typeof OrchestrationThreadSnapshotCoverage.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  labels: ThreadLabels.pipe(Schema.withDecodingDefault(() => [])),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(Schema.withDecodingDefault(() => [])),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  snapshotCoverage: Schema.optional(OrchestrationThreadSnapshotCoverage).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  session: Schema.NullOr(OrchestrationSession),
  orchestratorProjectId: Schema.optional(ProjectId).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  orchestratorThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  parentThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  spawnRole: Schema.optional(Schema.Literals(["orchestrator", "worker", "supervisor"])).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  spawnedBy: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  workflowId: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  programId: Schema.optional(ProgramId).pipe(Schema.withDecodingDefault(() => undefined)),
  executiveProjectId: Schema.optional(ProjectId).pipe(Schema.withDecodingDefault(() => undefined)),
  executiveThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationProjectSummary = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  kind: Schema.NullOr(OrchestrationProjectKind).pipe(Schema.withDecodingDefault(() => null)),
  sidebarParentProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  currentSessionRootThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  defaultModelSelection: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
});
export type OrchestrationProjectSummary = typeof OrchestrationProjectSummary.Type;

export const OrchestrationThreadSummary = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  labels: ThreadLabels.pipe(Schema.withDecodingDefault(() => [])),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  session: Schema.NullOr(OrchestrationSession).pipe(Schema.withDecodingDefault(() => null)),
  orchestratorProjectId: Schema.optional(ProjectId).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  orchestratorThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  parentThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  spawnRole: Schema.optional(Schema.Literals(["orchestrator", "worker", "supervisor"])).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  spawnedBy: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  workflowId: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  programId: Schema.optional(ProgramId).pipe(Schema.withDecodingDefault(() => undefined)),
  executiveProjectId: Schema.optional(ProjectId).pipe(Schema.withDecodingDefault(() => undefined)),
  executiveThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  sessionWorkerThreadCount: Schema.optional(NonNegativeInt).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
});
export type OrchestrationThreadSummary = typeof OrchestrationThreadSummary.Type;

export const OrchestrationReadinessSummary = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projectCount: NonNegativeInt,
  threadCount: NonNegativeInt,
});
export type OrchestrationReadinessSummary = typeof OrchestrationReadinessSummary.Type;

export const OrchestratorWakeOutcome = Schema.Literals(["completed", "failed", "interrupted"]);
export type OrchestratorWakeOutcome = typeof OrchestratorWakeOutcome.Type;

export const OrchestratorWakeState = Schema.Literals([
  "pending",
  "delivering",
  "delivered",
  "consumed",
  "dropped",
]);
export type OrchestratorWakeState = typeof OrchestratorWakeState.Type;

export const OrchestratorWakeConsumeReason = Schema.Literals([
  "worker_rechecked",
  "worker_superseded_by_new_turn",
  "worker_deleted",
  "worker_reparented",
  "orchestrator_missing",
  "orchestrator_deleted",
  "orchestrator_mismatch",
  "duplicate",
  "manual_dismiss",
]);
export type OrchestratorWakeConsumeReason = typeof OrchestratorWakeConsumeReason.Type;

export const OrchestratorWakeItem = Schema.Struct({
  wakeId: TrimmedNonEmptyString,
  orchestratorThreadId: ThreadId,
  orchestratorProjectId: ProjectId,
  workerThreadId: ThreadId,
  workerProjectId: ProjectId,
  workerTurnId: TurnId,
  workflowId: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  workerTitleSnapshot: TrimmedNonEmptyString,
  outcome: OrchestratorWakeOutcome,
  summary: TrimmedNonEmptyString,
  queuedAt: IsoDateTime,
  state: OrchestratorWakeState,
  deliveryMessageId: Schema.optional(MessageId).pipe(Schema.withDecodingDefault(() => undefined)),
  deliveredAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  consumedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  consumeReason: Schema.optional(OrchestratorWakeConsumeReason).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
});
export type OrchestratorWakeItem = typeof OrchestratorWakeItem.Type;

export const OrchestrationSnapshotCoverage = Schema.Struct({
  includeArchivedThreads: Schema.Boolean,
  wakeItemCount: NonNegativeInt,
  wakeItemLimit: Schema.NullOr(NonNegativeInt),
  wakeItemsTruncated: Schema.Boolean,
  warnings: Schema.optional(Schema.Array(Schema.String)).pipe(Schema.withDecodingDefault(() => [])),
});
export type OrchestrationSnapshotCoverage = typeof OrchestrationSnapshotCoverage.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  snapshotProfile: Schema.optional(OrchestrationSnapshotProfile),
  snapshotCoverage: Schema.optional(OrchestrationSnapshotCoverage),
  projects: Schema.Array(OrchestrationProject),
  programs: Schema.optional(Schema.Array(OrchestrationProgram)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  programNotifications: Schema.optional(Schema.Array(OrchestrationProgramNotification)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  ctoAttentionItems: Schema.optional(Schema.Array(OrchestrationCtoAttentionItem)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  threads: Schema.Array(OrchestrationThread),
  orchestratorWakeItems: Schema.Array(OrchestratorWakeItem).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  kind: Schema.optional(OrchestrationProjectKind),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

export const ProgramCreateCommand = Schema.Struct({
  type: Schema.Literal("program.create"),
  commandId: CommandId,
  programId: ProgramId,
  title: TrimmedNonEmptyString,
  objective: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  status: Schema.optional(OrchestrationProgramStatus),
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  currentOrchestratorThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  createdAt: IsoDateTime,
});

const ProgramMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("program.meta.update"),
  commandId: CommandId,
  programId: ProgramId,
  title: Schema.optional(TrimmedNonEmptyString),
  objective: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  status: Schema.optional(OrchestrationProgramStatus),
  executiveProjectId: Schema.optional(ProjectId),
  executiveThreadId: Schema.optional(ThreadId),
  currentOrchestratorThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});

const ProgramDeleteCommand = Schema.Struct({
  type: Schema.Literal("program.delete"),
  commandId: CommandId,
  programId: ProgramId,
});

const ProgramNotificationUpsertCommand = Schema.Struct({
  type: Schema.Literal("program.notification.upsert"),
  commandId: CommandId,
  notificationId: ProgramNotificationId,
  programId: ProgramId,
  executiveProjectId: Schema.optional(ProjectId),
  executiveThreadId: Schema.optional(ThreadId),
  orchestratorThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  kind: OrchestrationProgramNotificationKind,
  severity: Schema.optional(OrchestrationProgramNotificationSeverity),
  summary: TrimmedNonEmptyString,
  evidence: Schema.optional(ProgramNotificationEvidence),
  state: Schema.optional(OrchestrationProgramNotificationState),
  queuedAt: Schema.optional(IsoDateTime),
  deliveredAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  createdAt: IsoDateTime,
});

const ProgramNotificationConsumeCommand = Schema.Struct({
  type: Schema.Literal("program.notification.consume"),
  commandId: CommandId,
  programId: ProgramId,
  notificationId: ProgramNotificationId,
  consumeReason: Schema.optional(TrimmedNonEmptyString),
  consumedAt: Schema.optional(IsoDateTime),
});

const ProgramNotificationDropCommand = Schema.Struct({
  type: Schema.Literal("program.notification.drop"),
  commandId: CommandId,
  programId: ProgramId,
  notificationId: ProgramNotificationId,
  dropReason: Schema.optional(TrimmedNonEmptyString),
  droppedAt: Schema.optional(IsoDateTime),
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  kind: Schema.optional(OrchestrationProjectKind),
  sidebarParentProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  currentSessionRootThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  hooks: Schema.optional(ProjectHooks),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  labels: Schema.optional(ThreadLabels),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  orchestratorProjectId: Schema.optional(ProjectId),
  orchestratorThreadId: Schema.optional(ThreadId),
  parentThreadId: Schema.optional(ThreadId),
  spawnRole: Schema.optional(Schema.Literals(["orchestrator", "worker", "supervisor"])),
  spawnedBy: Schema.optional(TrimmedNonEmptyString),
  workflowId: Schema.optional(TrimmedNonEmptyString),
  programId: Schema.optional(ProgramId),
  executiveProjectId: Schema.optional(ProjectId),
  executiveThreadId: Schema.optional(ThreadId),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  labels: Schema.optional(ThreadLabels),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  orchestratorProjectId: Schema.optional(ProjectId),
  orchestratorThreadId: Schema.optional(ThreadId),
  parentThreadId: Schema.optional(ThreadId),
  spawnRole: Schema.optional(Schema.Literals(["orchestrator", "worker", "supervisor"])),
  spawnedBy: Schema.optional(TrimmedNonEmptyString),
  workflowId: Schema.optional(TrimmedNonEmptyString),
  programId: Schema.optional(ProgramId),
  executiveProjectId: Schema.optional(ProjectId),
  executiveThreadId: Schema.optional(ThreadId),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});
export type ThreadTurnStartCommand = typeof ThreadTurnStartCommand.Type;

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadOrchestratorWakeUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.orchestrator-wake.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  wakeItem: OrchestratorWakeItem,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ProgramCreateCommand,
  ProgramMetaUpdateCommand,
  ProgramDeleteCommand,
  ProgramNotificationUpsertCommand,
  ProgramNotificationConsumeCommand,
  ProgramNotificationDropCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadOrchestratorWakeUpsertCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ProgramCreateCommand,
  ProgramMetaUpdateCommand,
  ProgramDeleteCommand,
  ProgramNotificationUpsertCommand,
  ProgramNotificationConsumeCommand,
  ProgramNotificationDropCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  ThreadOrchestratorWakeUpsertCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadTurnCheckpointRecordCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.checkpoint.record"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadTurnCheckpointRecordCommand,
  ThreadActivityAppendCommand,
  ThreadOrchestratorWakeUpsertCommand,
  ThreadRevertCompleteCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "program.created",
  "program.meta-updated",
  "program.deleted",
  "program.notification-upserted",
  "program.notification-consumed",
  "program.notification-dropped",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-checkpoint-recorded",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "thread.orchestrator-wake-upserted",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "program", "thread"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  kind: Schema.optional(OrchestrationProjectKind),
  sidebarParentProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  currentSessionRootThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  hooks: ProjectHooks,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  kind: Schema.optional(OrchestrationProjectKind),
  sidebarParentProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  currentSessionRootThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  hooks: Schema.optional(ProjectHooks),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ProgramCreatedPayload = Schema.Struct({
  programId: ProgramId,
  title: TrimmedNonEmptyString,
  objective: Schema.NullOr(TrimmedNonEmptyString),
  status: OrchestrationProgramStatus,
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  currentOrchestratorThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});

export const ProgramMetaUpdatedPayload = Schema.Struct({
  programId: ProgramId,
  title: Schema.optional(TrimmedNonEmptyString),
  objective: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  status: Schema.optional(OrchestrationProgramStatus),
  executiveProjectId: Schema.optional(ProjectId),
  executiveThreadId: Schema.optional(ThreadId),
  currentOrchestratorThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  updatedAt: IsoDateTime,
});

export const ProgramDeletedPayload = Schema.Struct({
  programId: ProgramId,
  deletedAt: IsoDateTime,
});

export const ProgramNotificationUpsertedPayload = OrchestrationProgramNotification;

export const ProgramNotificationConsumedPayload = Schema.Struct({
  programId: ProgramId,
  notificationId: ProgramNotificationId,
  consumedAt: IsoDateTime,
  consumeReason: Schema.optional(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ProgramNotificationDroppedPayload = Schema.Struct({
  programId: ProgramId,
  notificationId: ProgramNotificationId,
  droppedAt: IsoDateTime,
  dropReason: Schema.optional(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  labels: ThreadLabels.pipe(Schema.withDecodingDefault(() => [])),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  orchestratorProjectId: Schema.optional(ProjectId).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  orchestratorThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  parentThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  spawnRole: Schema.optional(Schema.Literals(["orchestrator", "worker", "supervisor"])).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  spawnedBy: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  workflowId: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => undefined),
  ),
  programId: Schema.optional(ProgramId).pipe(Schema.withDecodingDefault(() => undefined)),
  executiveProjectId: Schema.optional(ProjectId).pipe(Schema.withDecodingDefault(() => undefined)),
  executiveThreadId: Schema.optional(ThreadId).pipe(Schema.withDecodingDefault(() => undefined)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  labels: Schema.optional(ThreadLabels),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  orchestratorProjectId: Schema.optional(ProjectId),
  orchestratorThreadId: Schema.optional(ThreadId),
  parentThreadId: Schema.optional(ThreadId),
  spawnRole: Schema.optional(Schema.Literals(["orchestrator", "worker", "supervisor"])),
  spawnedBy: Schema.optional(TrimmedNonEmptyString),
  workflowId: Schema.optional(TrimmedNonEmptyString),
  programId: Schema.optional(ProgramId),
  executiveProjectId: Schema.optional(ProjectId),
  executiveThreadId: Schema.optional(ThreadId),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

const ThreadTurnCheckpointPayloadFields = {
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
} as const;

export const ThreadTurnCheckpointRecordedPayload = Schema.Struct(ThreadTurnCheckpointPayloadFields);

export const ThreadTurnDiffCompletedPayload = Schema.Struct(ThreadTurnCheckpointPayloadFields);

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const ThreadOrchestratorWakeUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  wakeItem: OrchestratorWakeItem,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ProgramId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("program.created"),
    payload: ProgramCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("program.meta-updated"),
    payload: ProgramMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("program.deleted"),
    payload: ProgramDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("program.notification-upserted"),
    payload: ProgramNotificationUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("program.notification-consumed"),
    payload: ProgramNotificationConsumedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("program.notification-dropped"),
    payload: ProgramNotificationDroppedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-checkpoint-recorded"),
    payload: ThreadTurnCheckpointRecordedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.orchestrator-wake-upserted"),
    payload: ThreadOrchestratorWakeUpsertedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);
export const ThreadFileDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    path: TrimmedNonEmptyString,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "ready",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetSnapshotInput = Schema.Struct({
  profile: Schema.optional(OrchestrationSnapshotProfile).pipe(
    Schema.withDecodingDefault(() => "operational"),
  ),
  threadId: Schema.optional(ThreadId),
  allowDebugExport: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
});
export type OrchestrationGetSnapshotInput = typeof OrchestrationGetSnapshotInput.Type;
const OrchestrationGetSnapshotResult = OrchestrationReadModel;
export type OrchestrationGetSnapshotResult = typeof OrchestrationGetSnapshotResult.Type;

export const OrchestrationGetBootstrapSummaryInput = Schema.Struct({});
export type OrchestrationGetBootstrapSummaryInput =
  typeof OrchestrationGetBootstrapSummaryInput.Type;
export const OrchestrationGetBootstrapSummaryResult = OrchestrationReadModel;
export type OrchestrationGetBootstrapSummaryResult =
  typeof OrchestrationGetBootstrapSummaryResult.Type;

export const OrchestrationGetReadinessInput = Schema.Struct({});
export type OrchestrationGetReadinessInput = typeof OrchestrationGetReadinessInput.Type;
export const OrchestrationGetReadinessResult = OrchestrationReadinessSummary;
export type OrchestrationGetReadinessResult = typeof OrchestrationGetReadinessResult.Type;

export const OrchestrationGetCurrentStateInput = Schema.Struct({});
export type OrchestrationGetCurrentStateInput = typeof OrchestrationGetCurrentStateInput.Type;
export const OrchestrationGetCurrentStateResult = OrchestrationReadModel;
export type OrchestrationGetCurrentStateResult = typeof OrchestrationGetCurrentStateResult.Type;

export const OrchestrationListProjectsInput = Schema.Struct({});
export type OrchestrationListProjectsInput = typeof OrchestrationListProjectsInput.Type;
export const OrchestrationListProjectsResult = Schema.Array(OrchestrationProjectSummary);
export type OrchestrationListProjectsResult = typeof OrchestrationListProjectsResult.Type;

export const OrchestrationGetProjectByWorkspaceInput = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
});
export type OrchestrationGetProjectByWorkspaceInput =
  typeof OrchestrationGetProjectByWorkspaceInput.Type;
export const OrchestrationGetProjectByWorkspaceResult = Schema.NullOr(OrchestrationProjectSummary);
export type OrchestrationGetProjectByWorkspaceResult =
  typeof OrchestrationGetProjectByWorkspaceResult.Type;

export const OrchestrationGetProjectByIdInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestrationGetProjectByIdInput = typeof OrchestrationGetProjectByIdInput.Type;
export const OrchestrationGetProjectByIdResult = Schema.NullOr(OrchestrationProjectSummary);
export type OrchestrationGetProjectByIdResult = typeof OrchestrationGetProjectByIdResult.Type;

export const OrchestrationListProjectThreadsInput = Schema.Struct({
  projectId: ProjectId,
  includeArchived: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  includeDeleted: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type OrchestrationListProjectThreadsInput = typeof OrchestrationListProjectThreadsInput.Type;
export const OrchestrationListProjectThreadsResult = Schema.Array(OrchestrationThreadSummary);
export type OrchestrationListProjectThreadsResult =
  typeof OrchestrationListProjectThreadsResult.Type;

export const OrchestrationGetThreadByIdInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationGetThreadByIdInput = typeof OrchestrationGetThreadByIdInput.Type;
export const OrchestrationGetThreadByIdResult = Schema.NullOr(OrchestrationThreadSummary);
export type OrchestrationGetThreadByIdResult = typeof OrchestrationGetThreadByIdResult.Type;

export const OrchestrationListSessionThreadsInput = Schema.Struct({
  rootThreadId: ThreadId,
  includeArchived: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  includeDeleted: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type OrchestrationListSessionThreadsInput = typeof OrchestrationListSessionThreadsInput.Type;
export const OrchestrationListSessionThreadsResult = Schema.Array(OrchestrationThreadSummary);
export type OrchestrationListSessionThreadsResult =
  typeof OrchestrationListSessionThreadsResult.Type;

const OrchestrationPageLimit = NonNegativeInt.check(Schema.isLessThanOrEqualTo(1000)).pipe(
  Schema.withDecodingDefault(() => 250),
);

export const OrchestrationListThreadMessagesInput = Schema.Struct({
  threadId: ThreadId,
  limit: OrchestrationPageLimit,
  beforeCreatedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationListThreadMessagesInput = typeof OrchestrationListThreadMessagesInput.Type;
export const OrchestrationListThreadMessagesResult = Schema.Array(OrchestrationMessage);
export type OrchestrationListThreadMessagesResult =
  typeof OrchestrationListThreadMessagesResult.Type;

export const OrchestrationListThreadActivitiesInput = Schema.Struct({
  threadId: ThreadId,
  limit: OrchestrationPageLimit,
  beforeSequence: Schema.optional(NonNegativeInt),
});
export type OrchestrationListThreadActivitiesInput =
  typeof OrchestrationListThreadActivitiesInput.Type;
export const OrchestrationListThreadActivitiesResult = Schema.Array(OrchestrationThreadActivity);
export type OrchestrationListThreadActivitiesResult =
  typeof OrchestrationListThreadActivitiesResult.Type;

export const OrchestrationListThreadSessionsInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationListThreadSessionsInput = typeof OrchestrationListThreadSessionsInput.Type;
export const OrchestrationListThreadSessionsResult = Schema.Array(OrchestrationSession);
export type OrchestrationListThreadSessionsResult =
  typeof OrchestrationListThreadSessionsResult.Type;

export const OrchestrationListOrchestratorWakesInput = Schema.Struct({
  orchestratorThreadId: ThreadId,
  limit: OrchestrationPageLimit,
});
export type OrchestrationListOrchestratorWakesInput =
  typeof OrchestrationListOrchestratorWakesInput.Type;
export const OrchestrationListOrchestratorWakesResult = Schema.Array(OrchestratorWakeItem);
export type OrchestrationListOrchestratorWakesResult =
  typeof OrchestrationListOrchestratorWakesResult.Type;

export const OrchestrationDryRunSkippedEffect = Schema.Literals([
  "attachments.persist",
  "project-hooks.before-prompt",
]);
export type OrchestrationDryRunSkippedEffect = typeof OrchestrationDryRunSkippedEffect.Type;

export const OrchestrationDryRunResult = Schema.Struct({
  currentSequence: NonNegativeInt,
  finalSequence: NonNegativeInt,
  normalizedCommand: OrchestrationCommand,
  events: Schema.Array(OrchestrationEvent),
  skippedEffects: Schema.Array(OrchestrationDryRunSkippedEffect),
});
export type OrchestrationDryRunResult = typeof OrchestrationDryRunResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({ threadId: ThreadId }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFileDiffInput = Schema.Struct({
  threadId: ThreadId,
  path: TrimmedNonEmptyString,
  fromTurnCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);
export type OrchestrationGetFileDiffInput = typeof OrchestrationGetFileDiffInput.Type;

export const OrchestrationGetFileDiffResult = ThreadFileDiff;
export type OrchestrationGetFileDiffResult = typeof OrchestrationGetFileDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationRpcSchemas = {
  getBootstrapSummary: {
    input: OrchestrationGetBootstrapSummaryInput,
    output: OrchestrationGetBootstrapSummaryResult,
  },
  getSnapshot: {
    input: OrchestrationGetSnapshotInput,
    output: OrchestrationGetSnapshotResult,
  },
  getReadiness: {
    input: OrchestrationGetReadinessInput,
    output: OrchestrationGetReadinessResult,
  },
  getCurrentState: {
    input: OrchestrationGetCurrentStateInput,
    output: OrchestrationGetCurrentStateResult,
  },
  listProjects: {
    input: OrchestrationListProjectsInput,
    output: OrchestrationListProjectsResult,
  },
  getProjectById: {
    input: OrchestrationGetProjectByIdInput,
    output: OrchestrationGetProjectByIdResult,
  },
  getProjectByWorkspace: {
    input: OrchestrationGetProjectByWorkspaceInput,
    output: OrchestrationGetProjectByWorkspaceResult,
  },
  listProjectThreads: {
    input: OrchestrationListProjectThreadsInput,
    output: OrchestrationListProjectThreadsResult,
  },
  getThreadById: {
    input: OrchestrationGetThreadByIdInput,
    output: OrchestrationGetThreadByIdResult,
  },
  listSessionThreads: {
    input: OrchestrationListSessionThreadsInput,
    output: OrchestrationListSessionThreadsResult,
  },
  listThreadMessages: {
    input: OrchestrationListThreadMessagesInput,
    output: OrchestrationListThreadMessagesResult,
  },
  listThreadActivities: {
    input: OrchestrationListThreadActivitiesInput,
    output: OrchestrationListThreadActivitiesResult,
  },
  listThreadSessions: {
    input: OrchestrationListThreadSessionsInput,
    output: OrchestrationListThreadSessionsResult,
  },
  listOrchestratorWakes: {
    input: OrchestrationListOrchestratorWakesInput,
    output: OrchestrationListOrchestratorWakesResult,
  },
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  dryRunCommand: {
    input: ClientOrchestrationCommand,
    output: OrchestrationDryRunResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFileDiff: {
    input: OrchestrationGetFileDiffInput,
    output: OrchestrationGetFileDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
} as const;
