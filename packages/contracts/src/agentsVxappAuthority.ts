import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const AgentsVxappOwnerCommand = TrimmedNonEmptyString;
export type AgentsVxappOwnerCommand = typeof AgentsVxappOwnerCommand.Type;

export const AgentsVxappJsonRecord = Schema.Record(Schema.String, Schema.Unknown);
export type AgentsVxappJsonRecord = typeof AgentsVxappJsonRecord.Type;

export const AgentsVxappDisplayDescriptor = Schema.Struct({
  label: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  tone: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  heading: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  sortKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optional(Schema.NullOr(AgentsVxappJsonRecord)),
});
export type AgentsVxappDisplayDescriptor = typeof AgentsVxappDisplayDescriptor.Type;

export const AgentsVxappAuthorityRecord = Schema.Struct({
  contractFamily: TrimmedNonEmptyString,
  contractVersion: TrimmedNonEmptyString,
  authorityStore: TrimmedNonEmptyString,
  authoritySource: TrimmedNonEmptyString,
  legacyFallbackUsed: Schema.Boolean,
  surface: TrimmedNonEmptyString,
  payload: AgentsVxappJsonRecord,
  display: AgentsVxappDisplayDescriptor,
  options: AgentsVxappJsonRecord,
});
export type AgentsVxappAuthorityRecord = typeof AgentsVxappAuthorityRecord.Type;

export const AgentsVxappOwnerErrorEnvelope = Schema.Struct({
  code: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  details: AgentsVxappJsonRecord,
});
export type AgentsVxappOwnerErrorEnvelope = typeof AgentsVxappOwnerErrorEnvelope.Type;

const AgentsVxappOwnerSuccessEnvelope = Schema.Struct({
  ok: Schema.Literal(true),
  contract_family: TrimmedNonEmptyString,
  contract_version: TrimmedNonEmptyString,
  command: AgentsVxappOwnerCommand,
  meta: AgentsVxappJsonRecord,
  result: AgentsVxappAuthorityRecord,
});

const AgentsVxappOwnerFailureEnvelope = Schema.Struct({
  ok: Schema.Literal(false),
  contract_family: TrimmedNonEmptyString,
  contract_version: TrimmedNonEmptyString,
  command: AgentsVxappOwnerCommand,
  meta: AgentsVxappJsonRecord,
  error: AgentsVxappOwnerErrorEnvelope,
});

export const AgentsVxappOwnerResultEnvelope = Schema.Union([
  AgentsVxappOwnerSuccessEnvelope,
  AgentsVxappOwnerFailureEnvelope,
]);
export type AgentsVxappOwnerResultEnvelope = typeof AgentsVxappOwnerResultEnvelope.Type;

export const AgentsVxappAuthorityEnvelope = AgentsVxappOwnerResultEnvelope;
export type AgentsVxappAuthorityEnvelope = typeof AgentsVxappAuthorityEnvelope.Type;

export const AgentsVxappSidebarAuthorityField = {
  Programs: "programs",
  Todos: "todos",
  CurrentTodos: "currentTodos",
  OwnerDiagnostics: "ownerDiagnostics",
} as const;

export const AgentsVxappSidebarProgramCardField = {
  Program: "program",
  Display: "display",
  CurrentTodo: "currentTodo",
  Executive: "executive",
  Orchestrator: "orchestrator",
  Workers: "workers",
  Notifications: "notifications",
  AttentionItems: "attentionItems",
  OpenWakes: "openWakes",
  WatchProjection: "watchProjection",
  ActiveAllocations: "activeAllocations",
  OwnerDiagnostics: "ownerDiagnostics",
} as const;

export const AgentsVxappRuntimeTargetField = {
  Kind: "kind",
  AgentKind: "agentKind",
  ThreadId: "threadId",
  Workspace: "workspace",
  Availability: "availability",
  ReasonCode: "reasonCode",
} as const;

export const AgentsVxappRuntimeTargetKindValue = {
  Executive: "executive",
  Orchestrator: "orchestrator",
  Worker: "worker",
} as const;

export const AgentsVxappRuntimeTargetKind = Schema.Literals([
  AgentsVxappRuntimeTargetKindValue.Executive,
  AgentsVxappRuntimeTargetKindValue.Orchestrator,
  AgentsVxappRuntimeTargetKindValue.Worker,
]);
export type AgentsVxappRuntimeTargetKind = typeof AgentsVxappRuntimeTargetKind.Type;

export const AgentsVxappRuntimeAvailabilityValue = {
  Inspectable: "inspectable",
  Degraded: "degraded",
  Unavailable: "unavailable",
} as const;

export const AgentsVxappRuntimeAvailability = Schema.Literals([
  AgentsVxappRuntimeAvailabilityValue.Inspectable,
  AgentsVxappRuntimeAvailabilityValue.Degraded,
  AgentsVxappRuntimeAvailabilityValue.Unavailable,
]);
export type AgentsVxappRuntimeAvailability = typeof AgentsVxappRuntimeAvailability.Type;

export const AgentsVxappRuntimeReasonCodeValue = {
  RuntimeFilesMissing: "runtime_files_missing",
  RuntimePayloadInvalid: "runtime_payload_invalid",
  RuntimeAuthorityMissing: "runtime_authority_missing",
} as const;

export const AgentsVxappRuntimeReasonCode = Schema.Literals([
  AgentsVxappRuntimeReasonCodeValue.RuntimeFilesMissing,
  AgentsVxappRuntimeReasonCodeValue.RuntimePayloadInvalid,
  AgentsVxappRuntimeReasonCodeValue.RuntimeAuthorityMissing,
]);
export type AgentsVxappRuntimeReasonCode = typeof AgentsVxappRuntimeReasonCode.Type;

export const AgentsVxappOwnerDiagnosticCodeValue = {
  CurrentTodoAuthorityMissing: "current_todo_authority_missing",
  RuntimeTargetFieldsMissing: "runtime_target_fields_missing",
  WorkerWorkspaceAuthorityMissing: "worker_workspace_authority_missing",
  ThreadAuthorityMissing: "thread_authority_missing",
  RuntimeAuthorityUnavailable: "runtime_authority_unavailable",
} as const;

export const AgentsVxappOwnerDiagnosticCode = Schema.Literals([
  AgentsVxappOwnerDiagnosticCodeValue.CurrentTodoAuthorityMissing,
  AgentsVxappOwnerDiagnosticCodeValue.RuntimeTargetFieldsMissing,
  AgentsVxappOwnerDiagnosticCodeValue.WorkerWorkspaceAuthorityMissing,
  AgentsVxappOwnerDiagnosticCodeValue.ThreadAuthorityMissing,
  AgentsVxappOwnerDiagnosticCodeValue.RuntimeAuthorityUnavailable,
]);
export type AgentsVxappOwnerDiagnosticCode = typeof AgentsVxappOwnerDiagnosticCode.Type;

export const AgentsVxappOwnerLoadStatusValue = {
  Idle: "idle",
  Loading: "loading",
  Ready: "ready",
  Error: "error",
} as const;

export const AgentsVxappOwnerLoadStatus = Schema.Literals([
  AgentsVxappOwnerLoadStatusValue.Idle,
  AgentsVxappOwnerLoadStatusValue.Loading,
  AgentsVxappOwnerLoadStatusValue.Ready,
  AgentsVxappOwnerLoadStatusValue.Error,
]);
export type AgentsVxappOwnerLoadStatus = typeof AgentsVxappOwnerLoadStatus.Type;

export const AgentsVxappSidebarAuthorityRuntimeTarget = Schema.Struct({
  kind: AgentsVxappRuntimeTargetKind,
  agentKind: AgentsVxappRuntimeTargetKind,
  threadId: Schema.NullOr(ThreadId),
  workspace: Schema.NullOr(TrimmedNonEmptyString),
  availability: AgentsVxappRuntimeAvailability,
  reasonCode: Schema.NullOr(AgentsVxappRuntimeReasonCode),
});
export type AgentsVxappSidebarAuthorityRuntimeTarget =
  typeof AgentsVxappSidebarAuthorityRuntimeTarget.Type;

export const AgentsVxappSidebarAuthorityDiagnostic = Schema.Struct({
  code: AgentsVxappOwnerDiagnosticCode,
  message: TrimmedNonEmptyString,
  programId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type AgentsVxappSidebarAuthorityDiagnostic =
  typeof AgentsVxappSidebarAuthorityDiagnostic.Type;

export const AgentsVxappOwnerBoundaryErrorKindValue = {
  TransportError: "transport_error",
  DecodeError: "decode_error",
  MissingRequiredField: "missing_required_field",
  OwnerContractError: "owner_contract_error",
} as const;

export const AgentsVxappOwnerBoundaryErrorKind = Schema.Literals([
  AgentsVxappOwnerBoundaryErrorKindValue.TransportError,
  AgentsVxappOwnerBoundaryErrorKindValue.DecodeError,
  AgentsVxappOwnerBoundaryErrorKindValue.MissingRequiredField,
  AgentsVxappOwnerBoundaryErrorKindValue.OwnerContractError,
]);
export type AgentsVxappOwnerBoundaryErrorKind = typeof AgentsVxappOwnerBoundaryErrorKind.Type;

export const VortexErrorCodeValue = {
  OwnerTransportFailure: "60",
  OwnerDecodeFailure: "61",
  OwnerMissingRequiredField: "62",
  OwnerContractFailure: "63",
  OwnerSurfaceMissing: "64",
  OwnerSurfaceAmbiguous: "65",
  OwnerRuntimeAuthorityMissing: "68",
  OwnerRoleWorkspaceMismatch: "69",
  UnknownVortexFailure: "99",
} as const;

export const VortexErrorCode = Schema.Literals([
  VortexErrorCodeValue.OwnerTransportFailure,
  VortexErrorCodeValue.OwnerDecodeFailure,
  VortexErrorCodeValue.OwnerMissingRequiredField,
  VortexErrorCodeValue.OwnerContractFailure,
  VortexErrorCodeValue.OwnerSurfaceMissing,
  VortexErrorCodeValue.OwnerSurfaceAmbiguous,
  VortexErrorCodeValue.OwnerRuntimeAuthorityMissing,
  VortexErrorCodeValue.OwnerRoleWorkspaceMismatch,
  VortexErrorCodeValue.UnknownVortexFailure,
]);
export type VortexErrorCode = typeof VortexErrorCode.Type;

export const VortexErrorResponse = Schema.Struct({
  code: Schema.optional(VortexErrorCode),
  title: Schema.optional(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
  ownerErrorCode: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type VortexErrorResponse = typeof VortexErrorResponse.Type;

export const AgentsVxappOwnerBoundaryError = Schema.Struct({
  kind: AgentsVxappOwnerBoundaryErrorKind,
  code: Schema.optional(VortexErrorCode),
  title: Schema.optional(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
  ownerErrorCode: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  details: Schema.optional(Schema.NullOr(AgentsVxappJsonRecord)),
});
export type AgentsVxappOwnerBoundaryError = typeof AgentsVxappOwnerBoundaryError.Type;

export const AgentsVxappMutationRequest = Schema.Struct({
  command: AgentsVxappOwnerCommand,
  surface: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  payload: AgentsVxappJsonRecord,
});
export type AgentsVxappMutationRequest = typeof AgentsVxappMutationRequest.Type;

export const AgentsVxappMutationResult = AgentsVxappOwnerResultEnvelope;
export type AgentsVxappMutationResult = typeof AgentsVxappMutationResult.Type;
