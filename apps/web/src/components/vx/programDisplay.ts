import type { ServerAgentsVxappProgramSnapshot } from "@t3tools/contracts";

type JsonRecord = Record<string, unknown>;

export type ProgramCloseoutSummary = {
  hasPostFlight: boolean;
  missingItems: string[];
  postFlightSummary: string | null;
  requiredExternalSuiteCount: number;
  requiredLocalSuiteCount: number;
  requiresDevelopmentDeploy: boolean;
  requiresExternalE2E: boolean;
  scopeSummary: string;
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

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = asString(value);
    return single ? [single] : [];
  }
  return value.flatMap((entry) => {
    const stringEntry = asString(entry);
    if (stringEntry) {
      return [stringEntry];
    }
    const objectEntry = asObject(entry);
    const objectLabel =
      asString(objectEntry?.label) ??
      asString(objectEntry?.summary) ??
      asString(objectEntry?.detail) ??
      asString(objectEntry?.name) ??
      asString(objectEntry?.id) ??
      asString(objectEntry?.repo) ??
      asString(objectEntry?.suite);
    return objectLabel ? [objectLabel] : [];
  });
}

function readProgramCloseout(program: ServerAgentsVxappProgramSnapshot): JsonRecord | null {
  return asObject(program.closeout);
}

export function formatProgramStatusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function programStatusTone(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "blocked":
      return "bg-red-500/12 text-red-700 dark:text-red-300";
    case "awaiting_founder":
      return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
    case "awaiting_external":
      return "bg-orange-500/12 text-orange-700 dark:text-orange-300";
    case "closeout_in_progress":
      return "bg-sky-500/12 text-sky-700 dark:text-sky-300";
    case "founder_review_ready":
      return "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300";
    case "completed":
      return "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function readProgramScope(program: ServerAgentsVxappProgramSnapshot): JsonRecord | null {
  return asObject(program.closeout?.scope);
}

export function readProgramCloseoutVerdict(
  program: ServerAgentsVxappProgramSnapshot,
): string | null {
  const closeout = readProgramCloseout(program);
  const nestedCloseout = asObject(closeout?.closeout);
  return asString(nestedCloseout?.lastVerdict);
}

export function readProgramScopeSummary(program: ServerAgentsVxappProgramSnapshot): string {
  const scope = readProgramScope(program);
  if (!scope) {
    return "No scope metadata";
  }
  const declaredRepos = Array.isArray(scope.declaredRepos) ? scope.declaredRepos.length : 0;
  const appTargets = Array.isArray(scope.appTargets) ? scope.appTargets.length : 0;
  const localSuites = Array.isArray(scope.requiredLocalSuites)
    ? scope.requiredLocalSuites.length
    : 0;
  const e2eSuites = Array.isArray(scope.requiredExternalE2ESuites)
    ? scope.requiredExternalE2ESuites.length
    : 0;
  return `${declaredRepos} repos · ${appTargets} targets · ${localSuites} local suites · ${e2eSuites} e2e suites`;
}

export function summarizeProgramCloseout(
  program: ServerAgentsVxappProgramSnapshot,
): ProgramCloseoutSummary {
  const closeout = readProgramCloseout(program);
  const scope = readProgramScope(program);
  const nestedCloseout = asObject(closeout?.closeout);
  const evidence = asObject(closeout?.evidence);
  const postFlight = asObject(evidence?.postFlight);
  const lastMissing = asStringList(nestedCloseout?.lastMissing);
  const requiredLocalSuiteCount = Array.isArray(scope?.requiredLocalSuites)
    ? scope.requiredLocalSuites.length
    : 0;
  const requiredExternalSuiteCount = Array.isArray(scope?.requiredExternalE2ESuites)
    ? scope.requiredExternalE2ESuites.length
    : 0;
  const requiresDevelopmentDeploy = asBoolean(scope?.requireDevelopmentDeploy);
  const requiresExternalE2E = asBoolean(scope?.requireExternalE2E);
  const hasPostFlight = postFlight !== null;
  const missingItems = [...lastMissing];

  if (!hasPostFlight) {
    missingItems.push("post-flight");
  }
  if (requiresDevelopmentDeploy) {
    missingItems.push("development deploy");
  }
  if (requiresExternalE2E && requiredExternalSuiteCount > 0) {
    missingItems.push(
      `${requiredExternalSuiteCount} external e2e suite${requiredExternalSuiteCount === 1 ? "" : "s"}`,
    );
  }
  if (requiredLocalSuiteCount > 0) {
    missingItems.push(
      `${requiredLocalSuiteCount} local suite${requiredLocalSuiteCount === 1 ? "" : "s"}`,
    );
  }

  return {
    hasPostFlight,
    missingItems: [...new Set(missingItems)],
    postFlightSummary: asString(postFlight?.summary),
    requiredExternalSuiteCount,
    requiredLocalSuiteCount,
    requiresDevelopmentDeploy,
    requiresExternalE2E,
    scopeSummary: readProgramScopeSummary(program),
    verdict: readProgramCloseoutVerdict(program),
  };
}
