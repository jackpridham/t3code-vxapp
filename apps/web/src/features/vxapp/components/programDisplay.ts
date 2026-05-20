import type { ServerAgentsVxappProgramSnapshot } from "@t3tools/contracts";

type JsonRecord = Record<string, unknown>;

export type ProgramDisplayFields = {
  heading: string;
  label: string | null;
  sortKey: string | null;
  summary: string | null;
  tone: string | null;
};

export type ProgramCloseoutSummary = {
  hasPostFlight: boolean;
  missingItems: string[];
  postFlightSummary: string | null;
  requiredExternalSuiteCount: number;
  requiredLocalSuiteCount: number;
  requiresDevelopmentDeploy: boolean;
  requiresExternalE2E: boolean;
  scopeSummary: string | null;
  verdict: string | null;
};

function asObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readDisplayRecord(program: ServerAgentsVxappProgramSnapshot): JsonRecord | null {
  const directDisplay = asObject((program as Record<string, unknown>).display);
  if (directDisplay) {
    return directDisplay;
  }

  const metadataDisplay = asObject(asObject(program.metadata)?.display);
  if (metadataDisplay) {
    return metadataDisplay;
  }

  return asObject(asObject(program.closeout)?.display);
}

export function resolveProgramDisplay(
  program: ServerAgentsVxappProgramSnapshot,
): ProgramDisplayFields {
  const display = readDisplayRecord(program);
  return {
    heading: asString(display?.heading) ?? program.title,
    label: asString(display?.label) ?? asString(program.currentStatus) ?? asString(program.status),
    sortKey: asString(display?.sortKey),
    summary: asString(display?.summary) ?? program.objective ?? null,
    tone: asString(display?.tone),
  };
}

export function readProgramScope(program: ServerAgentsVxappProgramSnapshot): JsonRecord | null {
  return asObject(program.closeout?.scope);
}

export function readProgramCloseoutVerdict(
  program: ServerAgentsVxappProgramSnapshot,
): string | null {
  const closeout = asObject(program.closeout?.closeout);
  return asString(closeout?.lastVerdict);
}

export function readProgramScopeSummary(program: ServerAgentsVxappProgramSnapshot): string | null {
  const scope = readProgramScope(program);
  return (
    asString(asObject(scope?.display)?.summary) ?? asString(asObject(program.closeout)?.summary)
  );
}

export function summarizeProgramCloseout(
  program: ServerAgentsVxappProgramSnapshot,
): ProgramCloseoutSummary {
  const scope = readProgramScope(program);
  const closeout = asObject(program.closeout?.closeout);
  const postFlight = asObject(asObject(program.closeout?.evidence)?.postFlight);
  const missing = Array.isArray(closeout?.lastMissing)
    ? closeout.lastMissing.flatMap((entry) => {
        const label = asString(entry) ?? asString(asObject(entry)?.label);
        return label ? [label] : [];
      })
    : [];

  return {
    hasPostFlight: postFlight !== null,
    missingItems: missing,
    postFlightSummary: asString(postFlight?.summary),
    requiredExternalSuiteCount: Array.isArray(scope?.requiredExternalE2ESuites)
      ? scope.requiredExternalE2ESuites.length
      : 0,
    requiredLocalSuiteCount: Array.isArray(scope?.requiredLocalSuites)
      ? scope.requiredLocalSuites.length
      : 0,
    requiresDevelopmentDeploy: scope?.requireDevelopmentDeploy === true,
    requiresExternalE2E: scope?.requireExternalE2E === true,
    scopeSummary: readProgramScopeSummary(program),
    verdict: readProgramCloseoutVerdict(program),
  };
}
