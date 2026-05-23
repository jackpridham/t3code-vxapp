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
  ServerGetAgentsVxappSidebarAuthoritySnapshotInput,
  ServerGetAgentsVxappControlPlaneSnapshotInput,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  ServerGetAgentsVxappControlPlaneSnapshotResult,
  ServerSetAgentsVxappProgramLifecycleInput,
  ServerUpdateAgentsVxappProgramInput,
  ServerUpdateAgentsVxappTodoInput,
} from "@t3tools/contracts";

import { runProcess, type ProcessRunResult } from "../../processRunner.ts";
import type { AgentsVxappSidebarOwnerGraphSnapshot } from "./Services/AgentsVxappSidebar.ts";
import { AGENTS_VXAPP_REPO_ROOT } from "./agentsVxappRepoRoot.ts";

const BOOTSTRAP_MANIFEST_COMMAND = "t3code-contract-manifest";
const ROLE_SESSION_RUNTIME_PATHS_COMMAND = "runtime-paths";
const CONTROL_PLANE_OWNER_RELATIVE_PATH = "scripts/tools/t3-control-plane-owner";
const ROLE_SESSION_OWNER_RELATIVE_PATH = "scripts/tools/role-session-owner";
const OWNER_COMMAND_TIMEOUT_MS = 30_000;
const OWNER_COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const CONTRACT_FAMILY = "agents-vxapp-t3code-authority";
const CONTRACT_VERSION = "v1";
type JsonRecord = Record<string, unknown>;
type OwnerSurface = string;
type OwnerTool = "control-plane" | "role-session";

export class AgentsVxappOwnerClientError extends Error {
  readonly ownerCommand: string;
  readonly authoritySurface: string;
  readonly ownerErrorCode: string | null;
  readonly authorityStore: string | null;
  readonly authoritySource: string | null;
  readonly contractFamily: string | null;
  readonly contractVersion: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly details: JsonRecord | null;
  readonly hints: readonly JsonRecord[];

  constructor(input: {
    readonly authoritySurface: string;
    readonly authoritySource?: string | null;
    readonly authorityStore?: string | null;
    readonly cause?: unknown;
    readonly contractFamily?: string | null;
    readonly contractVersion?: string | null;
    readonly exitCode?: number | null;
    readonly message: string;
    readonly ownerCommand: string;
    readonly ownerErrorCode?: string | null;
    readonly details?: JsonRecord | null;
    readonly hints?: readonly JsonRecord[];
    readonly stderr?: string;
    readonly stdout?: string;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AgentsVxappOwnerClientError";
    this.ownerCommand = input.ownerCommand;
    this.authoritySurface = input.authoritySurface;
    this.ownerErrorCode = input.ownerErrorCode ?? null;
    this.authorityStore = input.authorityStore ?? null;
    this.authoritySource = input.authoritySource ?? null;
    this.contractFamily = input.contractFamily ?? null;
    this.contractVersion = input.contractVersion ?? null;
    this.stdout = input.stdout ?? "";
    this.stderr = input.stderr ?? "";
    this.exitCode = input.exitCode ?? null;
    this.details = input.details ?? null;
    this.hints = input.hints ?? [];
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
  readonly implemented: boolean;
  readonly surface: string;
}

interface OwnerCallerContractEntry {
  readonly command: string;
  readonly surface: string;
  readonly tool: OwnerTool;
  readonly wrapperKey: string;
}

export interface AgentsVxappOwnerManifest {
  readonly commandsByName: ReadonlyMap<string, OwnerCallerContractEntry>;
  readonly commandsByWrapperKey: ReadonlyMap<string, OwnerCallerContractEntry>;
}

let cachedManifest: AgentsVxappOwnerManifest | null = null;
const TODO_MUTATE_WRAPPER_KEY = "todo_mutate";
const TODO_MUTATE_ACTIONS = [
  "create",
  "update",
  "delete",
  "show",
  "list",
  "recent",
  "search",
  "current",
  "link_plan",
  "unlink_plan",
] as const;
type TodoMutateAction = (typeof TODO_MUTATE_ACTIONS)[number];
const THREAD_LIFECYCLE_PROVIDER_REQUEST_KINDS = [
  "thread_create",
  "thread_turn_start",
  "thread_turn_interrupt",
  "thread_session_stop",
  "thread_revert",
  "thread_archive",
  "thread_delete",
  "thread_lineage_update",
] as const;
type ThreadLifecycleProviderRequestKind = (typeof THREAD_LIFECYCLE_PROVIDER_REQUEST_KINDS)[number];
export type AgentsVxappThreadLifecycleOwnerCommand =
  | "t3code-threads-create"
  | "t3code-threads-start"
  | "t3code-threads-interrupt"
  | "t3code-threads-stop"
  | "t3code-threads-revert"
  | "t3code-threads-archive"
  | "t3code-threads-delete"
  | "t3code-threads-lineage-update";

export type AgentsVxappWakeOwnerCommand =
  | "t3code-wake-enqueue"
  | "t3code-wake-delivery-plan"
  | "t3code-wake-drain-ready"
  | "t3code-wake-reconcile-startup"
  | "t3code-wake-provider-request";

const THREAD_LIFECYCLE_OWNER_COMMAND_KINDS = {
  "t3code-threads-create": "thread_create",
  "t3code-threads-start": "thread_turn_start",
  "t3code-threads-interrupt": "thread_turn_interrupt",
  "t3code-threads-stop": "thread_session_stop",
  "t3code-threads-revert": "thread_revert",
  "t3code-threads-archive": "thread_archive",
  "t3code-threads-delete": "thread_delete",
  "t3code-threads-lineage-update": "thread_lineage_update",
} as const satisfies Record<
  AgentsVxappThreadLifecycleOwnerCommand,
  ThreadLifecycleProviderRequestKind
>;

export interface AgentsVxappThreadLifecycleProviderPayload extends JsonRecord {
  readonly legacyFallbackUsed: false;
  readonly providerRequest: JsonRecord & {
    readonly kind: ThreadLifecycleProviderRequestKind;
    readonly requestId: string;
  };
}

export interface AgentsVxappWakeOwnerPayload extends JsonRecord {
  readonly legacyFallbackUsed: false;
}

export interface AgentsVxappWakeProviderRequestPayload extends AgentsVxappWakeOwnerPayload {
  readonly providerRequestStatus: "ready" | "blocked";
  readonly providerRequest?: JsonRecord;
  readonly ownerDiagnostics?: JsonRecord;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonRecord =>
          entry !== null && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function ownerPath(tool: OwnerTool): string {
  return path.join(
    AGENTS_VXAPP_REPO_ROOT,
    tool === "role-session" ? ROLE_SESSION_OWNER_RELATIVE_PATH : CONTROL_PLANE_OWNER_RELATIVE_PATH,
  );
}

function extractOwnerDiagnostics(input: {
  readonly authorityPayload?: JsonRecord | null;
  readonly authoritySurface: string;
  readonly envelope?: JsonRecord | null;
  readonly ownerCommand: string;
  readonly result?: ProcessRunResult;
}) {
  const envelope = input.envelope ?? null;
  const error = asRecord(envelope?.error);
  const errorDetails = asRecord(error?.details);
  const authorityPayload = input.authorityPayload ?? asRecord(envelope?.result);
  return {
    ownerCommand:
      asString(errorDetails?.ownerCommand) ?? asString(envelope?.command) ?? input.ownerCommand,
    authoritySurface:
      asString(errorDetails?.authoritySurface) ??
      asString(errorDetails?.surface) ??
      asString(authorityPayload?.surface) ??
      input.authoritySurface,
    ownerErrorCode: asString(error?.code),
    authorityStore:
      asString(errorDetails?.authorityStore) ?? asString(authorityPayload?.authorityStore),
    authoritySource:
      asString(errorDetails?.authoritySource) ?? asString(authorityPayload?.authoritySource),
    contractFamily:
      asString(authorityPayload?.contractFamily) ?? asString(envelope?.contract_family),
    contractVersion:
      asString(authorityPayload?.contractVersion) ?? asString(envelope?.contract_version),
    stdout: input.result?.stdout ?? "",
    stderr: input.result?.stderr ?? "",
    exitCode: input.result?.code ?? null,
    details: errorDetails,
    hints: asRecordArray(error?.hints ?? errorDetails?.hints),
  };
}

function fail(input: {
  readonly authorityPayload?: JsonRecord | null;
  readonly authoritySurface: string;
  readonly cause?: unknown;
  readonly envelope?: JsonRecord | null;
  readonly message: string;
  readonly ownerCommand: string;
  readonly result?: ProcessRunResult;
}): never {
  const diagnostics = extractOwnerDiagnostics(input);
  throw new AgentsVxappOwnerClientError({
    authoritySurface: diagnostics.authoritySurface,
    authoritySource: diagnostics.authoritySource,
    authorityStore: diagnostics.authorityStore,
    cause: input.cause,
    contractFamily: diagnostics.contractFamily,
    contractVersion: diagnostics.contractVersion,
    exitCode: diagnostics.exitCode,
    message: input.message,
    ownerCommand: diagnostics.ownerCommand,
    ownerErrorCode: diagnostics.ownerErrorCode,
    details: diagnostics.details,
    hints: diagnostics.hints,
    stderr: diagnostics.stderr,
    stdout: diagnostics.stdout,
  });
}

function paginationArgs(input: {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}): string[] {
  const args: string[] = [];
  if (input.page !== undefined) {
    args.push("--page", String(input.page));
  }
  if (input.limit !== undefined) {
    args.push("--limit", String(input.limit));
  }
  return args;
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
      authorityPayload: null,
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
      authorityPayload: payload,
      authoritySurface,
      message:
        "Owner authority result is missing contractFamily, contractVersion, surface, or payload.",
      ownerCommand,
      result,
    });
  }
  if (payload.legacyFallbackUsed !== false) {
    fail({
      authorityPayload: payload,
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

function isThreadLifecycleProviderRequestKind(
  value: unknown,
): value is ThreadLifecycleProviderRequestKind {
  return (
    typeof value === "string" &&
    THREAD_LIFECYCLE_PROVIDER_REQUEST_KINDS.includes(value as ThreadLifecycleProviderRequestKind)
  );
}

function requiredThreadLifecycleProviderFields(
  kind: ThreadLifecycleProviderRequestKind,
): readonly string[] {
  switch (kind) {
    case "thread_create":
      return ["projectId", "title"];
    case "thread_turn_start":
      return ["threadId", "message"];
    case "thread_revert":
      return ["threadId", "revertToTurnId"];
    case "thread_archive":
      return ["threadId", "archiveCurrent"];
    case "thread_lineage_update":
      return ["threadId", "lineage"];
    case "thread_turn_interrupt":
    case "thread_session_stop":
    case "thread_delete":
      return ["threadId"];
  }
}

function validateLifecycleProviderRequestField(input: {
  readonly field: string;
  readonly ownerCommand: AgentsVxappThreadLifecycleOwnerCommand;
  readonly providerRequest: JsonRecord;
}): string | null {
  const value = input.providerRequest[input.field];
  if (input.field === "archiveCurrent") {
    return typeof value === "boolean" ? null : input.field;
  }
  if (input.field === "lineage") {
    const lineage = asRecord(value);
    return lineage && lineage.legacyFallbackUsed === false ? null : input.field;
  }
  return asString(value) ? null : input.field;
}

function validateThreadLifecycleProviderPayload(input: {
  readonly ownerCommand: AgentsVxappThreadLifecycleOwnerCommand;
  readonly payload: unknown;
}): AgentsVxappThreadLifecycleProviderPayload {
  const payload = asRecord(input.payload);
  if (!payload) {
    fail({
      authoritySurface: "threads",
      message: "Owner lifecycle payload must be a JSON object.",
      ownerCommand: input.ownerCommand,
    });
  }
  if (payload.legacyFallbackUsed !== false) {
    fail({
      authorityPayload: payload,
      authoritySurface: "threads",
      message: "Owner lifecycle payload used a legacy fallback.",
      ownerCommand: input.ownerCommand,
    });
  }
  const providerRequest = asRecord(payload.providerRequest);
  if (!providerRequest) {
    fail({
      authorityPayload: payload,
      authoritySurface: "threads",
      message: "Owner lifecycle payload is missing providerRequest.",
      ownerCommand: input.ownerCommand,
    });
  }
  const expectedKind = THREAD_LIFECYCLE_OWNER_COMMAND_KINDS[input.ownerCommand];
  if (!isThreadLifecycleProviderRequestKind(providerRequest.kind)) {
    fail({
      authorityPayload: payload,
      authoritySurface: "threads",
      message: "Owner lifecycle providerRequest has an unsupported kind.",
      ownerCommand: input.ownerCommand,
    });
  }
  if (providerRequest.kind !== expectedKind) {
    fail({
      authorityPayload: payload,
      authoritySurface: "threads",
      message: `Owner lifecycle providerRequest kind '${providerRequest.kind}' did not match '${expectedKind}'.`,
      ownerCommand: input.ownerCommand,
    });
  }
  const requestId = asString(providerRequest.requestId);
  if (!requestId) {
    fail({
      authorityPayload: payload,
      authoritySurface: "threads",
      message: "Owner lifecycle providerRequest is missing requestId.",
      ownerCommand: input.ownerCommand,
    });
  }
  const missingFields = requiredThreadLifecycleProviderFields(providerRequest.kind)
    .map((field) =>
      validateLifecycleProviderRequestField({
        field,
        ownerCommand: input.ownerCommand,
        providerRequest,
      }),
    )
    .filter((field): field is string => field !== null);
  if (missingFields.length > 0) {
    fail({
      authorityPayload: payload,
      authoritySurface: "threads",
      message: `Owner lifecycle providerRequest is malformed; missing ${missingFields.join(", ")}.`,
      ownerCommand: input.ownerCommand,
    });
  }
  return payload as AgentsVxappThreadLifecycleProviderPayload;
}

function validateWakeOwnerPayload(input: {
  readonly ownerCommand: AgentsVxappWakeOwnerCommand;
  readonly payload: unknown;
}): AgentsVxappWakeOwnerPayload {
  const payload = asRecord(input.payload);
  if (!payload) {
    fail({
      authoritySurface: "wakes",
      message: "Owner wake payload must be a JSON object.",
      ownerCommand: input.ownerCommand,
    });
  }
  if (payload.legacyFallbackUsed !== false) {
    fail({
      authorityPayload: payload,
      authoritySurface: "wakes",
      message: "Owner wake payload used a legacy fallback.",
      ownerCommand: input.ownerCommand,
    });
  }
  return payload as AgentsVxappWakeOwnerPayload;
}

function validateWakeProviderRequestPayload(input: {
  readonly ownerCommand: AgentsVxappWakeOwnerCommand;
  readonly payload: unknown;
}): AgentsVxappWakeProviderRequestPayload {
  const payload = validateWakeOwnerPayload(input);
  const status = asString(payload.providerRequestStatus);
  if (status !== "ready" && status !== "blocked") {
    fail({
      authorityPayload: payload,
      authoritySurface: "wakes",
      message: "Owner wake provider payload is missing providerRequestStatus.",
      ownerCommand: input.ownerCommand,
    });
  }
  if (status === "ready") {
    const providerRequest = asRecord(payload.providerRequest);
    if (!providerRequest || providerRequest.kind !== "thread.turn.start") {
      fail({
        authorityPayload: payload,
        authoritySurface: "wakes",
        message: "Owner wake provider payload is missing thread.turn.start providerRequest.",
        ownerCommand: input.ownerCommand,
      });
    }
    const missingFields = ["requestId", "threadId", "messageId", "message"].filter(
      (field) => !asString(providerRequest[field]),
    );
    if (missingFields.length > 0) {
      fail({
        authorityPayload: payload,
        authoritySurface: "wakes",
        message: `Owner wake provider payload is malformed; missing ${missingFields.join(", ")}.`,
        ownerCommand: input.ownerCommand,
      });
    }
  }
  return payload as AgentsVxappWakeProviderRequestPayload;
}

async function executeOwnerCommand(input: {
  readonly args?: readonly string[];
  readonly command: string;
  readonly payloadJson?: unknown;
  readonly surface: string;
  readonly tool: OwnerTool;
}) {
  const args =
    input.tool === "control-plane"
      ? [input.command, "--json", ...(input.args ?? [])]
      : [input.command, ...(input.args ?? [])];
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
    cwd: AGENTS_VXAPP_REPO_ROOT,
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
      envelope,
      message: envelopeErrorMessage(envelope),
      ownerCommand: input.command,
      result,
    });
  }
  if (envelope.ok !== true) {
    fail({
      authoritySurface: input.surface,
      envelope,
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
      envelope,
      message: "Owner envelope is missing contract_family, contract_version, or command.",
      ownerCommand: input.command,
      result,
    });
  }
  if (envelope.command !== input.command) {
    fail({
      authoritySurface: input.surface,
      envelope,
      message: `Owner envelope command '${String(envelope.command)}' did not match '${input.command}'.`,
      ownerCommand: input.command,
      result,
    });
  }
  if (!Object.hasOwn(envelope, "result")) {
    fail({
      authoritySurface: input.surface,
      envelope,
      message: "Owner envelope is missing result.",
      ownerCommand: input.command,
      result,
    });
  }
  return { envelope, result };
}

function ownerManifestEntryFromRecord(value: unknown): OwnerManifestEntry {
  const entry = asRecord(value);
  const command = asString(entry?.command);
  const surface = asString(entry?.surface ?? entry?.authoritySurface);
  const implemented = asBoolean(entry?.implemented);
  if (!command || !surface || implemented === null) {
    throw new Error("Owner manifest contains an invalid ownerCommandManifest entry.");
  }
  return {
    command,
    surface,
    implemented,
  };
}

function callerContractEntryFromRecord(value: unknown): OwnerCallerContractEntry {
  const entry = asRecord(value);
  const command = asString(entry?.command);
  const wrapperKey = asString(entry?.wrapperKey);
  const surface = asString(entry?.surface ?? entry?.authoritySurface);
  const toolFamily = asString(entry?.toolFamily ?? entry?.tool);
  if (!command || !wrapperKey || !surface || !toolFamily) {
    throw new Error("Owner manifest contains an invalid callerContractManifest entry.");
  }
  if (toolFamily !== "control-plane") {
    throw new Error(
      `Owner caller contract command '${command}' must use toolFamily 'control-plane'.`,
    );
  }
  return {
    command,
    wrapperKey,
    surface,
    tool: "control-plane",
  };
}

function parseManifest(payload: unknown): AgentsVxappOwnerManifest {
  const root = asRecord(payload);
  const ownerEntries = new Map<string, OwnerManifestEntry>();
  const callerEntries = new Map<string, OwnerCallerContractEntry>();
  const wrapperEntries = new Map<string, OwnerCallerContractEntry>();
  const wrapperKeys = new Set<string>();
  if (!Array.isArray(root?.ownerCommandManifest)) {
    throw new Error("Owner manifest must provide ownerCommandManifest[].");
  }
  if (!Array.isArray(root?.callerContractManifest)) {
    throw new Error("Owner manifest must provide callerContractManifest[].");
  }

  for (const rawEntry of root.ownerCommandManifest) {
    const entry = ownerManifestEntryFromRecord(rawEntry);
    if (ownerEntries.has(entry.command)) {
      throw new Error(`Owner manifest has duplicate command '${entry.command}'.`);
    }
    ownerEntries.set(entry.command, entry);
  }

  for (const rawEntry of root.callerContractManifest) {
    const entry = callerContractEntryFromRecord(rawEntry);
    if (callerEntries.has(entry.command)) {
      throw new Error(`Owner caller contract has duplicate command '${entry.command}'.`);
    }
    if (wrapperKeys.has(entry.wrapperKey)) {
      throw new Error(`Owner caller contract has duplicate wrapperKey '${entry.wrapperKey}'.`);
    }
    const ownerEntry = ownerEntries.get(entry.command);
    if (!ownerEntry) {
      throw new Error(`Owner caller contract is missing owner command row '${entry.command}'.`);
    }
    if (ownerEntry.implemented !== true) {
      throw new Error(`Owner caller contract command '${entry.command}' is not implemented.`);
    }
    if (ownerEntry.surface !== entry.surface) {
      throw new Error(
        `Owner caller contract command '${entry.command}' must use surface '${ownerEntry.surface}'.`,
      );
    }
    callerEntries.set(entry.command, entry);
    wrapperEntries.set(entry.wrapperKey, entry);
    wrapperKeys.add(entry.wrapperKey);
  }

  return {
    commandsByName: callerEntries,
    commandsByWrapperKey: wrapperEntries,
  };
}

export function resetAgentsVxappOwnerManifestForTests(): void {
  cachedManifest = null;
}

export async function bootstrapAgentsVxappOwnerManifest(): Promise<AgentsVxappOwnerManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }
  const { envelope, result } = await executeOwnerCommand({
    command: BOOTSTRAP_MANIFEST_COMMAND,
    surface: "contract_manifest",
    tool: "control-plane",
  });
  const authority = validateAuthorityPayload(
    BOOTSTRAP_MANIFEST_COMMAND,
    "contract_manifest",
    envelope.result,
    result,
  );
  if (
    authority.contractFamily !== CONTRACT_FAMILY ||
    authority.contractVersion !== CONTRACT_VERSION ||
    authority.surface !== "contract_manifest"
  ) {
    fail({
      authoritySurface: "contract_manifest",
      authorityPayload: asRecord(authority),
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
      authorityPayload: asRecord(authority),
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
  args?: readonly string[],
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
  const { envelope, result } = await executeOwnerCommand({
    command: entry.command,
    ...(args ? { args } : {}),
    ...(input !== undefined ? { payloadJson: input } : {}),
    surface: entry.surface,
    tool: entry.tool,
  });
  const authorityPayload = validateAuthorityPayload(
    entry.command,
    entry.surface,
    envelope.result,
    result,
  );
  if (authorityPayload.surface !== entry.surface) {
    fail({
      authoritySurface: entry.surface,
      message: `Owner command '${entry.command}' returned surface '${authorityPayload.surface}'.`,
      ownerCommand: entry.command,
      result,
    });
  }
  return authorityPayload as AgentsVxappOwnerAuthorityPayload<T>;
}

async function callRoleSessionCommand<T>(command: string): Promise<T> {
  const { envelope } = await executeOwnerCommand({
    command,
    surface: "role_session_runtime_paths",
    tool: "role-session",
  });
  return envelope.result as T;
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
  const { envelope, result } = await executeOwnerCommand({
    command: entry.command,
    ...(input.args ? { args: input.args } : {}),
    ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
    surface: entry.surface,
    tool: entry.tool,
  });
  const authorityPayload = validateAuthorityPayload(
    entry.command,
    entry.surface,
    envelope.result,
    result,
  );
  if (authorityPayload.surface !== entry.surface) {
    fail({
      authoritySurface: entry.surface,
      message: `Owner command '${entry.command}' returned surface '${authorityPayload.surface}'.`,
      ownerCommand: entry.command,
      result,
    });
  }
  return authorityPayload as AgentsVxappOwnerAuthorityPayload<T>;
}

async function callManifestCommandByWrapperKey<T>(input: {
  readonly wrapperKey: string;
  readonly surface: Exclude<OwnerSurface, "contract_manifest">;
  readonly args?: readonly string[];
  readonly payloadJson?: unknown;
}): Promise<AgentsVxappOwnerAuthorityPayload<T>> {
  const manifest = await bootstrapAgentsVxappOwnerManifest();
  const entry = manifest.commandsByWrapperKey.get(input.wrapperKey);
  if (!entry) {
    fail({
      authoritySurface: input.surface,
      message: `Owner manifest did not provide wrapperKey '${input.wrapperKey}'.`,
      ownerCommand: input.wrapperKey,
    });
  }
  if (entry.surface !== input.surface) {
    fail({
      authoritySurface: input.surface,
      message: `Owner manifest wrapperKey '${input.wrapperKey}' did not match surface '${input.surface}'.`,
      ownerCommand: entry.command,
    });
  }
  const { envelope, result } = await executeOwnerCommand({
    command: entry.command,
    ...(input.args ? { args: input.args } : {}),
    ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
    surface: entry.surface,
    tool: entry.tool,
  });
  const authorityPayload = validateAuthorityPayload(
    entry.command,
    entry.surface,
    envelope.result,
    result,
  );
  if (authorityPayload.surface !== entry.surface) {
    fail({
      authoritySurface: entry.surface,
      message: `Owner command '${entry.command}' returned surface '${authorityPayload.surface}'.`,
      ownerCommand: entry.command,
      result,
    });
  }
  return authorityPayload as AgentsVxappOwnerAuthorityPayload<T>;
}

export async function fetchAgentsVxappSidebarGraphSnapshot() {
  return (await callManifestCommand<AgentsVxappSidebarOwnerGraphSnapshot>("sidebar_graph_snapshot"))
    .payload;
}

export async function fetchAgentsVxappSidebarAuthoritySnapshot(
  input: ServerGetAgentsVxappSidebarAuthoritySnapshotInput = {},
) {
  return (
    await callManifestCommand<ServerGetAgentsVxappSidebarAuthoritySnapshotResult>(
      "sidebar_authority_snapshot",
      undefined,
      paginationArgs(input),
    )
  ).payload;
}

export async function fetchAgentsVxappControlPlaneSnapshot() {
  return (await callManifestCommand<JsonRecord>("control_plane_snapshot")).payload;
}

export async function fetchAgentsVxappExternalRoleAuthoritySnapshot() {
  return (await callManifestCommand<JsonRecord>("external_role_authority_snapshot")).payload;
}

export async function fetchAgentsVxappProgramsTodosSnapshot(
  input: ServerGetAgentsVxappControlPlaneSnapshotInput = {},
) {
  return (
    await callManifestCommand<ServerGetAgentsVxappControlPlaneSnapshotResult>(
      "programs_todos_snapshot",
      undefined,
      paginationArgs(input),
    )
  ).payload;
}

export async function fetchAgentsVxappProgramsAuthoritySnapshot(
  input: ServerGetAgentsVxappControlPlaneSnapshotInput = {},
) {
  return (
    await callManifestCommandByWrapperKey<JsonRecord>({
      args: paginationArgs(input),
      wrapperKey: "programs_authority_snapshot",
      surface: "programs_authority_snapshot",
    })
  ).payload;
}

export async function requestAgentsVxappProgramMutation(
  input:
    | {
        readonly action: "create";
        readonly input: ServerCreateAgentsVxappProgramInput;
      }
    | {
        readonly action: "update";
        readonly input: ServerUpdateAgentsVxappProgramInput;
      }
    | {
        readonly action: "delete";
        readonly input: ServerDeleteAgentsVxappProgramInput;
      }
    | {
        readonly action: "lifecycle";
        readonly input: ServerSetAgentsVxappProgramLifecycleInput;
      },
) {
  return (await callManifestCommand<ServerAgentsVxappOwnerMutationResult>("programs", input))
    .payload;
}

export async function requestAgentsVxappTodoMutation(
  input:
    | {
        readonly action: TodoMutateAction;
        readonly input: ServerCreateAgentsVxappTodoInput;
      }
    | {
        readonly action: TodoMutateAction;
        readonly input: ServerUpdateAgentsVxappTodoInput;
      }
    | {
        readonly action: TodoMutateAction;
        readonly input: ServerDeleteAgentsVxappTodoInput;
      }
    | {
        readonly action: TodoMutateAction;
        readonly input: Readonly<Record<string, unknown>>;
      },
) {
  if (!TODO_MUTATE_ACTIONS.includes(input.action)) {
    fail({
      authoritySurface: "todos",
      message: `Unsupported TODO mutation action '${String(input.action)}'.`,
      ownerCommand: TODO_MUTATE_WRAPPER_KEY,
    });
  }
  return (
    await callManifestCommandByWrapperKey<ServerAgentsVxappOwnerMutationResult>({
      wrapperKey: TODO_MUTATE_WRAPPER_KEY,
      surface: "todos",
      payloadJson: input,
    })
  ).payload;
}

export async function fetchAgentsVxappRoleSessionRuntimePaths<T>() {
  return callRoleSessionCommand<T>(ROLE_SESSION_RUNTIME_PATHS_COMMAND);
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
      command: "t3code-thread-status",
      surface: "threads",
      args: ["--thread", input.threadId],
    })
  ).payload;
}

export async function requestAgentsVxappThreadEventIngest(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: "t3code-thread-event-ingest",
      surface: "threads",
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappThreadLifecycleProviderRequest(input: {
  readonly command: AgentsVxappThreadLifecycleOwnerCommand;
  readonly payloadJson: Readonly<JsonRecord>;
}): Promise<AgentsVxappThreadLifecycleProviderPayload> {
  const authorityPayload = await callManifestCommandByName<JsonRecord>({
    command: input.command,
    surface: "threads",
    payloadJson: input.payloadJson,
  });
  return validateThreadLifecycleProviderPayload({
    ownerCommand: input.command,
    payload: authorityPayload.payload,
  });
}

export async function requestAgentsVxappProjectEventIngest(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: "t3code-projects-event-ingest",
      surface: "projects",
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappWakeMutation(
  input:
    | {
        readonly action: "upsert";
        readonly wakeId: string;
        readonly orchestratorThreadId: string;
        readonly orchestratorProjectId?: string;
        readonly programId?: string;
        readonly workerThreadId?: string;
        readonly workerProjectId?: string;
        readonly workerTurnId?: string;
        readonly workflowId?: string;
        readonly workerTitleSnapshot?: string;
        readonly outcome?: "completed" | "failed" | "interrupted";
        readonly summary?: string;
        readonly state?: "pending" | "delivering" | "delivered" | "consumed" | "dropped";
        readonly stateSource?: "owner_payload" | "sqlite" | "projection_import";
        readonly reason?: string;
        readonly routingKind?: "worker_to_orchestrator" | "review_refresh" | "manual";
      }
    | {
        readonly action: "deliver";
        readonly wakeId: string;
        readonly programId?: string;
        readonly orchestratorThreadId?: string;
        readonly stateSource?: "owner_payload" | "sqlite" | "projection_import";
      }
    | {
        readonly action: "consume";
        readonly wakeId: string;
        readonly programId?: string;
        readonly orchestratorThreadId?: string;
        readonly reason:
          | "worker_rechecked"
          | "worker_superseded_by_new_turn"
          | "worker_deleted"
          | "worker_reparented"
          | "orchestrator_missing"
          | "orchestrator_deleted"
          | "orchestrator_mismatch"
          | "duplicate"
          | "manual_dismiss";
      }
    | {
        readonly action: "drop";
        readonly wakeId: string;
        readonly programId?: string;
        readonly orchestratorThreadId?: string;
        readonly reason?: string;
        readonly stateSource?: "owner_payload" | "sqlite" | "projection_import";
      },
) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: "t3code-wake-mutate",
      surface: "wakes",
      payloadJson: input,
    })
  ).payload;
}

async function requestAgentsVxappWakeOwnerCommand(input: {
  readonly command: AgentsVxappWakeOwnerCommand;
  readonly payloadJson: Readonly<JsonRecord>;
}): Promise<AgentsVxappWakeOwnerPayload> {
  const authorityPayload = await callManifestCommandByName<JsonRecord>({
    command: input.command,
    surface: "wakes",
    payloadJson: input.payloadJson,
  });
  return validateWakeOwnerPayload({
    ownerCommand: input.command,
    payload: authorityPayload.payload,
  });
}

export async function requestAgentsVxappWakeEnqueue(input: Readonly<JsonRecord>) {
  return requestAgentsVxappWakeOwnerCommand({
    command: "t3code-wake-enqueue",
    payloadJson: input,
  });
}

export async function requestAgentsVxappWakeDeliveryPlan(input: Readonly<JsonRecord>) {
  return requestAgentsVxappWakeOwnerCommand({
    command: "t3code-wake-delivery-plan",
    payloadJson: input,
  });
}

export async function requestAgentsVxappWakeDrainReady(input: Readonly<JsonRecord>) {
  return requestAgentsVxappWakeOwnerCommand({
    command: "t3code-wake-drain-ready",
    payloadJson: input,
  });
}

export async function requestAgentsVxappWakeReconcileStartup(input: Readonly<JsonRecord>) {
  return requestAgentsVxappWakeOwnerCommand({
    command: "t3code-wake-reconcile-startup",
    payloadJson: input,
  });
}

export async function requestAgentsVxappWakeProviderRequest(
  input: Readonly<JsonRecord>,
): Promise<AgentsVxappWakeProviderRequestPayload> {
  const authorityPayload = await callManifestCommandByName<JsonRecord>({
    command: "t3code-wake-provider-request",
    surface: "wakes",
    payloadJson: input,
  });
  return validateWakeProviderRequestPayload({
    ownerCommand: "t3code-wake-provider-request",
    payload: authorityPayload.payload,
  });
}

export async function requestAgentsVxappCtoProviderRequest(input: {
  readonly command:
    | "t3code-cto-attention-list"
    | "t3code-cto-notifications-list"
    | "t3code-cto-operate-once"
    | "t3code-cto-yacht-watch-inspect"
    | "t3code-cto-yacht-watch-periodic-check";
  readonly surface: "cto" | "cto_operate" | "cto_yacht_watch";
  readonly args?: readonly string[];
  readonly payloadJson?: unknown;
}) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: input.command,
      surface: input.surface,
      ...(input.args ? { args: input.args } : {}),
      ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
    })
  ).payload;
}

export async function requestAgentsVxappApprovalRequest(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: "t3code-approval-request",
      surface: "approvals",
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappApprovalResponse(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: "t3code-approval-respond",
      surface: "approvals",
      payloadJson: input,
    })
  ).payload;
}

export async function requestAgentsVxappUserInputResponse(input: Readonly<JsonRecord>) {
  return (
    await callManifestCommandByName<JsonRecord>({
      command: "t3code-user-input-respond",
      surface: "user_input",
      payloadJson: input,
    })
  ).payload;
}
