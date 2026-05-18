import { Effect, Layer, Schema } from "effect";

import {
  AgentsVxappExternalRoleAuthority,
  AgentsVxappExternalRoleAuthorityError,
  type AgentsVxappExternalRoleAuthorityShape,
  type AgentsVxappExternalRoleAuthoritySnapshot,
  type AgentsVxappRoleSessionRuntimePaths,
} from "../Services/AgentsVxappExternalRoleAuthority.ts";
import {
  fetchAgentsVxappControlPlaneSnapshot,
  fetchAgentsVxappRoleSessionRuntimePaths,
  AgentsVxappOwnerClientError,
} from "../agentsVxappOwnerClient.ts";

type JsonRecord = Record<string, unknown>;

const isAgentsVxappExternalRoleAuthorityError = Schema.is(AgentsVxappExternalRoleAuthorityError);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapError(operation: string, cause: unknown): AgentsVxappExternalRoleAuthorityError {
  if (isAgentsVxappExternalRoleAuthorityError(cause)) {
    return cause;
  }
  if (cause instanceof AgentsVxappOwnerClientError) {
    return new AgentsVxappExternalRoleAuthorityError({
      operation,
      detail: cause.message,
      ownerCommand: cause.ownerCommand,
      authoritySurface: cause.authoritySurface,
      ownerErrorCode: cause.ownerErrorCode,
      authorityStore: cause.authorityStore,
      authoritySource: cause.authoritySource,
      contractFamily: cause.contractFamily,
      contractVersion: cause.contractVersion,
      exitCode: cause.exitCode,
      stdout: cause.stdout,
      stderr: cause.stderr,
    });
  }
  return new AgentsVxappExternalRoleAuthorityError({
    operation,
    detail: cause instanceof Error ? cause.message : "agents-vxapp owner command failed.",
  });
}

function ownerPromise<T>(
  operation: string,
  run: () => Promise<T>,
): Effect.Effect<T, AgentsVxappExternalRoleAuthorityError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => mapError(operation, cause),
  });
}

function buildSnapshot(payload: unknown): AgentsVxappExternalRoleAuthoritySnapshot {
  const root = asRecord(payload);
  const authority = asRecord(root?.externalRoleAuthority) ?? root;
  const projects = asArray(authority?.projects);
  const threadSummaries = asArray(authority?.threadSummaries);
  return {
    projects: projects as AgentsVxappExternalRoleAuthoritySnapshot["projects"],
    threadSummaries: threadSummaries as AgentsVxappExternalRoleAuthoritySnapshot["threadSummaries"],
  };
}

const makeAgentsVxappExternalRoleAuthority = Effect.succeed({
  getSnapshot: () =>
    ownerPromise("AgentsVxappExternalRoleAuthority.getSnapshot", async () =>
      buildSnapshot(await fetchAgentsVxappControlPlaneSnapshot()),
    ),
  getRuntimePaths: () =>
    ownerPromise("AgentsVxappExternalRoleAuthority.getRuntimePaths", () =>
      fetchAgentsVxappRoleSessionRuntimePaths<AgentsVxappRoleSessionRuntimePaths>(),
    ),
} satisfies AgentsVxappExternalRoleAuthorityShape);

export const AgentsVxappExternalRoleAuthorityLive = Layer.effect(
  AgentsVxappExternalRoleAuthority,
  makeAgentsVxappExternalRoleAuthority,
);
