import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

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

export const AgentsVxappMutationRequest = Schema.Struct({
  command: AgentsVxappOwnerCommand,
  surface: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  payload: AgentsVxappJsonRecord,
});
export type AgentsVxappMutationRequest = typeof AgentsVxappMutationRequest.Type;

export const AgentsVxappMutationResult = AgentsVxappOwnerResultEnvelope;
export type AgentsVxappMutationResult = typeof AgentsVxappMutationResult.Type;
