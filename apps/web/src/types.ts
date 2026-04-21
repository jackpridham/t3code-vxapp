import type {
  OrchestrationCtoAttentionItem,
  ModelSelection,
  OrchestrationLatestTurn,
  OrchestrationProgram,
  OrchestrationProgramNotification,
  OrchestrationProposedPlanId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  OrchestrationThreadSnapshotCoverage,
  ProjectHook as ContractProjectHook,
  ProjectScript as ContractProjectScript,
  ThreadId,
  ProjectId,
  TurnId,
  MessageId,
  ProviderKind,
  CheckpointRef,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectHook = ContractProjectHook;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

/** A file change persisted against the thread, surviving commits. */
export interface PersistedFileChange {
  /** Relative file path. */
  path: string;
  /** Change kind: "added" | "modified" | "deleted" | "renamed" | undefined */
  kind?: string | undefined;
  /** Total insertions for this file across all turns. */
  totalInsertions: number;
  /** Total deletions for this file across all turns. */
  totalDeletions: number;
  /** TurnId of the first turn that changed this file. */
  firstTurnId: string;
  /** TurnId of the most recent turn that changed this file. */
  lastTurnId: string;
}

export type ProjectKind = "project" | "orchestrator" | "executive";

export type Program = OrchestrationProgram;
export type ProgramNotification = OrchestrationProgramNotification;
export type CtoAttentionItem = OrchestrationCtoAttentionItem;

export interface Project {
  id: ProjectId;
  name: string;
  cwd: string;
  kind?: ProjectKind | undefined;
  sidebarParentProjectId?: ProjectId | null | undefined;
  currentSessionRootThreadId?: ThreadId | null | undefined;
  defaultModelSelection: ModelSelection | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
  hooks: ProjectHook[];
}

export interface Thread {
  id: ThreadId;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  labels?: string[] | undefined;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
  branch: string | null;
  worktreePath: string | null;
  turnDiffSummaries: TurnDiffSummary[];
  /** Cumulative file changes, persisted across commits. Built from turnDiffSummaries. */
  persistedFileChanges: PersistedFileChange[];
  activities: OrchestrationThreadActivity[];
  snapshotCoverage?: OrchestrationThreadSnapshotCoverage | undefined;
  // Lineage metadata — set when thread is spawned by an orchestrator
  orchestratorProjectId?: string | undefined;
  orchestratorThreadId?: string | undefined;
  parentThreadId?: string | undefined;
  spawnRole?: "orchestrator" | "worker" | "supervisor" | undefined;
  spawnedBy?: string | undefined;
  workflowId?: string | undefined;
  programId?: string | undefined;
  executiveProjectId?: string | undefined;
  executiveThreadId?: string | undefined;
  sessionWorkerThreadCount?: number | undefined;
}

export interface ThreadSession {
  provider: ProviderKind;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
