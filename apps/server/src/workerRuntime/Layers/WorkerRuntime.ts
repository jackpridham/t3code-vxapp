import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect";
import type {
  GetWorkerRuntimeSnapshotResult,
  WorkerRuntimeAuditFinding,
  WorkerRuntimeInstructionStackAudit,
  WorkerRuntimeInstalledPacks,
  WorkerRuntimePackSummary,
  WorkerRuntimeSourceFile,
  WorkerRuntimeSourceFileStatus,
} from "@t3tools/contracts";
import {
  GetWorkerRuntimeSnapshotResult as GetWorkerRuntimeSnapshotResultSchema,
  WorkerRuntimeContextPlan as WorkerRuntimeContextPlanSchema,
  WorkerRuntimeDispatchContract as WorkerRuntimeDispatchContractSchema,
  WorkerRuntimeInstructionStackAudit as WorkerRuntimeInstructionStackAuditSchema,
  WorkerRuntimeInstalledPacks as WorkerRuntimeInstalledPacksSchema,
} from "@t3tools/contracts";
import { ProjectionOperationalQuery } from "../../orchestration/Services/ProjectionOperationalQuery.ts";
import {
  WorkerRuntime,
  WorkerRuntimeError,
  type WorkerRuntimeShape,
} from "../Services/WorkerRuntime.ts";

type RuntimeFileKey =
  | "contextPlan"
  | "dispatchContract"
  | "installedPacks"
  | "instructionStackAudit";

const RUNTIME_FILE_NAMES = {
  contextPlan: "context-plan.json",
  dispatchContract: "dispatch-contract.json",
  installedPacks: "installed-packs.json",
  instructionStackAudit: "instruction-stack-audit.json",
} satisfies Record<RuntimeFileKey, string>;

const decodeContextPlan = Schema.decodeUnknownEffect(WorkerRuntimeContextPlanSchema);
const decodeDispatchContract = Schema.decodeUnknownEffect(WorkerRuntimeDispatchContractSchema);
const decodeInstalledPacks = Schema.decodeUnknownEffect(WorkerRuntimeInstalledPacksSchema);
const decodeInstructionStackAudit = Schema.decodeUnknownEffect(
  WorkerRuntimeInstructionStackAuditSchema,
);
const decodeSnapshot = Schema.decodeUnknownEffect(GetWorkerRuntimeSnapshotResultSchema);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function recordField(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function normalizePackSummary(
  pack: WorkerRuntimeInstalledPacks["packs"][number],
): WorkerRuntimePackSummary {
  const manifest = pack.manifest;
  return {
    id: pack.id,
    slug: pack.slug,
    link: pack.link,
    name: asString(recordField(manifest, "name")),
    type: asString(recordField(manifest, "type")),
    scope: asString(recordField(manifest, "scope")),
    repo: asString(recordField(manifest, "repo")),
    version: asString(recordField(manifest, "version")),
    description: asString(recordField(manifest, "description")),
    mountMode: asString(recordField(manifest, "mountMode")),
    localNumber: asNumber(recordField(manifest, "localNumber")),
    allowedTaskClasses: asStringArray(recordField(manifest, "allowedTaskClasses")),
    grants: asStringArray(recordField(manifest, "grants")),
    forbids: asStringArray(recordField(manifest, "forbids")),
    requires: asStringArray(recordField(manifest, "requires")),
    conflictsWith: asStringArray(recordField(manifest, "conflictsWith")),
    defaultContextModes: asStringArray(recordField(manifest, "defaultContextModes")),
  };
}

function normalizeAuditFindings(
  findings: WorkerRuntimeInstructionStackAudit["findings"] | undefined,
): WorkerRuntimeAuditFinding[] {
  return (findings ?? []).map((finding) => ({
    severity: asString(recordField(finding, "severity")),
    code: asString(recordField(finding, "code")),
    kind: asString(recordField(finding, "kind")),
    detail: asString(recordField(finding, "detail")),
  }));
}

function resolveAuditStatus(
  sourceFile: WorkerRuntimeSourceFile,
  audit: WorkerRuntimeInstructionStackAudit | null,
): GetWorkerRuntimeSnapshotResult["summary"]["auditStatus"] {
  if (sourceFile.status === "missing") {
    return "missing";
  }
  if (sourceFile.status !== "loaded") {
    return "error";
  }
  if (audit?.status === "warning") {
    return "warning";
  }
  if (audit?.status === "error") {
    return "error";
  }
  return "clean";
}

function fileState(input: {
  absolutePath: string;
  detail?: string | null;
  fileName: string;
  status: WorkerRuntimeSourceFileStatus;
}): WorkerRuntimeSourceFile {
  return {
    fileName: input.fileName,
    absolutePath: input.absolutePath,
    status: input.status,
    detail: input.detail ?? null,
  };
}

function parseJsonFile<T>({
  absolutePath,
  decode,
  fileName,
  fileSystem,
}: {
  absolutePath: string;
  decode: (value: unknown) => Effect.Effect<T, Schema.SchemaError, never>;
  fileName: string;
  fileSystem: FileSystem.FileSystem;
}): Effect.Effect<{ data: T | null; sourceFile: WorkerRuntimeSourceFile }, WorkerRuntimeError> {
  return Effect.gen(function* () {
    const exists = yield* fileSystem.exists(absolutePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return {
        data: null,
        sourceFile: fileState({ absolutePath, fileName, status: "missing" }),
      };
    }

    const raw = yield* fileSystem
      .readFileString(absolutePath)
      .pipe(Effect.mapError((cause) => new WorkerRuntimeError({ message: cause.message })));

    const parsed = yield* Effect.exit(
      Effect.try({
        try: () => JSON.parse(raw),
        catch: (error) =>
          new WorkerRuntimeError({
            message: error instanceof Error ? error.message : "Invalid JSON.",
          }),
      }),
    );
    if (parsed._tag === "Failure") {
      const error = Cause.squash(parsed.cause);
      return {
        data: null,
        sourceFile: fileState({
          absolutePath,
          detail: error instanceof Error ? error.message : "Invalid JSON.",
          fileName,
          status: "invalid-json",
        }),
      };
    }

    const decoded = yield* Effect.exit(decode(parsed.value));
    if (decoded._tag === "Failure") {
      return {
        data: null,
        sourceFile: fileState({
          absolutePath,
          detail: "Schema validation failed.",
          fileName,
          status: "schema-error",
        }),
      };
    }

    return {
      data: decoded.value,
      sourceFile: fileState({ absolutePath, fileName, status: "loaded" }),
    };
  });
}

export const makeWorkerRuntime = Effect.gen(function* () {
  const projectionOperationalQuery = yield* ProjectionOperationalQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const getSnapshot: WorkerRuntimeShape["getSnapshot"] = Effect.fn("WorkerRuntime.getSnapshot")(
    function* (input) {
      const thread = yield* projectionOperationalQuery.getThreadById(input);
      if (thread === null) {
        return yield* new WorkerRuntimeError({
          message: `Thread '${input.threadId}' was not found.`,
        });
      }
      if (thread.spawnRole !== "worker") {
        return yield* new WorkerRuntimeError({
          message: `Thread '${input.threadId}' is not a worker thread.`,
        });
      }
      if (!thread.worktreePath) {
        return yield* new WorkerRuntimeError({
          message: `Worker thread '${input.threadId}' has no worktree path.`,
        });
      }

      const runtimeDir = path.join(thread.worktreePath, ".agents", "runtime");
      const contextPlanPath = path.join(runtimeDir, RUNTIME_FILE_NAMES.contextPlan);
      const dispatchContractPath = path.join(runtimeDir, RUNTIME_FILE_NAMES.dispatchContract);
      const installedPacksPath = path.join(runtimeDir, RUNTIME_FILE_NAMES.installedPacks);
      const instructionStackAuditPath = path.join(
        runtimeDir,
        RUNTIME_FILE_NAMES.instructionStackAudit,
      );

      const [
        contextPlanResult,
        dispatchContractResult,
        installedPacksResult,
        instructionStackAuditResult,
      ] = yield* Effect.all([
        parseJsonFile({
          absolutePath: contextPlanPath,
          decode: decodeContextPlan,
          fileName: RUNTIME_FILE_NAMES.contextPlan,
          fileSystem,
        }),
        parseJsonFile({
          absolutePath: dispatchContractPath,
          decode: decodeDispatchContract,
          fileName: RUNTIME_FILE_NAMES.dispatchContract,
          fileSystem,
        }),
        parseJsonFile({
          absolutePath: installedPacksPath,
          decode: decodeInstalledPacks,
          fileName: RUNTIME_FILE_NAMES.installedPacks,
          fileSystem,
        }),
        parseJsonFile({
          absolutePath: instructionStackAuditPath,
          decode: decodeInstructionStackAudit,
          fileName: RUNTIME_FILE_NAMES.instructionStackAudit,
          fileSystem,
        }),
      ]);

      const contextPlan = contextPlanResult.data;
      const dispatchContract = dispatchContractResult.data;
      const installedPacks = installedPacksResult.data;
      const instructionStackAudit = instructionStackAuditResult.data;
      const packs = installedPacks?.packs.map(normalizePackSummary) ?? [];
      const auditFindings = instructionStackAudit
        ? normalizeAuditFindings(instructionStackAudit.findings)
        : [];
      const packAudit = instructionStackAudit?.packAudit ?? null;
      const packAuditIssues = packAudit ? recordField(packAudit, "issues") : undefined;

      return yield* decodeSnapshot({
        threadId: thread.id,
        worktreePath: thread.worktreePath,
        runtimeDir,
        sourceFiles: {
          contextPlan: contextPlanResult.sourceFile,
          dispatchContract: dispatchContractResult.sourceFile,
          installedPacks: installedPacksResult.sourceFile,
          instructionStackAudit: instructionStackAuditResult.sourceFile,
        },
        summary: {
          repo:
            contextPlan?.repo ??
            dispatchContract?.repo ??
            installedPacks?.repo ??
            instructionStackAudit?.repo ??
            null,
          taskClass:
            contextPlan?.taskClass ??
            dispatchContract?.taskClass ??
            installedPacks?.taskClass ??
            null,
          contextMode:
            contextPlan?.contextMode ??
            dispatchContract?.contextMode ??
            installedPacks?.contextMode ??
            null,
          closeoutAuthority:
            contextPlan?.closeoutAuthority ??
            dispatchContract?.closeoutAuthority ??
            installedPacks?.closeoutAuthority ??
            null,
          validationProfile:
            dispatchContract?.validationProfile ?? contextPlan?.validationProfile ?? null,
          selectedPacks: dispatchContract?.selectedPacks ?? contextPlan?.selectedPacks ?? [],
          allowedCapabilities:
            dispatchContract?.allowedCapabilities ?? contextPlan?.allowedCapabilities ?? [],
          forbiddenCapabilities:
            dispatchContract?.forbiddenCapabilities ?? contextPlan?.forbiddenCapabilities ?? [],
          conflicts: contextPlan?.conflicts ?? dispatchContract?.conflicts ?? [],
          warnings: contextPlan?.warnings ?? dispatchContract?.warnings ?? [],
          repoClaude: contextPlan?.repoClaude ?? null,
          legacyGlobalSkills: contextPlan?.legacyGlobalSkills ?? null,
          workspace:
            installedPacks?.workspace ??
            contextPlan?.workspace ??
            dispatchContract?.workspace ??
            null,
          runtimeDir: installedPacks?.runtimeDir ?? contextPlan?.runtimeDir ?? null,
          skillsDir: installedPacks?.skillsDir ?? contextPlan?.skillsDir ?? null,
          agentsSkillsDir: installedPacks?.agentsSkillsDir ?? contextPlan?.agentsSkillsDir ?? null,
          auditStatus: resolveAuditStatus(
            instructionStackAuditResult.sourceFile,
            instructionStackAudit,
          ),
          auditFindings,
          packAuditStatus: packAudit ? asString(recordField(packAudit, "status")) : null,
          packAuditIssueCount: Array.isArray(packAuditIssues) ? packAuditIssues.length : 0,
          packCount: packs.length,
        },
        packs,
        raw: {
          contextPlan,
          dispatchContract,
          installedPacks,
          instructionStackAudit,
        },
      }).pipe(
        Effect.mapError(
          () => new WorkerRuntimeError({ message: "Worker runtime snapshot encoding failed." }),
        ),
      );
    },
  );

  return { getSnapshot } satisfies WorkerRuntimeShape;
});

export const WorkerRuntimeLive = Layer.effect(WorkerRuntime, makeWorkerRuntime);
