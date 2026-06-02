import { Schema, SchemaTransformation } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import {
  AgentsVxappRuntimeAvailability,
  AgentsVxappRuntimeReasonCode,
  AgentsVxappRuntimeTargetKind,
} from "./agentsVxappAuthority";

const WorkerRuntimeStringList = Schema.Array(Schema.String).pipe(
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

const WorkerRuntimeLooseString = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefault(() => null),
);

const WorkerRuntimeLooseRecord = Schema.Record(Schema.String, Schema.Unknown).pipe(
  Schema.withDecodingDefault(() => ({})),
);

export const WorkerRuntimeContextPlan = Schema.Struct({
  schema_version: Schema.String,
  repo: Schema.String,
  taskClass: Schema.String,
  contextMode: Schema.String,
  closeoutAuthority: Schema.String,
  validationProfile: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  selectedPacks: Schema.optional(WorkerRuntimeStringList).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  allowedCapabilities: Schema.optional(WorkerRuntimeStringList).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  forbiddenCapabilities: Schema.optional(WorkerRuntimeStringList).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  conflicts: Schema.optional(WorkerRuntimeStringList).pipe(Schema.withDecodingDefault(() => [])),
  warnings: Schema.optional(WorkerRuntimeStringList).pipe(Schema.withDecodingDefault(() => [])),
  workspace: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  worktreePath: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  runtimeDir: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  skillsDir: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  agentsSkillsDir: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  repoClaude: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  runtimeProfilePath: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  repoPackRoot: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  generatedSkillsPath: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  modelPolicyPath: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  legacyGlobalSkills: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  localVx: Schema.optional(WorkerRuntimeLooseRecord).pipe(Schema.withDecodingDefault(() => ({}))),
  modelPolicy: Schema.optional(WorkerRuntimeLooseRecord).pipe(
    Schema.withDecodingDefault(() => ({})),
  ),
});
export type WorkerRuntimeContextPlan = typeof WorkerRuntimeContextPlan.Type;

export const WorkerRuntimeDispatchContract = Schema.Struct({
  schema_version: Schema.String,
  repo: Schema.String,
  taskClass: Schema.String,
  contextMode: Schema.String,
  closeoutAuthority: Schema.String,
  validationProfile: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  selectedPacks: Schema.optional(WorkerRuntimeStringList).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  allowedCapabilities: Schema.optional(WorkerRuntimeStringList).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  forbiddenCapabilities: Schema.optional(WorkerRuntimeStringList).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  conflicts: Schema.optional(WorkerRuntimeStringList).pipe(Schema.withDecodingDefault(() => [])),
  warnings: Schema.optional(WorkerRuntimeStringList).pipe(Schema.withDecodingDefault(() => [])),
  workspace: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  runtimeFiles: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).pipe(
    Schema.withDecodingDefault(() => ({})),
  ),
});
export type WorkerRuntimeDispatchContract = typeof WorkerRuntimeDispatchContract.Type;

export const WorkerRuntimeInstalledPack = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  link: Schema.String,
  manifest: Schema.Record(Schema.String, Schema.Unknown),
});
export type WorkerRuntimeInstalledPack = typeof WorkerRuntimeInstalledPack.Type;

export const WorkerRuntimeInstalledPacks = Schema.Struct({
  schema_version: Schema.String,
  repo: Schema.String,
  taskClass: Schema.String,
  contextMode: Schema.String,
  closeoutAuthority: Schema.String,
  workspace: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  runtimeDir: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  skillsDir: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  agentsSkillsDir: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  packs: Schema.Array(WorkerRuntimeInstalledPack).pipe(Schema.withDecodingDefault(() => [])),
});
export type WorkerRuntimeInstalledPacks = typeof WorkerRuntimeInstalledPacks.Type;

export const WorkerRuntimeFinding = Schema.Struct({
  code: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  detail: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  path: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  runtimeFile: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  severity: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  kind: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  sourceCode: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  slug: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  evidence: Schema.optional(Schema.Unknown),
});
export type WorkerRuntimeFinding = typeof WorkerRuntimeFinding.Type;

export const WorkerRuntimeInstructionStackAudit = Schema.Struct({
  schema_version: Schema.String,
  repo: Schema.String,
  taskClass: Schema.optional(Schema.String).pipe(Schema.withDecodingDefault(() => "")),
  contextMode: Schema.optional(Schema.String).pipe(Schema.withDecodingDefault(() => "")),
  closeoutAuthority: Schema.optional(Schema.String).pipe(Schema.withDecodingDefault(() => "")),
  workspace: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  status: Schema.String,
  findings: Schema.optional(Schema.Array(WorkerRuntimeFinding)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  packAudit: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).pipe(
    Schema.withDecodingDefault(() => ({})),
  ),
});
export type WorkerRuntimeInstructionStackAudit = typeof WorkerRuntimeInstructionStackAudit.Type;

export const WorkerRuntimeSourceFileStatus = openStringToDecodedSchema<string>();
export type WorkerRuntimeSourceFileStatus = typeof WorkerRuntimeSourceFileStatus.Type;

export const WorkerRuntimeSourceFile = Schema.Struct({
  status: WorkerRuntimeSourceFileStatus,
  failureCode: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  failureMessage: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type WorkerRuntimeSourceFile = typeof WorkerRuntimeSourceFile.Type;

export const WorkerRuntimeSourceFiles = Schema.Struct({
  contextPlan: WorkerRuntimeSourceFile,
  dispatchContract: WorkerRuntimeSourceFile,
  installedPacks: WorkerRuntimeSourceFile,
});
export type WorkerRuntimeSourceFiles = typeof WorkerRuntimeSourceFiles.Type;

export const WorkerRuntimeAuditStatus = openStringToDecodedSchema<string>();
export type WorkerRuntimeAuditStatus = typeof WorkerRuntimeAuditStatus.Type;

export const WorkerRuntimePackSummary = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  link: Schema.String,
  name: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  type: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  scope: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  repo: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  version: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  description: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  mountMode: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  localNumber: Schema.NullOr(Schema.Number).pipe(Schema.withDecodingDefault(() => null)),
  allowedTaskClasses: WorkerRuntimeStringList,
  grants: WorkerRuntimeStringList,
  forbids: WorkerRuntimeStringList,
  requires: WorkerRuntimeStringList,
  conflictsWith: WorkerRuntimeStringList,
  defaultContextModes: WorkerRuntimeStringList,
});
export type WorkerRuntimePackSummary = typeof WorkerRuntimePackSummary.Type;

export const WorkerRuntimeAuditFinding = WorkerRuntimeFinding;
export type WorkerRuntimeAuditFinding = typeof WorkerRuntimeAuditFinding.Type;

export const WorkerRuntimeAudit = Schema.Struct({
  schema_version: Schema.String,
  repo: Schema.String,
  taskClass: Schema.String,
  contextMode: Schema.String,
  closeoutAuthority: Schema.String,
  workspace: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  runtimeDir: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  skillsDir: Schema.optional(WorkerRuntimeLooseString).pipe(Schema.withDecodingDefault(() => null)),
  agentsSkillsDir: Schema.optional(WorkerRuntimeLooseString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  instructionStackStatus: Schema.String,
  packAuditStatus: WorkerRuntimeAuditStatus,
  status: WorkerRuntimeAuditStatus,
  issues: Schema.optional(Schema.Array(WorkerRuntimeFinding)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type WorkerRuntimeAudit = typeof WorkerRuntimeAudit.Type;

export const WorkerRuntimeSnapshotKind = openStringToDecodedSchema<string>();
export type WorkerRuntimeSnapshotKind = typeof WorkerRuntimeSnapshotKind.Type;

export const WorkerRuntimeWorkspaceResolution = openStringToDecodedSchema<string>();
export type WorkerRuntimeWorkspaceResolution = typeof WorkerRuntimeWorkspaceResolution.Type;

export const WorkerRuntimeSnapshot = Schema.Struct({
  threadId: ThreadId,
  runtimeKind: WorkerRuntimeSnapshotKind,
  agentKind: AgentsVxappRuntimeTargetKind,
  workspace: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  availability: AgentsVxappRuntimeAvailability,
  reasonCode: Schema.NullOr(AgentsVxappRuntimeReasonCode).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  runtimeDir: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  runtimeRoot: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  stateRoot: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  workspaceResolution: WorkerRuntimeWorkspaceResolution,
  sourceFiles: WorkerRuntimeSourceFiles,
  audit: WorkerRuntimeAudit,
  contextPlan: Schema.NullOr(WorkerRuntimeContextPlan).pipe(Schema.withDecodingDefault(() => null)),
  dispatchContract: Schema.NullOr(WorkerRuntimeDispatchContract).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  installedPacks: Schema.NullOr(WorkerRuntimeInstalledPacks).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  instructionStack: WorkerRuntimeInstructionStackAudit,
  findings: Schema.Array(WorkerRuntimeFinding).pipe(Schema.withDecodingDefault(() => [])),
  issues: Schema.Array(WorkerRuntimeFinding).pipe(Schema.withDecodingDefault(() => [])),
});
export type WorkerRuntimeSnapshot = typeof WorkerRuntimeSnapshot.Type;

export const GetWorkerRuntimeSnapshotInput = Schema.Struct({
  threadId: ThreadId,
  workspace: TrimmedNonEmptyString,
});
export type GetWorkerRuntimeSnapshotInput = typeof GetWorkerRuntimeSnapshotInput.Type;

export const GetWorkerRuntimeSnapshotResult = WorkerRuntimeSnapshot;
export type GetWorkerRuntimeSnapshotResult = typeof GetWorkerRuntimeSnapshotResult.Type;
