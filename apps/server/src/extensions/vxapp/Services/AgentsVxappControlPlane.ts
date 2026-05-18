import type {
  ProgramId,
  ProjectId,
  ServerAgentsVxappOwnerMutationResult,
  ServerCreateAgentsVxappProgramInput,
  ServerCreateAgentsVxappTodoInput,
  ServerDeleteAgentsVxappProgramInput,
  ServerDeleteAgentsVxappTodoInput,
  ServerGetAgentsVxappControlPlaneSnapshotInput,
  ServerGetAgentsVxappControlPlaneSnapshotResult,
  ServerSetAgentsVxappProgramLifecycleInput,
  ThreadId,
  ServerUpdateAgentsVxappProgramInput,
  ServerUpdateAgentsVxappTodoInput,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

type JsonRecord = Record<string, unknown>;

export class AgentsVxappControlPlaneError extends Schema.TaggedErrorClass<AgentsVxappControlPlaneError>()(
  "AgentsVxappControlPlaneError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
    ownerCommand: Schema.optional(Schema.String),
    authoritySurface: Schema.optional(Schema.String),
    ownerErrorCode: Schema.optional(Schema.NullOr(Schema.String)),
    authorityStore: Schema.optional(Schema.NullOr(Schema.String)),
    authoritySource: Schema.optional(Schema.NullOr(Schema.String)),
    contractFamily: Schema.optional(Schema.NullOr(Schema.String)),
    contractVersion: Schema.optional(Schema.NullOr(Schema.String)),
    exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
    stdout: Schema.optional(Schema.String),
    stderr: Schema.optional(Schema.String),
  },
) {}

export interface AgentsVxappOwnerExportEnvelope {
  readonly authorityStore: string;
  readonly authoritySource: string;
  readonly legacyFallbackUsed: false;
}

export interface AgentsVxappOwnerProjectionAuthoritySnapshot {
  readonly contractFamily: string | null;
  readonly contractVersion: string | null;
  readonly exportPath: string;
  readonly fetchedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AgentsVxappBindingAuthorityCurrentThread extends JsonRecord {
  readonly id: string;
  readonly programId: string;
  readonly projectId: string;
}

export interface AgentsVxappBindingAuthorityProjectBinding extends JsonRecord {
  readonly currentSessionRootThreadId: string;
}

export interface AgentsVxappBindingAuthorityExport extends AgentsVxappOwnerExportEnvelope {
  readonly diagnostics: unknown;
  readonly jasper: Readonly<{
    readonly currentThread: AgentsVxappBindingAuthorityCurrentThread;
    readonly project: AgentsVxappBindingAuthorityProjectBinding;
  }> &
    JsonRecord;
}

export interface AgentsVxappProgramAuthorityExport extends AgentsVxappOwnerExportEnvelope {
  readonly action: string;
  readonly enabled: boolean;
  readonly mode: string;
}

export interface AgentsVxappNotificationSummaryExport extends AgentsVxappOwnerExportEnvelope {
  readonly notifications: ReadonlyArray<JsonRecord>;
  readonly attention: ReadonlyArray<JsonRecord>;
}

export interface AgentsVxappAttentionSummaryExport extends AgentsVxappOwnerExportEnvelope {
  readonly attention: ReadonlyArray<JsonRecord>;
  readonly resolvedAttention: ReadonlyArray<JsonRecord>;
  readonly passiveNotifications: ReadonlyArray<JsonRecord>;
}

export interface AgentsVxappWatchSummaryExport extends AgentsVxappOwnerExportEnvelope {
  readonly enabledPrograms: ReadonlyArray<string>;
  readonly state: JsonRecord;
  readonly classification: string | null;
  readonly recommendedAction: string | null;
  readonly program: JsonRecord | null;
  readonly currentOrchestratorThread: JsonRecord | null;
  readonly wakeDecision: JsonRecord | null;
}

export interface AgentsVxappProgramsProjectionProgram extends JsonRecord {
  readonly id: ProgramId;
  readonly title: string;
  readonly objective: string | null;
  readonly status: string;
  readonly executiveProjectId: ProjectId | null;
  readonly executiveThreadId: ThreadId | null;
  readonly currentOrchestratorThreadId: ThreadId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly deletedAt: string | null;
}

export interface AgentsVxappProgramsProjectionSnapshot {
  readonly programs: ReadonlyArray<AgentsVxappProgramsProjectionProgram>;
}

export interface AgentsVxappControlPlaneShape {
  readonly getBindingAuthorityExport: () => Effect.Effect<
    AgentsVxappBindingAuthorityExport,
    AgentsVxappControlPlaneError
  >;
  readonly getProgramAuthorityExport: () => Effect.Effect<
    AgentsVxappProgramAuthorityExport,
    AgentsVxappControlPlaneError
  >;
  readonly getAttentionSummaryExport: () => Effect.Effect<
    AgentsVxappAttentionSummaryExport,
    AgentsVxappControlPlaneError
  >;
  readonly getNotificationSummaryExport: () => Effect.Effect<
    AgentsVxappNotificationSummaryExport,
    AgentsVxappControlPlaneError
  >;
  readonly getWatchSummaryExport: () => Effect.Effect<
    AgentsVxappWatchSummaryExport,
    AgentsVxappControlPlaneError
  >;
  readonly getProjectionAuthoritySnapshot: () => Effect.Effect<
    AgentsVxappOwnerProjectionAuthoritySnapshot,
    AgentsVxappControlPlaneError
  >;
  readonly getProgramsProjectionSnapshot: () => Effect.Effect<
    AgentsVxappProgramsProjectionSnapshot,
    AgentsVxappControlPlaneError
  >;
  readonly getProgramsTodosSnapshot: (
    input: ServerGetAgentsVxappControlPlaneSnapshotInput,
  ) => Effect.Effect<ServerGetAgentsVxappControlPlaneSnapshotResult, AgentsVxappControlPlaneError>;
  readonly createProgram: (
    input: ServerCreateAgentsVxappProgramInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly updateProgram: (
    input: ServerUpdateAgentsVxappProgramInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly deleteProgram: (
    input: ServerDeleteAgentsVxappProgramInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly setProgramLifecycle: (
    input: ServerSetAgentsVxappProgramLifecycleInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly createTodo: (
    input: ServerCreateAgentsVxappTodoInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly updateTodo: (
    input: ServerUpdateAgentsVxappTodoInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
  readonly deleteTodo: (
    input: ServerDeleteAgentsVxappTodoInput,
  ) => Effect.Effect<ServerAgentsVxappOwnerMutationResult, AgentsVxappControlPlaneError>;
}

export class AgentsVxappControlPlane extends ServiceMap.Service<
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneShape
>()("t3/extensions/vxapp/Services/AgentsVxappControlPlane") {}
