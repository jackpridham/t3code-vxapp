import { Schema, SchemaTransformation } from "effect";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import {
  AgentsVxappRuntimeAvailability,
  AgentsVxappRuntimeReasonCode,
  AgentsVxappRuntimeTargetKind,
} from "./agentsVxappAuthority";
import {
  WorkerRuntimeAuditFinding,
  WorkerRuntimeAuditStatus,
  WorkerRuntimePackSummary,
  WorkerRuntimeSourceFileStatus,
} from "./workerRuntime";

const AgentRuntimeStringList = Schema.Array(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(() => []),
);

const openStringToDecodedSchema = <T>() =>
  TrimmedNonEmptyString.pipe(
    Schema.decodeTo(
      Schema.declare<T>((value): value is T => typeof value === "string"),
      SchemaTransformation.transform({
        decode: (value) => value as T,
        encode: (value) => value as string,
      }),
    ),
  );

export const AgentRuntimeAgentKind = AgentsVxappRuntimeTargetKind;
export type AgentRuntimeAgentKind = typeof AgentRuntimeAgentKind.Type;

export const AgentRuntimeSnapshotKind = openStringToDecodedSchema<string>();
export type AgentRuntimeSnapshotKind = typeof AgentRuntimeSnapshotKind.Type;

export const AgentRuntimeSourceFile = Schema.Struct({
  key: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  fileName: TrimmedNonEmptyString,
  absolutePath: TrimmedNonEmptyString,
  status: WorkerRuntimeSourceFileStatus,
  detail: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
});
export type AgentRuntimeSourceFile = typeof AgentRuntimeSourceFile.Type;

export const AgentRuntimeSummary = Schema.Struct({
  repo: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  role: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  profile: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  taskClass: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  contextMode: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  closeoutAuthority: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  generatedAt: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  selectedPacks: AgentRuntimeStringList,
  installedSkills: AgentRuntimeStringList,
  packCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  skillCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
});
export type AgentRuntimeSummary = typeof AgentRuntimeSummary.Type;

export const AgentRuntimeWorkspaceResolutionKind = openStringToDecodedSchema<string>();
export type AgentRuntimeWorkspaceResolutionKind = typeof AgentRuntimeWorkspaceResolutionKind.Type;

export const AgentRuntimeWorkspaceResolution = Schema.Struct({
  kind: AgentRuntimeWorkspaceResolutionKind,
  detail: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
});
export type AgentRuntimeWorkspaceResolution = typeof AgentRuntimeWorkspaceResolution.Type;

export const AgentRuntimeWorkerDetails = Schema.Struct({
  validationProfile: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  allowedCapabilities: AgentRuntimeStringList,
  forbiddenCapabilities: AgentRuntimeStringList,
  conflicts: AgentRuntimeStringList,
  warnings: AgentRuntimeStringList,
  auditStatus: WorkerRuntimeAuditStatus,
  auditFindings: Schema.Array(WorkerRuntimeAuditFinding).pipe(Schema.withDecodingDefault(() => [])),
  packAuditStatus: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  packAuditIssueCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  packs: Schema.Array(WorkerRuntimePackSummary).pipe(Schema.withDecodingDefault(() => [])),
});
export type AgentRuntimeWorkerDetails = typeof AgentRuntimeWorkerDetails.Type;

export const AgentRuntimeRoleDetails = Schema.Struct({
  selectionReason: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
});
export type AgentRuntimeRoleDetails = typeof AgentRuntimeRoleDetails.Type;

export const AgentRuntimeSnapshot = Schema.Struct({
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  agentKind: AgentRuntimeAgentKind,
  runtimeKind: AgentRuntimeSnapshotKind,
  availability: AgentsVxappRuntimeAvailability,
  reasonCode: Schema.NullOr(AgentsVxappRuntimeReasonCode).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  workspaceRoot: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  runtimeDir: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  workspaceResolution: AgentRuntimeWorkspaceResolution,
  sourceFiles: Schema.Array(AgentRuntimeSourceFile).pipe(Schema.withDecodingDefault(() => [])),
  summary: AgentRuntimeSummary,
  workerDetails: Schema.NullOr(AgentRuntimeWorkerDetails).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  roleDetails: Schema.NullOr(AgentRuntimeRoleDetails).pipe(Schema.withDecodingDefault(() => null)),
});
export type AgentRuntimeSnapshot = typeof AgentRuntimeSnapshot.Type;

export const GetAgentRuntimeSnapshotInput = Schema.Struct({
  agentKind: AgentRuntimeAgentKind,
  threadId: Schema.optional(ThreadId),
});
export type GetAgentRuntimeSnapshotInput = typeof GetAgentRuntimeSnapshotInput.Type;

export const GetAgentRuntimeSnapshotResult = AgentRuntimeSnapshot;
export type GetAgentRuntimeSnapshotResult = typeof GetAgentRuntimeSnapshotResult.Type;
