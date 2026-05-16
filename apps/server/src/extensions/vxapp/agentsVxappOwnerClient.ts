import path from "node:path";
import type {
  GetAgentRuntimeSnapshotInput,
  GetAgentRuntimeSnapshotResult,
  GetWorkerRuntimeSnapshotInput,
  GetWorkerRuntimeSnapshotResult,
  ServerAgentsVxappOwnerMutationResult,
  ServerCreateAgentsVxappProgramInput,
  ServerCreateAgentsVxappTodoInput,
  ServerDeleteAgentsVxappProgramInput,
  ServerDeleteAgentsVxappTodoInput,
  ServerGetAgentsVxappControlPlaneSnapshotResult,
  ServerGetAgentsVxappSidebarGraphResult,
  ServerSetAgentsVxappProgramLifecycleInput,
  ServerUpdateAgentsVxappProgramInput,
  ServerUpdateAgentsVxappTodoInput,
} from "@t3tools/contracts";

import { runProcess, type ProcessRunResult } from "../../processRunner.ts";
import { AGENTS_VXAPP_ROOT } from "./agentsVxappSqlite.ts";

const BOOTSTRAP_MANIFEST_COMMAND = "t3code-contract-manifest";
const CONTROL_PLANE_OWNER_RELATIVE_PATH = "scripts/tools/t3-control-plane-owner";
const ROLE_SESSION_OWNER_RELATIVE_PATH = "scripts/tools/role-session-owner";
const OWNER_COMMAND_TIMEOUT_MS = 30_000;
const OWNER_COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const CONTRACT_FAMILY = "agents-vxapp-t3code-authority";
const CONTRACT_VERSION = "v1";

const REQUIRED_OWNER_COMMANDS = {
  threadStatus: { command: "t3code-thread-status", surface: "threads" },
  threadEventIngest: { command: "t3code-thread-event-ingest", surface: "threads" },
  approvalRequest: { command: "t3code-approval-request", surface: "approvals" },
  approvalResponse: { command: "t3code-approval-respond", surface: "approvals" },
  userInputResponse: { command: "t3code-user-input-respond", surface: "user_input" },
} as const;

const EXPECTED_OWNER_SURFACES = [
  "bootstrap_snapshot",
  "control_plane_snapshot",
  "programs_todos_snapshot",
  "programs",
  "todos",
  "agent_runtime",
  "worker_runtime",
  "role_session_runtime_paths",
  REQUIRED_OWNER_COMMANDS.threadStatus.surface,
  REQUIRED_OWNER_COMMANDS.approvalRequest.surface,
  REQUIRED_OWNER_COMMANDS.userInputResponse.surface,
] as const;

type JsonRecord = Record<string, unknown>;
type OwnerSurface = (typeof EXPECTED_OWNER_SURFACES)[number] | "contract_manifest";
type OwnerTool = "control-plane" | "role-session";

export class AgentsVxappOwnerClientError extends Error {
  readonly ownerCommand: string;
  readonly authoritySurface: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(input: {
    readonly authoritySurface: string;
    readonly cause?: unknown;
    readonly exitCode?: number | null;
    readonly message: string;
    readonly ownerCommand: string;
    readonly stderr?: string;
    readonly stdout?: string;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AgentsVxappOwnerClientError";
    this.ownerCommand = input.ownerCommand;
    this.authoritySurface = input.authoritySurface;
    this.stdout = input.stdout ?? "";
    this.stderr = input.stderr ?? "";
    this.exitCode = input.exitCode ?? null;
  }
}

export interface AgentsVxappOwnerAuthorityPayload<T = unknown> {
  readonly contractFamily: string;
  readonly contractVersion: string;
  readonly authorityStore: string;
  readonly authoritySource: string;
  readonly legacyFallbackUsed: false;
  readonly surface: OwnerSurface | string;
  readonly payload: T;
  readonly display?: unknown;
  readonly options?: unknown;
}

interface OwnerManifestEntry {
  readonly command: string;
  readonly surface: Exclude<OwnerSurface, "contract_manifest">;
  readonly tool: OwnerTool;
  readonly implemented: boolean;
}

export interface AgentsVxappOwnerManifest {
  readonly commandsByName: ReadonlyMap<string, OwnerManifestEntry>;
}

let cachedManifest: AgentsVxappOwnerManifest | null = null;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function ownerPath(tool: OwnerTool): string {
  return path.join(
    AGENTS_VXAPP_ROOT,
    tool === "role-session" ? ROLE_SESSION_OWNER_RELATIVE_PATH : CONTROL_PLANE_OWNER_RELATIVE_PATH,
  );
}

function fail(input: {
  readonly authoritySurface: string;
  readonly cause?: unknown;
  readonly message: string;
  readonly ownerCommand: string;
  readonly result?: ProcessRunResult;
}): never {
  throw new AgentsVxappOwnerClientError({
    authoritySurface: input.authoritySurface,
    cause: input.cause,
    exitCode: input.result?.code ?? null,
    message: input.message,
    ownerCommand: input.ownerCommand,
    stderr: input.result?.stderr ?? "",
    stdout: input.result?.stdout ?? "",
  });
}

function parseJson(ownerCommand: string, authoritySurface: string, result: ProcessRunResult) {
  try {
    return JSON.parse(result.stdout.trim()) as unknown;
  } catch (error) {
    fail({
      authoritySurface,
      cause: error,
      message: "Owner command returned invalid JSON.",
      ownerCommand,
      result,
    });
  }
}

function envelopeErrorMessage(envelope: JsonRecord): string {
  const error = asRecord(envelope.error);
  return (
    asString(error?.message) ??
    asString(envelope.message) ??
    asString(envelope.detail) ??
    "Owner command failed."
  );
}

function validateAuthorityPayload<T>(
  ownerCommand: string,
  authoritySurface: string,
  value: unknown,
  result: ProcessRunResult,
): AgentsVxappOwnerAuthorityPayload<T> {
  const payload = asRecord(value);
  if (!payload) {
    fail({
      authoritySurface,
      message: "Owner authority result must be a JSON object.",
      ownerCommand,
      result,
    });
  }
  const contractFamily = asString(payload.contractFamily);
  const contractVersion = asString(payload.contractVersion);
  const surface = asString(payload.surface);
  if (!contractFamily || !contractVersion || !surface || !Object.hasOwn(payload, "payload")) {
    fail({
      authoritySurface,
      message:
        "Owner authority result is missing contractFamily, contractVersion, surface, or payload.",
      ownerCommand,
      result,
    });
  }
  if (payload.legacyFallbackUsed !== false) {
    fail({
      authoritySurface,
      message: "Owner authority result used a legacy fallback.",
      ownerCommand,
      result,
    });
  }
  return {
    contractFamily,
    contractVersion,
    authorityStore: asString(payload.authorityStore) ?? "",
    authoritySource: asString(payload.authoritySource) ?? "",
    legacyFallbackUsed: false,
    surface,
    payload: payload.payload as T,
    display: payload.display,
    options: payload.options,
  };
}

async function executeOwnerCommand(input: {
  readonly args?: readonly string[];
  readonly command: string;
  readonly payloadJson?: unknown;
  readonly surface: string;
  readonly tool: OwnerTool;
}) {
  const args = [input.command, "--json", ...(input.args ?? [])];
  if (input.payloadJson !== undefined) {
    args.push("--payload-json", JSON.stringify(input.payloadJson));
  }
  if (args.includes("--compatibility-mode")) {
    fail({
      authoritySurface: input.surface,
      message: "Compatibility-mode owner output is forbidden.",
      ownerCommand: input.command,
    });
  }
  const result = await runProcess(ownerPath(input.tool), args, {
    allowNonZeroExit: true,
    cwd: AGENTS_VXAPP_ROOT,
    maxBufferBytes: OWNER_COMMAND_MAX_BUFFER_BYTES,
    outputMode: "truncate",
    timeoutMs: OWNER_COMMAND_TIMEOUT_MS,
  }).catch((error: unknown) =>
    fail({
      authoritySurface: input.surface,
      cause: error,
      message: error instanceof Error ? error.message : "Failed to run owner command.",
      ownerCommand: input.command,
    }),
  );

  const parsed = parseJson(input.command, input.surface, result);
  const envelope = asRecord(parsed);
  if (!envelope) {
    fail({
      authoritySurface: input.surface,
      message: "Owner command returned non-object JSON.",
      ownerCommand: input.command,
      result,
    });
  }
  if (result.code !== 0) {
    fail({
      authoritySurface: input.surface,
      message: envelopeErrorMessage(envelope),
      ownerCommand: input.command,
      result,
    });
  }
  if (envelope.ok !== true) {
    fail({
      authoritySurface: input.surface,
      message: envelopeErrorMessage(envelope),
      ownerCommand: input.command,
      result,
    });
  }
  if (
    !asString(envelope.contract_family) ||
    !asString(envelope.contract_version) ||
    !asString(envelope.command)
  ) {
    fail({
      authoritySurface: input.surface,
      message: "Owner envelope is missing contract_family, contract_version, or command.",
      ownerCommand: input.command,
      result,
    });
  }
  if (envelope.command !== input.command) {
    fail({
      authoritySurface: input.surface,
      message: `Owner envelope command '${String(envelope.command)}' did not match '${input.command}'.`,
      ownerCommand: input.command,
      result,
    });
  }
  if (!Object.hasOwn(envelope, "result")) {
    fail({
      authoritySurface: input.surface,
      message: "Owner envelope is missing result.",
      ownerCommand: input.command,
      result,
    });
  }
  return {
    authority: validateAuthorityPayload(input.command, input.surface, envelope.result, result),
    result,
  };
}

function inferTool(surface: OwnerSurface, entry: JsonRecord): OwnerTool {
  const rawTool = asString(entry.tool ?? entry.ownerTool ?? entry.owner);
  if (rawTool === "role-session" || rawTool === "role_session") {
    return "role-session";
  }
  if (surface === "role_session_runtime_paths") {
    return "role-session";
  }
  return "control-plane";
}

function manifestEntryFromRecord(
  fallbackCommand: string,
  value: unknown,
): OwnerManifestEntry | null {
  const entry = asRecord(value) ?? {};
  const command = asString(entry.command) ?? fallbackCommand;
  const surface = asString(entry.surface ?? entry.authoritySurface);
  if (
    !command ||
    !surface ||
    !EXPECTED_OWNER_SURFACES.includes(surface as Exclude<OwnerSurface, "contract_manifest">)
  ) {
    return null;
  }
  if (command === BOOTSTRAP_MANIFEST_COMMAND) {
    throw new Error("Owner manifest must not expose the private bootstrap command.");
  }
  return {
    command,
    surface: surface as Exclude<OwnerSurface, "contract_manifest">,
    implemented: entry.implemented === true,
    tool: inferTool(surface as OwnerSurface, entry),
  };
}

function parseManifest(payload: unknown): AgentsVxappOwnerManifest {
  const root = asRecord(payload);
  const entries = new Map<string, OwnerManifestEntry>();
  const ownerCommandManifest = Array.isArray(root?.ownerCommandManifest)
    ? root.ownerCommandManifest
    : null;

  if (ownerCommandManifest) {
    for (const rawEntry of ownerCommandManifest) {
      const entryRecord = asRecord(rawEntry);
      const command = asString(entryRecord?.command);
      const entry = command ? manifestEntryFromRecord(command, entryRecord) : null;
      if (!entry) {
        throw new Error("Owner manifest contains an invalid ownerCommandManifest entry.");
      }
      if (entries.has(entry.command)) {
        throw new Error(`Owner manifest has duplicate command '${entry.command}'.`);
      }
      entries.set(entry.command, entry);
    }
  }

  const rawCommands = asRecord(root?.commands) ?? asRecord(root?.ownerCommands);
  if (rawCommands) {
    for (const [command, value] of Object.entries(rawCommands)) {
      const entry = manifestEntryFromRecord(command, value);
      if (entry) {
        if (entries.has(entry.command)) {
          throw new Error(`Owner manifest has duplicate command '${entry.command}'.`);
        }
        entries.set(entry.command, entry);
      }
    }
  }

  if (entries.size === 0) {
    throw new Error("Owner manifest is missing ownerCommandManifest entries.");
  }

  for (const [label, required] of Object.entries(REQUIRED_OWNER_COMMANDS)) {
    const entry = entries.get(required.command);
    if (!entry) {
      throw new Error(`Owner manifest is missing required command '${required.command}'.`);
    }
    if (entry.command !== required.command) {
      throw new Error(`Owner manifest command mismatch for '${label}'.`);
    }
    if (entry.surface !== required.surface) {
      throw new Error(
        `Owner manifest command '${required.command}' must use surface '${required.surface}'.`,
      );
    }
    if (entry.implemented !== true) {
      throw new Error(`Owner manifest command '${required.command}' is not implemented.`);
    }
  }

  return { commandsByName: entries };
}

export function resetAgentsVxappOwnerManifestForTests(): void {
  cachedManifest = null;
}

export async function bootstrapAgentsVxappOwnerManifest(): Promise<AgentsVxappOwnerManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }
  const { authority, result } = await executeOwnerCommand({
    command: BOOTSTRAP_MANIFEST_COMMAND,
    surface: "contract_manifest",
    tool: "control-plane",
  });
  if (
    authority.contractFamily !== CONTRACT_FAMILY ||
    authority.contractVersion !== CONTRACT_VERSION ||
    authority.surface !== "contract_manifest"
  ) {
    fail({
      authoritySurface: "contract_manifest",
      message: "Owner manifest authority contract mismatch.",
      ownerCommand: BOOTSTRAP_MANIFEST_COMMAND,
      result,
    });
  }
  try {
    cachedManifest = parseManifest(authority.payload);
    return cachedManifest;
  } catch (error) {
    fail({
      authoritySurface: "contract_manifest",
      cause: error,
      message: error instanceof Error ? error.message : "Owner manifest is invalid.",
      ownerCommand: BOOTSTRAP_MANIFEST_COMMAND,
      result,
    });
  }
}

async function callManifestCommand<T>(
  surface: Exclude<OwnerSurface, "contract_manifest">,
  input?: unknown,
): Promise<AgentsVxappOwnerAuthorityPayload<T>> {
  const manifest = await bootstrapAgentsVxappOwnerManifest();
  const matchingEntries = [...manifest.commandsByName.values()].filter(
    (entry) => entry.surface === surface,
  );
  const entry = matchingEntries[0];
  if (!entry) {
    fail({
      authoritySurface: surface,
      message: `Owner manifest did not provide surface '${surface}'.`,
      ownerCommand: surface,
    });
  }
  if (matchingEntries.length > 1) {
    fail({
      authoritySurface: surface,
      message: `Owner surface '${surface}' is ambiguous; select a manifest command by name.`,
      ownerCommand: surface,
    });
  }
  const { authority, result } = await executeOwnerCommand({
    command: entry.command,
    ...(input !== undefined ? { payloadJson: input } : {}),
    surface: entry.surface,
    tool: entry.tool,
  });
  if (authority.surface !== entry.surface) {
    fail({
      authoritySurface: entry.surface,
      message: `Owner command '${entry.command}' returned surface '${authority.surface}'.`,
      ownerCommand: entry.command,
      result,
    });
  }
  return authority as AgentsVxappOwnerAuthorityPayload<T>;
}

async function callManifestCommandByName<T>(input: {
  readonly command: string;
  readonly surface: Exclude<OwnerSurface, "contract_manifest">;
  readonly args?: readonly string[];
  readonly payloadJson?: unknown;
}): Promise<AgentsVxappOwnerAuthorityPayload<T>> {
  const manifest = await bootstrapAgentsVxappOwnerManifest();
  const entry = manifest.commandsByName.get(input.command);
  if (!entry) {
    fail({
      authoritySurface: input.surface,
      message: `Owner manifest did not provide command '${input.command}'.`,
      ownerCommand: input.command,
    });
  }
  if (entry.surface !== input.surface) {
    fail({
      authoritySurface: input.surface,
      message: `Owner manifest command '${input.command}' did not match surface '${input.surface}'.`,
      ownerCommand: input.command,
    });
  }
  const { authority, result } = await executeOwnerCommand({
    command: entry.command,
    ...(input.args ? { args: input.args } : {}),
    ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
    surface: entry.surface,
    tool: entry.tool,
  });
  if (authority.surface !== entry.surface) {
    fail({
      authoritySurface: entry.surface,
      message: `Owner command '${entry.command}' returned surface '${authority.surface}'.`,
      ownerCommand: entry.command,
      result,
    });
  }
  return authority as AgentsVxappOwnerAuthorityPayload<T>;
}

export async function fetchAgentsVxappBootstrapSidebarSnapshot() {
  return (await callManifestCommand<ServerGetAgentsVxappSidebarGraphResult>("bootstrap_snapshot"))
    .payload;
}

export async function fetchAgentsVxappControlPlaneSnapshot() {
  return (await callManifestCommand<JsonRecord>("control_plane_snapshot")).payload;
}

export async function fetchAgentsVxappProgramsTodosSnapshot() {
  return (
    await callManifestCommand<ServerGetAgentsVxappControlPlaneSnapshotResult>(
      "programs_todos_snapshot",
    )
  ).payload;
}

export async function requestAgentsVxappProgramMutation(
  input:
    | { readonly action: "create"; readonly input: ServerCreateAgentsVxappProgramInput }
    | { readonly action: "update"; readonly input: ServerUpdateAgentsVxappProgramInput }
    | { readonly action: "delete"; readonly input: ServerDeleteAgentsVxappProgramInput }
    | { readonly action: "lifecycle"; readonly input: ServerSetAgentsVxappProgramLifecycleInput },
) {
  return (await callManifestCommand<ServerAgentsVxappOwnerMutationResult>("programs", input))
    .payload;
}

export async function requestAgentsVxappTodoMutation(
  input:
    | { readonly action: "create"; readonly input: ServerCreateAgentsVxappTodoInput }
    | { readonly action: "update"; readonly input: ServerUpdateAgentsVxappTodoInput }
    | { readonly action: "delete"; readonly input: ServerDeleteAgentsVxappTodoInput },
) {
  return (await callManifestCommand<ServerAgentsVxappOwnerMutationResult>("todos", input)).payload;
}

export async function fetchAgentsVxappRoleSessionRuntimePaths<T>() {
  return (await callManifestCommand<T>("role_session_runtime_paths")).payload;
}

export async function fetchAgentsVxappWorkerRuntimeSnapshot(input: GetWorkerRuntimeSnapshotInput) {
  return (await callManifestCommand<GetWorkerRuntimeSnapshotResult>("worker_runtime", input))
    .payload;
}

export async function fetchAgentsVxappAgentRuntimeSnapshot(input: GetAgentRuntimeSnapshotInput) {
  return (await callManifestCommand<GetAgentRuntimeSnapshotResult>("agent_runtime", input)).payload;
}

export async function requestAgentsVxappThreadStatus(input: { readonly threadId: string }) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: REQUIRED_OWNER_COMMANDS.threadStatus.command,
      surface: REQUIRED_OWNER_COMMANDS.threadStatus.surface,
      args: ["--thread", input.threadId],
    })
  ).payload;
}

export async function requestAgentsVxappThreadEventIngest(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: REQUIRED_OWNER_COMMANDS.threadEventIngest.command,
      surface: REQUIRED_OWNER_COMMANDS.threadEventIngest.surface,
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappApprovalRequest(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: REQUIRED_OWNER_COMMANDS.approvalRequest.command,
      surface: REQUIRED_OWNER_COMMANDS.approvalRequest.surface,
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappApprovalResponse(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: REQUIRED_OWNER_COMMANDS.approvalResponse.command,
      surface: REQUIRED_OWNER_COMMANDS.approvalResponse.surface,
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappUserInputResponse(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: REQUIRED_OWNER_COMMANDS.userInputResponse.command,
      surface: REQUIRED_OWNER_COMMANDS.userInputResponse.surface,
      payloadJson: input,
    })
  ).payload;
}
