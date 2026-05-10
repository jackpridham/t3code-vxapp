import os from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function defaultCloseoutPath(programId: string): string {
  const stateRoot =
    process.env.VX_T3_STATE_DIR || path.join(os.homedir(), ".local", "share", "vx", "t3");
  return path.join(stateRoot, "programs-closeout", `${programId}.json`);
}

export function readLifecycleStatusFromCloseout(closeout: unknown): string | null {
  const closeoutRecord = asObject(closeout);
  const lifecycle = asObject(closeoutRecord?.lifecycle);
  return asString(lifecycle?.status);
}

export function resolveProgramCurrentStatus(input: {
  closeout?: unknown;
  currentStatus?: unknown;
  status?: unknown;
}): string | null {
  return (
    readLifecycleStatusFromCloseout(input.closeout) ??
    asString(input.currentStatus) ??
    asString(input.status)
  );
}

export async function hydrateProgramSnapshotFromCloseoutFile(
  program: JsonRecord,
  readFile: (filePath: string) => Promise<string>,
): Promise<JsonRecord> {
  const metadata = asObject(program.metadata);
  const programId = asString(program.id);
  const closeoutPath =
    asString(metadata?.closeoutPath) ?? (programId ? defaultCloseoutPath(programId) : null);
  if (!closeoutPath) {
    return program;
  }

  try {
    const raw = await readFile(closeoutPath);
    const parsed = JSON.parse(raw) as unknown;
    const closeout = asObject(parsed);
    if (!closeout) {
      return program;
    }
    const currentStatus = resolveProgramCurrentStatus({
      closeout,
      currentStatus: program.currentStatus,
      status: program.status,
    });
    const nextOrchestratorThreadId =
      asString(closeout.currentOrchestratorThreadId) ??
      asString(program.currentOrchestratorThreadId);
    return {
      ...program,
      closeout,
      currentOrchestratorThreadId: nextOrchestratorThreadId,
      currentStatus,
      status: currentStatus ?? asString(program.status),
      updatedAt: asString(closeout.updatedAt) ?? asString(program.updatedAt),
    };
  } catch {
    return program;
  }
}
