import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";
import { ServerSettings } from "./settings";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

const ServerProviders = Schema.Array(ServerProvider);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

export const VortexAppProject = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  display_name: TrimmedNonEmptyString,
  repo_url: TrimmedNonEmptyString,
  target_id: TrimmedNonEmptyString,
  installed: Schema.Boolean,
});
export type VortexAppProject = typeof VortexAppProject.Type;

export const VortexAppsList = Schema.Struct({
  scanned_at: IsoDateTime,
  work_dir: TrimmedNonEmptyString,
  repo_filter: Schema.NullOr(Schema.String),
  count: NonNegativeInt,
  projects: Schema.Array(VortexAppProject),
});
export type VortexAppsList = typeof VortexAppsList.Type;

export const ServerCacheEntryMeta = Schema.Struct({
  key: TrimmedNonEmptyString,
  refreshed_at: IsoDateTime,
  expires_at: IsoDateTime,
  hit: Schema.Boolean,
});
export type ServerCacheEntryMeta = typeof ServerCacheEntryMeta.Type;

export const ServerListVortexAppsResult = Schema.Struct({
  catalog: VortexAppsList,
  cache: ServerCacheEntryMeta,
});
export type ServerListVortexAppsResult = typeof ServerListVortexAppsResult.Type;

export const ServerListVortexAppArtifactsInput = Schema.Struct({
  target_id: TrimmedNonEmptyString,
  includeArchived: Schema.optional(Schema.Boolean),
});
export type ServerListVortexAppArtifactsInput = typeof ServerListVortexAppArtifactsInput.Type;

export const VortexAppArtifact = Schema.Record(Schema.String, Schema.Unknown);
export type VortexAppArtifact = typeof VortexAppArtifact.Type;

export const ServerListVortexAppArtifactsResult = Schema.Struct({
  target_id: TrimmedNonEmptyString,
  fetched_at: IsoDateTime,
  total_results: NonNegativeInt,
  artifacts: Schema.Array(VortexAppArtifact),
});
export type ServerListVortexAppArtifactsResult = typeof ServerListVortexAppArtifactsResult.Type;
