import {
  IsoDateTime,
  NonNegativeInt,
  type ServerListVortexAppArtifactsResult,
  type ServerListVortexAppsResult,
  TrimmedNonEmptyString,
  VortexAppsList,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ServerConfig } from "../../../config";
import { runProcess } from "../../../processRunner";
import { VortexApps, VortexAppsError, type VortexAppsShape } from "../Services/VortexApps";

const VORTEX_APPS_CACHE_KEY = "vortex.apps.list";
const T3CODE_REPO_ROOT_SENTINELS = ["bun.lock", "apps/server/package.json"] as const;

export interface VortexAppsOperationsConfig {
  readonly commandTimeoutMs: number;
  readonly maxBufferBytes: number;
  readonly cacheTtlMs: number;
  readonly defaultPageLimit: number;
}

function isT3CodeRepoRoot(candidate: string): boolean {
  return T3CODE_REPO_ROOT_SENTINELS.every((relativePath) =>
    fs.existsSync(path.join(candidate, relativePath)),
  );
}

function resolveT3CodeRepoRoot(fromDir: string): string {
  let candidate = path.resolve(fromDir);
  while (true) {
    if (isT3CodeRepoRoot(candidate)) {
      return candidate;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`Unable to resolve t3code-vxapp repo root from ${fromDir}.`);
    }
    candidate = parent;
  }
}

function readYamlNumber(raw: string, section: string, key: string): number {
  const lines = raw.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === `${section}:`) {
      inSection = true;
      continue;
    }
    if (inSection && line.length > 0 && !line.startsWith(" ")) {
      break;
    }
    const match = inSection ? line.match(new RegExp(`^\\s{2}${key}:\\s*(\\d+)\\s*$`)) : null;
    const value = Number(match?.[1]);
    if (Number.isSafeInteger(value) && value > 0) {
      return value;
    }
  }
  const value = Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Invalid .vx/runtime/operations.yaml ${section}.${key}; expected positive integer.`,
    );
  }
  return value;
}

export function loadVortexAppsOperationsConfigForTests(
  repoRoot = resolveT3CodeRepoRoot(path.dirname(fileURLToPath(import.meta.url))),
): VortexAppsOperationsConfig {
  const configPath = path.join(repoRoot, ".vx/runtime/operations.yaml");
  const raw = fs.readFileSync(configPath, "utf8");
  if (!/^documentKind:\s+vx_runtime_operations\s*$/m.test(raw)) {
    throw new Error(`Invalid runtime operations config documentKind at ${configPath}.`);
  }
  return {
    commandTimeoutMs: readYamlNumber(raw, "vortexApps", "commandTimeoutMs"),
    maxBufferBytes: readYamlNumber(raw, "vortexApps", "maxBufferBytes"),
    cacheTtlMs: readYamlNumber(raw, "vortexApps", "cacheTtlMs"),
    defaultPageLimit: readYamlNumber(raw, "web", "defaultPageLimit"),
  };
}

const VORTEX_APPS_OPERATIONS = loadVortexAppsOperationsConfigForTests();

const RuntimeTtlCacheKeySchema = Schema.Struct({
  key: Schema.String,
});

const RuntimeTtlCacheRowSchema = Schema.Struct({
  valueJson: Schema.String,
  refreshedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
type RuntimeTtlCacheRow = typeof RuntimeTtlCacheRowSchema.Type;

const RuntimeTtlCacheUpsertSchema = Schema.Struct({
  key: Schema.String,
  valueJson: Schema.String,
  refreshedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

const decodeAppsListJson = Schema.decodeEffect(Schema.fromJsonString(VortexAppsList));

const VortexArtifactListCommandOutput = Schema.Struct({
  data: Schema.Struct({
    backend: Schema.Struct({
      pagination: Schema.Struct({
        total_results: NonNegativeInt,
        total_pages: NonNegativeInt,
        has_next_page: Schema.Boolean,
      }),
      results: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  }),
});

const decodeArtifactListJson = Schema.decodeEffect(
  Schema.fromJsonString(VortexArtifactListCommandOutput),
);

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtFromNow(): string {
  return new Date(Date.now() + VORTEX_APPS_OPERATIONS.cacheTtlMs).toISOString();
}

function isFresh(expiresAt: string): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

function toVortexAppsError(operation: string, detail: string): (cause: unknown) => VortexAppsError {
  return (cause) => new VortexAppsError({ operation, detail, cause });
}

const makeVortexApps = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const serverConfig = yield* ServerConfig;

  const readCacheRow = SqlSchema.findOneOption({
    Request: RuntimeTtlCacheKeySchema,
    Result: RuntimeTtlCacheRowSchema,
    execute: ({ key }) =>
      sql`
        SELECT
          value_json AS "valueJson",
          refreshed_at AS "refreshedAt",
          expires_at AS "expiresAt"
        FROM runtime_ttl_cache
        WHERE cache_key = ${key}
      `,
  });

  const upsertCacheRow = SqlSchema.void({
    Request: RuntimeTtlCacheUpsertSchema,
    execute: ({ key, valueJson, refreshedAt, expiresAt, updatedAt }) =>
      sql`
        INSERT INTO runtime_ttl_cache (
          cache_key,
          value_json,
          refreshed_at,
          expires_at,
          updated_at
        )
        VALUES (
          ${key},
          ${valueJson},
          ${refreshedAt},
          ${expiresAt},
          ${updatedAt}
        )
        ON CONFLICT (cache_key)
        DO UPDATE SET
          value_json = excluded.value_json,
          refreshed_at = excluded.refreshed_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
  });

  const decodeCachedCatalog = (row: RuntimeTtlCacheRow) =>
    decodeAppsListJson(row.valueJson).pipe(
      Effect.mapError(
        toVortexAppsError("listApps.decodeCache", "Cached Vortex app list is invalid."),
      ),
    );

  const fetchCatalog = Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () =>
        runProcess("vx", ["apps", "--list", "--json"], {
          cwd: serverConfig.cwd,
          timeoutMs: VORTEX_APPS_OPERATIONS.commandTimeoutMs,
          maxBufferBytes: VORTEX_APPS_OPERATIONS.maxBufferBytes,
        }),
      catch: toVortexAppsError("listApps.runCommand", "Failed to run vx apps --list --json."),
    });

    return yield* decodeAppsListJson(result.stdout).pipe(
      Effect.mapError(
        toVortexAppsError("listApps.decodeCommand", "vx apps --list --json returned invalid JSON."),
      ),
    );
  });

  const persistCatalog = (catalog: typeof VortexAppsList.Type) =>
    Effect.gen(function* () {
      const refreshedAt = nowIso();
      const expiresAt = expiresAtFromNow();
      yield* upsertCacheRow({
        key: VORTEX_APPS_CACHE_KEY,
        valueJson: JSON.stringify(catalog),
        refreshedAt,
        expiresAt,
        updatedAt: refreshedAt,
      }).pipe(Effect.mapError(toVortexAppsError("listApps.writeCache", "Failed to write cache.")));

      return {
        catalog,
        cache: {
          key: VORTEX_APPS_CACHE_KEY,
          refreshed_at: refreshedAt,
          expires_at: expiresAt,
          hit: false,
        },
      } satisfies ServerListVortexAppsResult;
    });

  const refreshCatalog = fetchCatalog.pipe(Effect.flatMap(persistCatalog));

  const fetchArtifactPage = (input: { targetId: string; page: number; includeArchived: boolean }) =>
    Effect.gen(function* () {
      const args = [
        "apps",
        input.targetId,
        "--artifact",
        "list",
        "--json",
        "--limit",
        String(VORTEX_APPS_OPERATIONS.defaultPageLimit),
        "--page",
        String(input.page),
      ];
      if (input.includeArchived) {
        args.push("--include-archived");
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          runProcess("vx", args, {
            cwd: serverConfig.cwd,
            timeoutMs: VORTEX_APPS_OPERATIONS.commandTimeoutMs,
            maxBufferBytes: VORTEX_APPS_OPERATIONS.maxBufferBytes,
          }),
        catch: toVortexAppsError(
          "listAppArtifacts.runCommand",
          `Failed to list artifacts for ${input.targetId}.`,
        ),
      });

      return yield* decodeArtifactListJson(result.stdout).pipe(
        Effect.mapError(
          toVortexAppsError(
            "listAppArtifacts.decodeCommand",
            `Artifact list output for ${input.targetId} is invalid.`,
          ),
        ),
      );
    });

  const listApps: VortexAppsShape["listApps"] = Effect.gen(function* () {
    const cacheRow = yield* readCacheRow({ key: VORTEX_APPS_CACHE_KEY }).pipe(
      Effect.mapError(toVortexAppsError("listApps.readCache", "Failed to read cache.")),
    );

    if (Option.isSome(cacheRow) && isFresh(cacheRow.value.expiresAt)) {
      const cached = yield* decodeCachedCatalog(cacheRow.value).pipe(
        Effect.matchEffect({
          onFailure: () => refreshCatalog,
          onSuccess: (catalog) =>
            Effect.succeed({
              catalog,
              cache: {
                key: VORTEX_APPS_CACHE_KEY,
                refreshed_at: cacheRow.value.refreshedAt,
                expires_at: cacheRow.value.expiresAt,
                hit: true,
              },
            } satisfies ServerListVortexAppsResult),
        }),
      );
      return cached;
    }

    return yield* refreshCatalog;
  });

  const listAppArtifacts: VortexAppsShape["listAppArtifacts"] = (input) =>
    Effect.gen(function* () {
      const targetId = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)(
        input.target_id,
      ).pipe(
        Effect.mapError(
          toVortexAppsError("listAppArtifacts.validateInput", "Artifact target id is invalid."),
        ),
      );
      const includeArchived = input.includeArchived === true;
      const firstPage = yield* fetchArtifactPage({ targetId, page: 1, includeArchived });
      const totalPages = firstPage.data.backend.pagination.total_pages;
      const remainingPages = Array.from(
        { length: Math.max(totalPages - 1, 0) },
        (_, index) => index + 2,
      );
      const remainingResults = yield* Effect.forEach(
        remainingPages,
        (page) => fetchArtifactPage({ targetId, page, includeArchived }),
        { concurrency: 2 },
      );
      const allPages = [firstPage, ...remainingResults];
      const artifacts = allPages.flatMap((page) => page.data.backend.results);

      return {
        target_id: targetId,
        fetched_at: nowIso(),
        total_results: firstPage.data.backend.pagination.total_results,
        artifacts,
      } satisfies ServerListVortexAppArtifactsResult;
    });

  return {
    listApps,
    listAppArtifacts,
  } satisfies VortexAppsShape;
});

export const VortexAppsLive = Layer.effect(VortexApps, makeVortexApps);
