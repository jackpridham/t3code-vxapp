import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";

export const KnowledgeSource = Schema.Struct({
  source: TrimmedNonEmptyString,
  score: Schema.NullOr(Schema.Number),
  content: TrimmedString,
});
export type KnowledgeSource = typeof KnowledgeSource.Type;

export const KnowledgeDoctorResult = Schema.Struct({
  pythonPackages: Schema.Array(TrimmedNonEmptyString),
  missingPythonPackages: Schema.Array(TrimmedNonEmptyString),
  ollamaBinary: Schema.NullOr(TrimmedNonEmptyString),
  ollamaVersion: Schema.NullOr(TrimmedNonEmptyString),
  ollamaReachable: Schema.Boolean,
  installedModels: Schema.Array(TrimmedNonEmptyString),
  missingModels: Schema.Array(TrimmedNonEmptyString),
  indexDirWritable: Schema.Boolean,
  autoStartOllama: Schema.Boolean,
  autoPullModels: Schema.Boolean,
});
export type KnowledgeDoctorResult = typeof KnowledgeDoctorResult.Type;

export const KnowledgeReadinessResult = Schema.Struct({
  ok: Schema.Boolean,
  reasons: Schema.Array(TrimmedNonEmptyString),
  runtime: KnowledgeDoctorResult,
});
export type KnowledgeReadinessResult = typeof KnowledgeReadinessResult.Type;

export const KnowledgeQueryInput = Schema.Struct({
  query: TrimmedNonEmptyString,
  topK: PositiveInt,
  rebuild: Schema.Boolean,
});
export type KnowledgeQueryInput = typeof KnowledgeQueryInput.Type;

export const KnowledgeQueryResult = Schema.Struct({
  answer: TrimmedString,
  rebuilt: Schema.Boolean,
  sources: Schema.Array(KnowledgeSource),
});
export type KnowledgeQueryResult = typeof KnowledgeQueryResult.Type;
