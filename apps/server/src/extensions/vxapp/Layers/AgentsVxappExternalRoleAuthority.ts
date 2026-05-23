import { Effect, Layer, Schema } from "effect";

import {
  AgentsVxappExternalRoleAuthority,
  AgentsVxappExternalRoleAuthorityError,
  type AgentsVxappExternalRoleAuthorityShape,
  type AgentsVxappExternalRoleAuthoritySnapshot,
  type AgentsVxappRoleSessionRuntimePaths,
} from "../Services/AgentsVxappExternalRoleAuthority.ts";
import {
  fetchAgentsVxappExternalRoleAuthoritySnapshot,
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
  if (!root) {
    throw new Error("agents-vxapp external role authority snapshot is not an object.");
  }
  const authority =
    root.externalRoleAuthority === undefined ? root : asRecord(root.externalRoleAuthority);
  if (!authority) {
    throw new Error("agents-vxapp external role authority payload is malformed.");
  }
  if (!Array.isArray(authority.projects)) {
    throw new Error("agents-vxapp external role authority snapshot is missing projects.");
  }
  if (!Array.isArray(authority.threadSummaries)) {
    throw new Error("agents-vxapp external role authority snapshot is missing threadSummaries.");
  }
  return {
    projects: authority.projects as AgentsVxappExternalRoleAuthoritySnapshot["projects"],
    threadSummaries:
      authority.threadSummaries as AgentsVxappExternalRoleAuthoritySnapshot["threadSummaries"],
  };
}

const makeAgentsVxappExternalRoleAuthority = Effect.succeed({
  getSnapshot: () =>
    ownerPromise("AgentsVxappExternalRoleAuthority.getSnapshot", async () =>
      buildSnapshot(await fetchAgentsVxappExternalRoleAuthoritySnapshot()),
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
