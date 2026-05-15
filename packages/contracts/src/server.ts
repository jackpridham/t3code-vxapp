import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import { GetAgentRuntimeSnapshotInput, GetAgentRuntimeSnapshotResult } from "./agentRuntime";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import {
  OrchestrationLatestTurn,
  OrchestrationProgramNotificationSeverity,
  OrchestrationProgramStatus,
  OrchestrationSession,
  ProviderKind,
} from "./orchestration";
import { ServerSettings } from "./settings";
import { GetWorkerRuntimeSnapshotInput, GetWorkerRuntimeSnapshotResult } from "./workerRuntime";
import { ProgramId, ProjectId, ThreadId } from "./baseSchemas";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

const ServerProviders = Schema.Array(ServerProvider);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

export const VortexAppProject = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  display_name: TrimmedNonEmptyString,
  repo_url: TrimmedNonEmptyString,
  target_id: TrimmedNonEmptyString,
  installed: Schema.Boolean,
});
export type VortexAppProject = typeof VortexAppProject.Type;

export const VortexAppsList = Schema.Struct({
  scanned_at: IsoDateTime,
  work_dir: TrimmedNonEmptyString,
  repo_filter: Schema.NullOr(Schema.String),
  count: NonNegativeInt,
  projects: Schema.Array(VortexAppProject),
});
export type VortexAppsList = typeof VortexAppsList.Type;

export const ServerCacheEntryMeta = Schema.Struct({
  key: TrimmedNonEmptyString,
  refreshed_at: IsoDateTime,
  expires_at: IsoDateTime,
  hit: Schema.Boolean,
});
export type ServerCacheEntryMeta = typeof ServerCacheEntryMeta.Type;

export const ServerListVortexAppsResult = Schema.Struct({
  catalog: VortexAppsList,
  cache: ServerCacheEntryMeta,
});
export type ServerListVortexAppsResult = typeof ServerListVortexAppsResult.Type;

export const ServerListVortexAppArtifactsInput = Schema.Struct({
  target_id: TrimmedNonEmptyString,
  includeArchived: Schema.optional(Schema.Boolean),
});
export type ServerListVortexAppArtifactsInput = typeof ServerListVortexAppArtifactsInput.Type;

export const VortexAppArtifact = Schema.Record(Schema.String, Schema.Unknown);
export type VortexAppArtifact = typeof VortexAppArtifact.Type;

export const ServerListVortexAppArtifactsResult = Schema.Struct({
  target_id: TrimmedNonEmptyString,
  fetched_at: IsoDateTime,
  total_results: NonNegativeInt,
  artifacts: Schema.Array(VortexAppArtifact),
});
export type ServerListVortexAppArtifactsResult = typeof ServerListVortexAppArtifactsResult.Type;

export const ServerGetWorkerRuntimeSnapshotInput = GetWorkerRuntimeSnapshotInput;
export type ServerGetWorkerRuntimeSnapshotInput = typeof ServerGetWorkerRuntimeSnapshotInput.Type;

export const ServerGetWorkerRuntimeSnapshotResult = GetWorkerRuntimeSnapshotResult;
export type ServerGetWorkerRuntimeSnapshotResult = typeof ServerGetWorkerRuntimeSnapshotResult.Type;

export const ServerGetAgentRuntimeSnapshotInput = GetAgentRuntimeSnapshotInput;
export type ServerGetAgentRuntimeSnapshotInput = typeof ServerGetAgentRuntimeSnapshotInput.Type;

export const ServerGetAgentRuntimeSnapshotResult = GetAgentRuntimeSnapshotResult;
export type ServerGetAgentRuntimeSnapshotResult = typeof ServerGetAgentRuntimeSnapshotResult.Type;

export const ServerGetAgentsVxappSidebarGraphInput = Schema.Struct({});
export type ServerGetAgentsVxappSidebarGraphInput =
  typeof ServerGetAgentsVxappSidebarGraphInput.Type;

export const ServerAgentsVxappSidebarGraphSource = Schema.Literals(["sqlite", "unavailable"]);
export type ServerAgentsVxappSidebarGraphSource = typeof ServerAgentsVxappSidebarGraphSource.Type;

const JsonValue: Schema.Schema<unknown> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Array(JsonValue),
    Schema.Record(Schema.String, JsonValue),
  ]),
);

const JsonRecord = Schema.Record(Schema.String, JsonValue);

export const ServerAgentsVxappSidebarThreadLink = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  workspaceRoot: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  roleSession: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        role: Schema.Literals(["cto", "jasper"]),
        sessionId: Schema.NullOr(TrimmedNonEmptyString),
        workspacePath: Schema.NullOr(TrimmedNonEmptyString),
      }),
    ),
  ),
  title: Schema.NullOr(Schema.String),
  spawnRole: Schema.NullOr(TrimmedNonEmptyString),
  spawnedBy: Schema.NullOr(TrimmedNonEmptyString),
  parentThreadId: Schema.NullOr(ThreadId),
  workflowId: Schema.NullOr(TrimmedNonEmptyString),
  programId: Schema.NullOr(ProgramId),
  executiveProjectId: Schema.NullOr(ProjectId),
  executiveThreadId: Schema.NullOr(ThreadId),
  orchestratorThreadId: Schema.NullOr(ThreadId),
  labels: Schema.Array(TrimmedNonEmptyString),
  session: Schema.NullOr(OrchestrationSession),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  metadata: Schema.NullOr(JsonRecord),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ServerAgentsVxappSidebarThreadLink = typeof ServerAgentsVxappSidebarThreadLink.Type;

export const ServerAgentsVxappSidebarWake = Schema.Struct({
  wakeId: TrimmedNonEmptyString,
  orchestratorThreadId: ThreadId,
  programId: Schema.NullOr(ProgramId),
  state: TrimmedNonEmptyString,
  reason: Schema.NullOr(TrimmedNonEmptyString),
  payload: Schema.NullOr(JsonRecord),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime),
});
export type ServerAgentsVxappSidebarWake = typeof ServerAgentsVxappSidebarWake.Type;

export const ServerAgentsVxappSidebarWatchProjection = Schema.Struct({
  programId: ProgramId,
  enabled: Schema.Boolean,
  classification: Schema.NullOr(TrimmedNonEmptyString),
  reason: Schema.NullOr(Schema.String),
  signature: Schema.NullOr(TrimmedNonEmptyString),
  suppression: Schema.NullOr(JsonRecord),
  metadata: Schema.NullOr(JsonRecord),
  lastEvaluatedAt: Schema.NullOr(IsoDateTime),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ServerAgentsVxappSidebarWatchProjection =
  typeof ServerAgentsVxappSidebarWatchProjection.Type;

export const ServerAgentsVxappSidebarProgramNotification = Schema.Struct({
  notificationId: TrimmedNonEmptyString,
  programId: Schema.NullOr(ProgramId),
  executiveProjectId: Schema.NullOr(ProjectId),
  executiveThreadId: Schema.NullOr(ThreadId),
  orchestratorThreadId: Schema.NullOr(ThreadId),
  kind: TrimmedNonEmptyString,
  severity: OrchestrationProgramNotificationSeverity,
  summary: TrimmedNonEmptyString,
  evidence: Schema.NullOr(JsonRecord),
  state: TrimmedNonEmptyString,
  queuedAt: Schema.NullOr(IsoDateTime),
  deliveredAt: Schema.NullOr(IsoDateTime),
  consumedAt: Schema.NullOr(IsoDateTime),
  droppedAt: Schema.NullOr(IsoDateTime),
  consumeReason: Schema.NullOr(Schema.String),
  dropReason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ServerAgentsVxappSidebarProgramNotification =
  typeof ServerAgentsVxappSidebarProgramNotification.Type;

export const ServerAgentsVxappSidebarAttentionItem = Schema.Struct({
  attentionId: TrimmedNonEmptyString,
  attentionKey: Schema.NullOr(TrimmedNonEmptyString),
  notificationId: Schema.NullOr(TrimmedNonEmptyString),
  programId: Schema.NullOr(ProgramId),
  executiveProjectId: Schema.NullOr(ProjectId),
  executiveThreadId: Schema.NullOr(ThreadId),
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceRole: Schema.NullOr(TrimmedNonEmptyString),
  kind: TrimmedNonEmptyString,
  severity: OrchestrationProgramNotificationSeverity,
  summary: TrimmedNonEmptyString,
  evidence: Schema.NullOr(JsonRecord),
  state: TrimmedNonEmptyString,
  queuedAt: Schema.NullOr(IsoDateTime),
  acknowledgedAt: Schema.NullOr(IsoDateTime),
  resolvedAt: Schema.NullOr(IsoDateTime),
  droppedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ServerAgentsVxappSidebarAttentionItem =
  typeof ServerAgentsVxappSidebarAttentionItem.Type;

export const ServerAgentsVxappSidebarMirrorDiagnostics = Schema.Struct({
  missingProjectIds: Schema.Array(ProjectId),
  missingThreadIds: Schema.Array(ThreadId),
  staleMirror: Schema.Boolean,
});
export type ServerAgentsVxappSidebarMirrorDiagnostics =
  typeof ServerAgentsVxappSidebarMirrorDiagnostics.Type;

export const ServerGetAgentsVxappSidebarGraphResult = Schema.Struct({
  source: ServerAgentsVxappSidebarGraphSource,
  dbPath: Schema.NullOr(TrimmedNonEmptyString),
  fallbackReason: Schema.NullOr(Schema.String),
  threadLinks: Schema.Array(ServerAgentsVxappSidebarThreadLink),
  openWakes: Schema.Array(ServerAgentsVxappSidebarWake),
  watchProjections: Schema.Array(ServerAgentsVxappSidebarWatchProjection),
  notifications: Schema.Array(ServerAgentsVxappSidebarProgramNotification),
  attentionItems: Schema.Array(ServerAgentsVxappSidebarAttentionItem),
  mirrorDiagnostics: ServerAgentsVxappSidebarMirrorDiagnostics,
});
export type ServerGetAgentsVxappSidebarGraphResult =
  typeof ServerGetAgentsVxappSidebarGraphResult.Type;

export const ServerAgentsVxappProgramSnapshot = Schema.Struct({
  id: ProgramId,
  title: TrimmedNonEmptyString,
  objective: Schema.NullOr(Schema.String),
  status: OrchestrationProgramStatus,
  baseStatus: Schema.NullOr(TrimmedNonEmptyString),
  currentStatus: Schema.NullOr(TrimmedNonEmptyString),
  executiveProjectId: Schema.NullOr(ProjectId),
  executiveThreadId: Schema.NullOr(ThreadId),
  currentOrchestratorThreadId: Schema.NullOr(ThreadId),
  metadata: Schema.NullOr(JsonRecord),
  closeout: Schema.NullOr(JsonRecord),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ServerAgentsVxappProgramSnapshot = typeof ServerAgentsVxappProgramSnapshot.Type;

export const ServerAgentsVxappTodoPlanLink = Schema.Struct({
  repo: TrimmedNonEmptyString,
  planKey: TrimmedNonEmptyString,
  phase: Schema.NullOr(Schema.String),
  step: Schema.NullOr(Schema.String),
  linkedAt: Schema.NullOr(IsoDateTime),
});
export type ServerAgentsVxappTodoPlanLink = typeof ServerAgentsVxappTodoPlanLink.Type;

export const ServerAgentsVxappTodoSnapshot = Schema.Struct({
  todoId: TrimmedNonEmptyString,
  agent: TrimmedNonEmptyString,
  programId: Schema.NullOr(ProgramId),
  title: TrimmedNonEmptyString,
  summary: Schema.NullOr(Schema.String),
  nextAction: Schema.NullOr(Schema.String),
  status: TrimmedNonEmptyString,
  priority: TrimmedNonEmptyString,
  filePath: Schema.NullOr(TrimmedNonEmptyString),
  owner: Schema.NullOr(JsonRecord),
  planLinks: Schema.Array(ServerAgentsVxappTodoPlanLink),
  notes: Schema.Array(JsonValue),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ServerAgentsVxappTodoSnapshot = typeof ServerAgentsVxappTodoSnapshot.Type;

export const ServerAgentsVxappCurrentTodoProjection = Schema.Struct({
  agent: TrimmedNonEmptyString,
  programId: ProgramId,
  todoId: TrimmedNonEmptyString,
  ambiguity: Schema.NullOr(JsonRecord),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ServerAgentsVxappCurrentTodoProjection =
  typeof ServerAgentsVxappCurrentTodoProjection.Type;

export const ServerGetAgentsVxappControlPlaneSnapshotInput = Schema.Struct({});
export type ServerGetAgentsVxappControlPlaneSnapshotInput =
  typeof ServerGetAgentsVxappControlPlaneSnapshotInput.Type;

export const ServerGetAgentsVxappControlPlaneSnapshotResult = Schema.Struct({
  fetchedAt: IsoDateTime,
  dbPath: TrimmedNonEmptyString,
  todoRootPath: TrimmedNonEmptyString,
  agents: Schema.Array(TrimmedNonEmptyString),
  programs: Schema.Array(ServerAgentsVxappProgramSnapshot),
  todos: Schema.Array(ServerAgentsVxappTodoSnapshot),
  currentTodos: Schema.Array(ServerAgentsVxappCurrentTodoProjection),
});
export type ServerGetAgentsVxappControlPlaneSnapshotResult =
  typeof ServerGetAgentsVxappControlPlaneSnapshotResult.Type;

export const ServerAgentsVxappTodoPlanLinkInput = Schema.Struct({
  repo: TrimmedNonEmptyString,
  planKey: TrimmedNonEmptyString,
  phase: Schema.optional(Schema.NullOr(Schema.String)),
  step: Schema.optional(Schema.NullOr(Schema.String)),
});
export type ServerAgentsVxappTodoPlanLinkInput = typeof ServerAgentsVxappTodoPlanLinkInput.Type;

export const ServerCreateAgentsVxappProgramInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  objective: Schema.optional(Schema.String),
  executiveProjectId: ProjectId,
  executiveThreadId: ThreadId,
  currentOrchestratorThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  status: Schema.optional(OrchestrationProgramStatus),
  scope: Schema.optional(JsonRecord),
});
export type ServerCreateAgentsVxappProgramInput = typeof ServerCreateAgentsVxappProgramInput.Type;

export const ServerUpdateAgentsVxappProgramInput = Schema.Struct({
  programId: ProgramId,
  title: Schema.optional(Schema.String),
  objective: Schema.optional(Schema.String),
  executiveProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  executiveThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  currentOrchestratorThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  clearCurrentOrchestratorThreadId: Schema.optional(Schema.Boolean),
  scope: Schema.optional(JsonRecord),
});
export type ServerUpdateAgentsVxappProgramInput = typeof ServerUpdateAgentsVxappProgramInput.Type;

export const ServerDeleteAgentsVxappProgramInput = Schema.Struct({
  programId: ProgramId,
});
export type ServerDeleteAgentsVxappProgramInput = typeof ServerDeleteAgentsVxappProgramInput.Type;

export const ServerSetAgentsVxappProgramLifecycleInput = Schema.Struct({
  programId: ProgramId,
  action: Schema.Literals(["set-status", "founder-review-ready", "complete", "cancel"]),
  nextStatus: Schema.optional(OrchestrationProgramStatus),
  reason: Schema.optional(Schema.String),
  supersededByProgramId: Schema.optional(Schema.NullOr(ProgramId)),
});
export type ServerSetAgentsVxappProgramLifecycleInput =
  typeof ServerSetAgentsVxappProgramLifecycleInput.Type;

export const ServerCreateAgentsVxappTodoInput = Schema.Struct({
  agent: TrimmedNonEmptyString,
  todoId: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  programId: Schema.optional(Schema.NullOr(ProgramId)),
  summary: Schema.optional(Schema.String),
  nextAction: Schema.optional(Schema.String),
  status: Schema.optional(TrimmedNonEmptyString),
  priority: Schema.optional(TrimmedNonEmptyString),
  planLinks: Schema.optional(Schema.Array(ServerAgentsVxappTodoPlanLinkInput)),
});
export type ServerCreateAgentsVxappTodoInput = typeof ServerCreateAgentsVxappTodoInput.Type;

export const ServerUpdateAgentsVxappTodoInput = Schema.Struct({
  agent: TrimmedNonEmptyString,
  todoId: TrimmedNonEmptyString,
  title: Schema.optional(Schema.String),
  programId: Schema.optional(Schema.NullOr(ProgramId)),
  summary: Schema.optional(Schema.String),
  nextAction: Schema.optional(Schema.String),
  status: Schema.optional(TrimmedNonEmptyString),
  priority: Schema.optional(TrimmedNonEmptyString),
  planLinks: Schema.optional(Schema.Array(ServerAgentsVxappTodoPlanLinkInput)),
});
export type ServerUpdateAgentsVxappTodoInput = typeof ServerUpdateAgentsVxappTodoInput.Type;

export const ServerDeleteAgentsVxappTodoInput = Schema.Struct({
  agent: TrimmedNonEmptyString,
  todoId: TrimmedNonEmptyString,
});
export type ServerDeleteAgentsVxappTodoInput = typeof ServerDeleteAgentsVxappTodoInput.Type;

export const ServerAgentsVxappOwnerMutationResult = JsonRecord;
export type ServerAgentsVxappOwnerMutationResult = typeof ServerAgentsVxappOwnerMutationResult.Type;
