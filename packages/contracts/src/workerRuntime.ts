import { Schema } from "effect";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

const WorkerRuntimeStringList = Schema.Array(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(() => []),
);

const WorkerRuntimeRecord = Schema.Record(Schema.String, Schema.Unknown);

export const WorkerRuntimeContextPlan = Schema.Struct({
  schema_version: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  taskClass: TrimmedNonEmptyString,
  contextMode: TrimmedNonEmptyString,
  closeoutAuthority: TrimmedNonEmptyString,
  validationProfile: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
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
  workspace: Schema.optional(TrimmedNonEmptyString),
  runtimeDir: Schema.optional(TrimmedNonEmptyString),
  skillsDir: Schema.optional(TrimmedNonEmptyString),
  agentsSkillsDir: Schema.optional(TrimmedNonEmptyString),
  repoClaude: Schema.optional(TrimmedNonEmptyString),
  legacyGlobalSkills: Schema.optional(Schema.Boolean),
});
export type WorkerRuntimeContextPlan = typeof WorkerRuntimeContextPlan.Type;

export const WorkerRuntimeDispatchContract = Schema.Struct({
  schema_version: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  taskClass: TrimmedNonEmptyString,
  contextMode: TrimmedNonEmptyString,
  closeoutAuthority: TrimmedNonEmptyString,
  validationProfile: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
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
  workspace: Schema.optional(TrimmedNonEmptyString),
  runtimeFiles: Schema.optional(WorkerRuntimeRecord),
});
export type WorkerRuntimeDispatchContract = typeof WorkerRuntimeDispatchContract.Type;

export const WorkerRuntimeInstalledPack = Schema.Struct({
  id: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  link: TrimmedNonEmptyString,
  manifest: WorkerRuntimeRecord,
});
export type WorkerRuntimeInstalledPack = typeof WorkerRuntimeInstalledPack.Type;

export const WorkerRuntimeInstalledPacks = Schema.Struct({
  schema_version: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  taskClass: TrimmedNonEmptyString,
  contextMode: TrimmedNonEmptyString,
  closeoutAuthority: TrimmedNonEmptyString,
  workspace: Schema.optional(TrimmedNonEmptyString),
  runtimeDir: Schema.optional(TrimmedNonEmptyString),
  skillsDir: Schema.optional(TrimmedNonEmptyString),
  agentsSkillsDir: Schema.optional(TrimmedNonEmptyString),
  packs: Schema.Array(WorkerRuntimeInstalledPack).pipe(Schema.withDecodingDefault(() => [])),
});
export type WorkerRuntimeInstalledPacks = typeof WorkerRuntimeInstalledPacks.Type;

export const WorkerRuntimeAuditFinding = Schema.Struct({
  severity: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  code: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  kind: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  detail: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
});
export type WorkerRuntimeAuditFinding = typeof WorkerRuntimeAuditFinding.Type;

export const WorkerRuntimeInstructionStackAudit = Schema.Struct({
  schema_version: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  workspace: Schema.optional(TrimmedNonEmptyString),
  status: TrimmedNonEmptyString,
  findings: Schema.optional(Schema.Array(WorkerRuntimeRecord)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  packAudit: Schema.optional(WorkerRuntimeRecord).pipe(Schema.withDecodingDefault(() => ({}))),
});
export type WorkerRuntimeInstructionStackAudit = typeof WorkerRuntimeInstructionStackAudit.Type;

export const WorkerRuntimeSourceFileStatus = Schema.Literals([
  "loaded",
  "missing",
  "invalid-json",
  "schema-error",
]);
export type WorkerRuntimeSourceFileStatus = typeof WorkerRuntimeSourceFileStatus.Type;

export const WorkerRuntimeSourceFile = Schema.Struct({
  fileName: TrimmedNonEmptyString,
  absolutePath: TrimmedNonEmptyString,
  status: WorkerRuntimeSourceFileStatus,
  detail: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
});
export type WorkerRuntimeSourceFile = typeof WorkerRuntimeSourceFile.Type;

export const WorkerRuntimeSourceFiles = Schema.Struct({
  contextPlan: WorkerRuntimeSourceFile,
  dispatchContract: WorkerRuntimeSourceFile,
  installedPacks: WorkerRuntimeSourceFile,
  instructionStackAudit: WorkerRuntimeSourceFile,
});
export type WorkerRuntimeSourceFiles = typeof WorkerRuntimeSourceFiles.Type;

export const WorkerRuntimeAuditStatus = Schema.Literals(["clean", "warning", "error", "missing"]);
export type WorkerRuntimeAuditStatus = typeof WorkerRuntimeAuditStatus.Type;

export const WorkerRuntimePackSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  link: TrimmedNonEmptyString,
  name: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  type: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  scope: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  repo: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  version: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  description: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  mountMode: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  localNumber: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(() => null)),
  allowedTaskClasses: WorkerRuntimeStringList,
  grants: WorkerRuntimeStringList,
  forbids: WorkerRuntimeStringList,
  requires: WorkerRuntimeStringList,
  conflictsWith: WorkerRuntimeStringList,
  defaultContextModes: WorkerRuntimeStringList,
});
export type WorkerRuntimePackSummary = typeof WorkerRuntimePackSummary.Type;

export const WorkerRuntimeSummary = Schema.Struct({
  repo: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  taskClass: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  contextMode: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  closeoutAuthority: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  validationProfile: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  selectedPacks: WorkerRuntimeStringList,
  allowedCapabilities: WorkerRuntimeStringList,
  forbiddenCapabilities: WorkerRuntimeStringList,
  conflicts: WorkerRuntimeStringList,
  warnings: WorkerRuntimeStringList,
  repoClaude: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  legacyGlobalSkills: Schema.NullOr(Schema.Boolean).pipe(Schema.withDecodingDefault(() => null)),
  workspace: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  runtimeDir: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  skillsDir: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  agentsSkillsDir: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  auditStatus: WorkerRuntimeAuditStatus,
  auditFindings: Schema.Array(WorkerRuntimeAuditFinding).pipe(Schema.withDecodingDefault(() => [])),
  packAuditStatus: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  packAuditIssueCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  packCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
});
export type WorkerRuntimeSummary = typeof WorkerRuntimeSummary.Type;

export const WorkerRuntimeRawFiles = Schema.Struct({
  contextPlan: Schema.NullOr(WorkerRuntimeContextPlan).pipe(Schema.withDecodingDefault(() => null)),
  dispatchContract: Schema.NullOr(WorkerRuntimeDispatchContract).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  installedPacks: Schema.NullOr(WorkerRuntimeInstalledPacks).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  instructionStackAudit: Schema.NullOr(WorkerRuntimeInstructionStackAudit).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type WorkerRuntimeRawFiles = typeof WorkerRuntimeRawFiles.Type;

export const WorkerRuntimeSnapshot = Schema.Struct({
  threadId: ThreadId,
  worktreePath: TrimmedNonEmptyString,
  runtimeDir: TrimmedNonEmptyString,
  sourceFiles: WorkerRuntimeSourceFiles,
  summary: WorkerRuntimeSummary,
  packs: Schema.Array(WorkerRuntimePackSummary).pipe(Schema.withDecodingDefault(() => [])),
  raw: WorkerRuntimeRawFiles,
});
export type WorkerRuntimeSnapshot = typeof WorkerRuntimeSnapshot.Type;

export const GetWorkerRuntimeSnapshotInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetWorkerRuntimeSnapshotInput = typeof GetWorkerRuntimeSnapshotInput.Type;

export const GetWorkerRuntimeSnapshotResult = WorkerRuntimeSnapshot;
export type GetWorkerRuntimeSnapshotResult = typeof GetWorkerRuntimeSnapshotResult.Type;
