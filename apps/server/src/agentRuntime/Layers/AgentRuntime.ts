import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect";
import type {
  AgentRuntimeSourceFile,
  GetAgentRuntimeSnapshotInput,
  GetAgentRuntimeSnapshotResult,
  GetWorkerRuntimeSnapshotResult,
} from "@t3tools/contracts";
import { GetAgentRuntimeSnapshotResult as GetAgentRuntimeSnapshotResultSchema } from "@t3tools/contracts";
import { AGENTS_VXAPP_ROOT } from "../../extensions/vxapp/agentsVxappSqlite.ts";
import { ProjectionOperationalQuery } from "../../orchestration/Services/ProjectionOperationalQuery.ts";
import {
  AgentRuntime,
  AgentRuntimeError,
  type AgentRuntimeShape,
} from "../Services/AgentRuntime.ts";
import { WorkerRuntime } from "../../workerRuntime/Services/WorkerRuntime.ts";

type RoleRuntimeFileKey =
  | "selectedProfile"
  | "installedRoleSkills"
  | "generatedWorkspaceSummary"
  | "workspaceComposition";

const ROLE_RUNTIME_FILES = [
  {
    fileName: "selected-profile.json",
    key: "selectedProfile",
    label: "profile",
  },
  {
    fileName: "installed-role-skills.json",
    key: "installedRoleSkills",
    label: "skills",
  },
  {
    fileName: "generated-workspace-summary.json",
    key: "generatedWorkspaceSummary",
    label: "summary",
  },
  {
    fileName: "workspace-composition.json",
    key: "workspaceComposition",
    label: "packs",
  },
] as const satisfies ReadonlyArray<{
  fileName: string;
  key: RoleRuntimeFileKey;
  label: string;
}>;

const RoleRuntimeSelectedProfileSchema = Schema.Struct({
  selected_profile: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  selection_reason: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});

const RoleRuntimeInstalledRoleSkillsSchema = Schema.Struct({
  installed_role_skills: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  role: Schema.optional(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefault(() => null)),
});

const RoleRuntimeGeneratedWorkspaceSummarySchema = Schema.Struct({
  generated_at: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  role: Schema.optional(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefault(() => null)),
});

const RoleRuntimeWorkspaceCompositionSchema = Schema.Struct({
  document_kind: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  generated_at: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  profile: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  selected_pack_ids: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});

const decodeAgentSnapshot = Schema.decodeUnknownEffect(GetAgentRuntimeSnapshotResultSchema);
const decodeSelectedProfile = Schema.decodeUnknownEffect(RoleRuntimeSelectedProfileSchema);
const decodeInstalledRoleSkills = Schema.decodeUnknownEffect(RoleRuntimeInstalledRoleSkillsSchema);
const decodeGeneratedWorkspaceSummary = Schema.decodeUnknownEffect(
  RoleRuntimeGeneratedWorkspaceSummarySchema,
);
const decodeWorkspaceComposition = Schema.decodeUnknownEffect(
  RoleRuntimeWorkspaceCompositionSchema,
);

function decodeSnapshotResult(snapshot: GetAgentRuntimeSnapshotResult) {
  return decodeAgentSnapshot(snapshot).pipe(
    Effect.mapError(
      () =>
        new AgentRuntimeError({
          message: "Agent runtime snapshot normalization failed.",
        }),
    ),
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function fileState(input: {
  absolutePath: string;
  detail?: string | null;
  fileName: string;
  key: string;
  label: string;
  status: AgentRuntimeSourceFile["status"];
}): AgentRuntimeSourceFile {
  return {
    key: input.key,
    label: input.label,
    fileName: input.fileName,
    absolutePath: input.absolutePath,
    status: input.status,
    detail: input.detail ?? null,
  };
}

function missingRoleSourceFiles(input: {
  reason: string;
  runtimeDir: string | null;
}): AgentRuntimeSourceFile[] {
  return ROLE_RUNTIME_FILES.map((sourceFile) =>
    fileState({
      absolutePath: input.runtimeDir
        ? `${input.runtimeDir}/${sourceFile.fileName}`
        : `runtime-unavailable/${sourceFile.fileName}`,
      detail: input.reason,
      fileName: sourceFile.fileName,
      key: sourceFile.key,
      label: sourceFile.label,
      status: "missing",
    }),
  );
}

function buildUnavailableSnapshot(input: {
  agentKind: GetAgentRuntimeSnapshotInput["agentKind"];
  reason: string;
  runtimeDir: string | null;
  runtimeKind: GetAgentRuntimeSnapshotResult["runtimeKind"];
  threadId: GetAgentRuntimeSnapshotInput["threadId"];
  workspaceRoot: string | null;
  workspaceResolution: GetAgentRuntimeSnapshotResult["workspaceResolution"];
}): GetAgentRuntimeSnapshotResult {
  return {
    threadId: input.threadId,
    agentKind: input.agentKind,
    runtimeKind: input.runtimeKind,
    workspaceRoot: input.workspaceRoot,
    runtimeDir: input.runtimeDir,
    workspaceResolution: input.workspaceResolution,
    sourceFiles:
      input.runtimeKind === "worker-contract"
        ? [
            fileState({
              absolutePath: input.runtimeDir
                ? `${input.runtimeDir}/context-plan.json`
                : "runtime-unavailable/context-plan.json",
              detail: input.reason,
              fileName: "context-plan.json",
              key: "contextPlan",
              label: "context-plan",
              status: "missing",
            }),
            fileState({
              absolutePath: input.runtimeDir
                ? `${input.runtimeDir}/dispatch-contract.json`
                : "runtime-unavailable/dispatch-contract.json",
              detail: input.reason,
              fileName: "dispatch-contract.json",
              key: "dispatchContract",
              label: "dispatch",
              status: "missing",
            }),
            fileState({
              absolutePath: input.runtimeDir
                ? `${input.runtimeDir}/installed-packs.json`
                : "runtime-unavailable/installed-packs.json",
              detail: input.reason,
              fileName: "installed-packs.json",
              key: "installedPacks",
              label: "packs",
              status: "missing",
            }),
            fileState({
              absolutePath: input.runtimeDir
                ? `${input.runtimeDir}/instruction-stack-audit.json`
                : "runtime-unavailable/instruction-stack-audit.json",
              detail: input.reason,
              fileName: "instruction-stack-audit.json",
              key: "instructionStackAudit",
              label: "audit",
              status: "missing",
            }),
          ]
        : missingRoleSourceFiles({
            reason: input.reason,
            runtimeDir: input.runtimeDir,
          }),
    summary: {
      repo: null,
      role: null,
      profile: null,
      taskClass: null,
      contextMode: null,
      closeoutAuthority: null,
      generatedAt: null,
      selectedPacks: [],
      installedSkills: [],
      packCount: 0,
      skillCount: 0,
    },
    workerDetails: null,
    roleDetails: null,
  };
}

function mapWorkerSnapshot(input: {
  snapshot: GetWorkerRuntimeSnapshotResult;
  workspaceResolution: GetAgentRuntimeSnapshotResult["workspaceResolution"];
}): GetAgentRuntimeSnapshotResult {
  const snapshot = input.snapshot;
  return {
    threadId: snapshot.threadId,
    agentKind: "worker",
    runtimeKind: "worker-contract",
    workspaceRoot: snapshot.worktreePath,
    runtimeDir: snapshot.runtimeDir,
    workspaceResolution: input.workspaceResolution,
    sourceFiles: [
      fileState({
        absolutePath: snapshot.sourceFiles.contextPlan.absolutePath,
        detail: snapshot.sourceFiles.contextPlan.detail,
        fileName: snapshot.sourceFiles.contextPlan.fileName,
        key: "contextPlan",
        label: "context-plan",
        status: snapshot.sourceFiles.contextPlan.status,
      }),
      fileState({
        absolutePath: snapshot.sourceFiles.dispatchContract.absolutePath,
        detail: snapshot.sourceFiles.dispatchContract.detail,
        fileName: snapshot.sourceFiles.dispatchContract.fileName,
        key: "dispatchContract",
        label: "dispatch",
        status: snapshot.sourceFiles.dispatchContract.status,
      }),
      fileState({
        absolutePath: snapshot.sourceFiles.installedPacks.absolutePath,
        detail: snapshot.sourceFiles.installedPacks.detail,
        fileName: snapshot.sourceFiles.installedPacks.fileName,
        key: "installedPacks",
        label: "packs",
        status: snapshot.sourceFiles.installedPacks.status,
      }),
      fileState({
        absolutePath: snapshot.sourceFiles.instructionStackAudit.absolutePath,
        detail: snapshot.sourceFiles.instructionStackAudit.detail,
        fileName: snapshot.sourceFiles.instructionStackAudit.fileName,
        key: "instructionStackAudit",
        label: "audit",
        status: snapshot.sourceFiles.instructionStackAudit.status,
      }),
    ],
    summary: {
      repo: snapshot.summary.repo,
      role: "worker",
      profile: null,
      taskClass: snapshot.summary.taskClass,
      contextMode: snapshot.summary.contextMode,
      closeoutAuthority: snapshot.summary.closeoutAuthority,
      generatedAt: null,
      selectedPacks: snapshot.summary.selectedPacks,
      installedSkills: [],
      packCount: snapshot.summary.packCount,
      skillCount: 0,
    },
    workerDetails: {
      validationProfile: snapshot.summary.validationProfile,
      allowedCapabilities: snapshot.summary.allowedCapabilities,
      forbiddenCapabilities: snapshot.summary.forbiddenCapabilities,
      conflicts: snapshot.summary.conflicts,
      warnings: snapshot.summary.warnings,
      auditStatus: snapshot.summary.auditStatus,
      auditFindings: snapshot.summary.auditFindings,
      packAuditStatus: snapshot.summary.packAuditStatus,
      packAuditIssueCount: snapshot.summary.packAuditIssueCount,
      packs: snapshot.packs,
    },
    roleDetails: null,
  };
}

function basename(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

function toSortableMtime(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return 0;
}

function parseJsonFile<T>({
  absolutePath,
  decode,
  fileName,
  fileSystem,
  key,
  label,
}: {
  absolutePath: string;
  decode: (value: unknown) => Effect.Effect<T, Schema.SchemaError, never>;
  fileName: string;
  fileSystem: FileSystem.FileSystem;
  key: string;
  label: string;
}): Effect.Effect<{ data: T | null; sourceFile: AgentRuntimeSourceFile }, AgentRuntimeError> {
  return Effect.gen(function* () {
    const exists = yield* fileSystem.exists(absolutePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return {
        data: null,
        sourceFile: fileState({
          absolutePath,
          fileName,
          key,
          label,
          status: "missing",
        }),
      };
    }

    const raw = yield* fileSystem
      .readFileString(absolutePath)
      .pipe(Effect.mapError((cause) => new AgentRuntimeError({ message: cause.message })));

    const parsed = yield* Effect.exit(
      Effect.try({
        try: () => JSON.parse(raw),
        catch: (error) =>
          new AgentRuntimeError({
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
          key,
          label,
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
          key,
          label,
          status: "schema-error",
        }),
      };
    }

    return {
      data: decoded.value,
      sourceFile: fileState({
        absolutePath,
        fileName,
        key,
        label,
        status: "loaded",
      }),
    };
  });
}

function latestSessionRecordDirectory(input: {
  path: Path.Path;
  repoRoot: string;
  role: "cto" | "jasper";
}) {
  return input.path.join(
    input.repoRoot,
    ".agents",
    "runtime",
    "role-state",
    input.role,
    "sessions",
  );
}

function runtimeDirForWorkspaceRoot(path: Path.Path, workspaceRoot: string) {
  return path.join(workspaceRoot, ".agents", "runtime");
}

function roleSessionLooksLikeWorkspace(
  pathValue: string | null | undefined,
  role: "jasper" | "cto",
) {
  if (!pathValue) {
    return false;
  }
  const normalized = pathValue.replaceAll("\\", "/");
  return (
    normalized.includes(`/.agents/runtime/role-sessions/${role}/`) &&
    normalized.endsWith("/workspace")
  );
}

function resolveRoleWorkspaceRoot(input: {
  agentKind: Exclude<GetAgentRuntimeSnapshotInput["agentKind"], "worker">;
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
  threadWorktreePath: string | null;
}): Effect.Effect<
  {
    workspaceResolution: GetAgentRuntimeSnapshotResult["workspaceResolution"];
    workspaceRoot: string;
  },
  AgentRuntimeError
> {
  return Effect.gen(function* () {
    const repoRoot = AGENTS_VXAPP_ROOT;
    if (input.agentKind === "executive") {
      const canonicalRoot = input.path.join(repoRoot, "CTOv2");
      const fallbackRoot =
        (yield* findLatestRoleSessionWorkspaceRoot({
          fileSystem: input.fileSystem,
          path: input.path,
          repoRoot,
          role: "cto",
        })) ?? canonicalRoot;
      const canonicalRuntimeDir = runtimeDirForWorkspaceRoot(input.path, canonicalRoot);
      const canonicalExists = yield* input.fileSystem
        .exists(canonicalRuntimeDir)
        .pipe(Effect.orElseSucceed(() => false));
      if (canonicalExists) {
        return {
          workspaceResolution: {
            kind: "canonical-role-root",
            detail: "Using the canonical executive workspace root.",
          },
          workspaceRoot: canonicalRoot,
        };
      }
      if (fallbackRoot !== canonicalRoot) {
        return {
          workspaceResolution: {
            kind: "latest-role-session",
            detail: "Using the most recent generated CTO role-session workspace.",
          },
          workspaceRoot: fallbackRoot,
        };
      }
      return {
        workspaceResolution: {
          kind: "canonical-role-root",
          detail: "Falling back to the canonical executive workspace root.",
        },
        workspaceRoot: canonicalRoot,
      };
    }

    const latestGeneratedRoot = yield* findLatestRoleSessionWorkspaceRoot({
      fileSystem: input.fileSystem,
      path: input.path,
      repoRoot,
      role: "jasper",
    });
    if (latestGeneratedRoot) {
      return {
        workspaceResolution: {
          kind: "latest-role-session",
          detail: "Using the most recent generated Jasper role-session workspace.",
        },
        workspaceRoot: latestGeneratedRoot,
      };
    }
    if (roleSessionLooksLikeWorkspace(input.threadWorktreePath, "jasper")) {
      return {
        workspaceResolution: {
          kind: "role-session-thread-worktree",
          detail: "Using the Jasper role-session workspace referenced by the thread worktree.",
        },
        workspaceRoot: input.threadWorktreePath as string,
      };
    }
    return {
      workspaceResolution: {
        kind: "repo-role-root",
        detail: "Using the repo-owned Jasper workspace root.",
      },
      workspaceRoot: input.path.join(repoRoot, "Jasper"),
    };
  });
}

function resolveWorkerWorkspaceResolution(input: {
  inputWorktreePath: string | null;
  projectWorkspaceRoot: string | null;
  threadWorktreePath: string | null;
}): GetAgentRuntimeSnapshotResult["workspaceResolution"] {
  if (input.threadWorktreePath) {
    return {
      kind: "thread-worktree",
      detail: "Using the thread's authoritative worktree path.",
    };
  }
  if (input.projectWorkspaceRoot) {
    return {
      kind: "project-workspace-root",
      detail: "Falling back to the worker project's workspace root.",
    };
  }
  if (input.inputWorktreePath) {
    return {
      kind: "input-worktree-fallback",
      detail: "Using the caller-supplied worktree fallback path.",
    };
  }
  return {
    kind: "input-worktree-fallback",
    detail: "Worker runtime workspace is unavailable.",
  };
}

function findLatestRoleSessionWorkspaceRoot(input: {
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
  repoRoot: string;
  role: "cto" | "jasper";
}): Effect.Effect<string | null, AgentRuntimeError> {
  return Effect.gen(function* () {
    const sessionsDir = latestSessionRecordDirectory({
      path: input.path,
      repoRoot: input.repoRoot,
      role: input.role,
    });
    const exists = yield* input.fileSystem
      .exists(sessionsDir)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return null;
    }

    const entries = yield* input.fileSystem
      .readDirectory(sessionsDir, { recursive: false })
      .pipe(Effect.mapError((cause) => new AgentRuntimeError({ message: cause.message })));
    const recordPaths = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => input.path.join(sessionsDir, entry));
    const recordsWithMtime = yield* Effect.forEach(recordPaths, (recordPath) =>
      input.fileSystem.stat(recordPath).pipe(
        Effect.map((stat) => ({
          mtime: toSortableMtime(stat.mtime),
          recordPath,
        })),
        Effect.mapError((cause) => new AgentRuntimeError({ message: cause.message })),
      ),
    );

    const sortedRecordPaths = recordsWithMtime
      .toSorted((left, right) => {
        if (right.mtime !== left.mtime) {
          return right.mtime - left.mtime;
        }
        return right.recordPath.localeCompare(left.recordPath);
      })
      .map((entry) => entry.recordPath);

    for (const recordPath of sortedRecordPaths) {
      const raw = yield* input.fileSystem
        .readFileString(recordPath)
        .pipe(Effect.mapError((cause) => new AgentRuntimeError({ message: cause.message })));
      const parsed = yield* Effect.sync(() => {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return null;
        }
      });
      const workspacePath = asString(parsed?.workspace_path);
      if (workspacePath) {
        return workspacePath;
      }
    }
    return null;
  });
}

export const makeAgentRuntime = Effect.gen(function* () {
  const projectionOperationalQuery = yield* ProjectionOperationalQuery;
  const workerRuntime = yield* WorkerRuntime;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const getSnapshot: AgentRuntimeShape["getSnapshot"] = Effect.fn("AgentRuntime.getSnapshot")(
    function* (input) {
      const thread = yield* projectionOperationalQuery.getThreadById({ threadId: input.threadId });
      if (thread === null) {
        return yield* decodeSnapshotResult(
          buildUnavailableSnapshot({
            agentKind: input.agentKind,
            reason: `Thread '${input.threadId}' was not found in the current T3 projection.`,
            runtimeDir: null,
            runtimeKind: input.agentKind === "worker" ? "worker-contract" : "role-runtime",
            threadId: input.threadId,
            workspaceRoot: null,
            workspaceResolution: {
              kind: "input-worktree-fallback",
              detail: "No projection thread exists for this runtime request.",
            },
          }),
        );
      }

      if (input.agentKind === "worker") {
        const workerProject = yield* projectionOperationalQuery.getProjectById({
          projectId: thread.projectId,
        });
        const workspaceResolution = resolveWorkerWorkspaceResolution({
          inputWorktreePath: null,
          projectWorkspaceRoot: workerProject?.workspaceRoot ?? null,
          threadWorktreePath: thread.worktreePath ?? null,
        });
        const workerSnapshot = yield* workerRuntime
          .getSnapshot({ threadId: input.threadId })
          .pipe(Effect.mapError((cause) => new AgentRuntimeError({ message: cause.message })));
        return yield* decodeSnapshotResult(
          mapWorkerSnapshot({
            snapshot: workerSnapshot,
            workspaceResolution,
          }),
        );
      }

      const roleWorkspace = yield* resolveRoleWorkspaceRoot({
        agentKind: input.agentKind,
        fileSystem,
        path,
        threadWorktreePath: thread.worktreePath ?? null,
      });
      const workspaceRoot = roleWorkspace.workspaceRoot;
      const runtimeDir = runtimeDirForWorkspaceRoot(path, workspaceRoot);

      const selectedProfilePath = path.join(runtimeDir, "selected-profile.json");
      const installedRoleSkillsPath = path.join(runtimeDir, "installed-role-skills.json");
      const generatedWorkspaceSummaryPath = path.join(
        runtimeDir,
        "generated-workspace-summary.json",
      );
      const workspaceCompositionPath = path.join(runtimeDir, "workspace-composition.json");

      const [
        selectedProfileResult,
        installedRoleSkillsResult,
        generatedWorkspaceSummaryResult,
        workspaceCompositionResult,
      ] = yield* Effect.all([
        parseJsonFile({
          absolutePath: selectedProfilePath,
          decode: decodeSelectedProfile,
          fileName: "selected-profile.json",
          fileSystem,
          key: "selectedProfile",
          label: "profile",
        }),
        parseJsonFile({
          absolutePath: installedRoleSkillsPath,
          decode: decodeInstalledRoleSkills,
          fileName: "installed-role-skills.json",
          fileSystem,
          key: "installedRoleSkills",
          label: "skills",
        }),
        parseJsonFile({
          absolutePath: generatedWorkspaceSummaryPath,
          decode: decodeGeneratedWorkspaceSummary,
          fileName: "generated-workspace-summary.json",
          fileSystem,
          key: "generatedWorkspaceSummary",
          label: "summary",
        }),
        parseJsonFile({
          absolutePath: workspaceCompositionPath,
          decode: decodeWorkspaceComposition,
          fileName: "workspace-composition.json",
          fileSystem,
          key: "workspaceComposition",
          label: "packs",
        }),
      ]);

      const selectedProfile = selectedProfileResult.data;
      const installedRoleSkills = installedRoleSkillsResult.data;
      const generatedWorkspaceSummary = generatedWorkspaceSummaryResult.data;
      const workspaceComposition = workspaceCompositionResult.data;
      const selectedPacks = workspaceComposition?.selected_pack_ids ?? [];
      const installedSkills = installedRoleSkills?.installed_role_skills ?? [];

      return yield* decodeSnapshotResult({
        threadId: thread.id,
        agentKind: input.agentKind,
        runtimeKind: "role-runtime",
        workspaceRoot,
        runtimeDir,
        workspaceResolution: roleWorkspace.workspaceResolution,
        sourceFiles: [
          selectedProfileResult.sourceFile,
          installedRoleSkillsResult.sourceFile,
          generatedWorkspaceSummaryResult.sourceFile,
          workspaceCompositionResult.sourceFile,
        ],
        summary: {
          repo: basename(AGENTS_VXAPP_ROOT),
          role:
            asString(generatedWorkspaceSummary?.role) ??
            asString(installedRoleSkills?.role) ??
            (input.agentKind === "executive" ? "cto" : "jasper"),
          profile:
            asString(selectedProfile?.selected_profile) ??
            asString(workspaceComposition?.profile) ??
            null,
          taskClass: null,
          contextMode: null,
          closeoutAuthority: null,
          generatedAt:
            asString(generatedWorkspaceSummary?.generated_at) ??
            asString(workspaceComposition?.generated_at) ??
            null,
          selectedPacks,
          installedSkills,
          packCount: selectedPacks.length,
          skillCount: installedSkills.length,
        },
        workerDetails: null,
        roleDetails: {
          selectionReason: asString(selectedProfile?.selection_reason),
        },
      });
    },
  );

  return { getSnapshot } satisfies AgentRuntimeShape;
});

export const AgentRuntimeLive = Layer.effect(AgentRuntime, makeAgentRuntime);
