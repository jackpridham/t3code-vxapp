import {
  type KnowledgeDoctorResult,
  type KnowledgeQueryInput,
  type KnowledgeQueryResult,
  type KnowledgeReadinessResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";
import { KnowledgeClientError } from "../Errors";

export interface KnowledgeClientShape {
  readonly doctor: Effect.Effect<KnowledgeDoctorResult, KnowledgeClientError>;
  readonly readiness: Effect.Effect<KnowledgeReadinessResult, KnowledgeClientError>;
  readonly query: (
    input: KnowledgeQueryInput,
  ) => Effect.Effect<KnowledgeQueryResult, KnowledgeClientError>;
}

export const KnowledgeClient = ServiceMap.Service<KnowledgeClientShape>("t3/knowledge/KnowledgeClient");

export const makeKnowledgeClientTestLayer = (overrides: Partial<KnowledgeClientShape>) =>
  Layer.succeed(KnowledgeClient, {
    doctor: Effect.fail(
      new KnowledgeClientError({ message: "Knowledge client test override missing doctor" }),
    ),
    readiness: Effect.fail(
      new KnowledgeClientError({ message: "Knowledge client test override missing readiness" }),
    ),
    query: () =>
      Effect.fail(
        new KnowledgeClientError({ message: "Knowledge client test override missing query" }),
      ),
    ...overrides,
  } satisfies KnowledgeClientShape);
