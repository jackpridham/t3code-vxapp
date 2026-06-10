import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { NonNegativeInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  OllamaModelOptions,
} from "./model";
import { ModelSelection } from "./orchestration";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";
export const DEFAULT_MAX_PROJECT_THREADS_BEFORE_FOLDING = 6;

export const ChangesPanelFilesChangedViewType = Schema.Literals(["list", "tree"]);
export type ChangesPanelFilesChangedViewType = typeof ChangesPanelFilesChangedViewType.Type;
export const DEFAULT_CHANGES_PANEL_FILES_CHANGED_VIEW_TYPE: ChangesPanelFilesChangedViewType =
  "list";
export const ChangesPanelWindowNavigationMode = Schema.Literals(["dynamic", "static"]);
export type ChangesPanelWindowNavigationMode = typeof ChangesPanelWindowNavigationMode.Type;
export const DEFAULT_CHANGES_PANEL_WINDOW_NAVIGATION_MODE: ChangesPanelWindowNavigationMode =
  "dynamic";
export const ChangesDrawerVisibility = Schema.Literals(["always_show", "always_hide"]);
export type ChangesDrawerVisibility = typeof ChangesDrawerVisibility.Type;
export const DEFAULT_CHANGES_DRAWER_VISIBILITY: ChangesDrawerVisibility = "always_hide";
export const DEFAULT_REMEMBER_CHANGES_DRAWER_WIDTH = true;
export const ChatViewInputWhenScrolling = Schema.Literals(["hide", "show", "compact"]);
export type ChatViewInputWhenScrolling = typeof ChatViewInputWhenScrolling.Type;
export const DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING: ChatViewInputWhenScrolling = "compact";
export const WorkerChatViewVisibility = Schema.Literals(["always_show", "always_hide"]);
export type WorkerChatViewVisibility = typeof WorkerChatViewVisibility.Type;
export const DEFAULT_WORKER_CHAT_VIEW_VISIBILITY: WorkerChatViewVisibility = "always_hide";
export const WorkerOrchestrationNoticesVisibility = Schema.Literals(["always_show", "always_hide"]);
export type WorkerOrchestrationNoticesVisibility = typeof WorkerOrchestrationNoticesVisibility.Type;
export const DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY: WorkerOrchestrationNoticesVisibility =
  "always_hide";
export const SidebarWorkerVisibilityScope = Schema.Literals([
  "current_orchestrator",
  "all_orchestrators",
]);
export type SidebarWorkerVisibilityScope = typeof SidebarWorkerVisibilityScope.Type;
export const DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE: SidebarWorkerVisibilityScope =
  "current_orchestrator";
export const SidebarWorkerLineageFilter = Schema.Literals([
  "hide_invalid",
  "show_invalid",
  "only_invalid",
]);
export type SidebarWorkerLineageFilter = typeof SidebarWorkerLineageFilter.Type;
export const DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER: SidebarWorkerLineageFilter = "hide_invalid";
export const SidebarWorkerActivityFilter = Schema.Literals(["all", "active", "needs_attention"]);
export type SidebarWorkerActivityFilter = typeof SidebarWorkerActivityFilter.Type;
export const DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER: SidebarWorkerActivityFilter = "all";
export const SidebarVariant = Schema.Literals(["project", "orchestration"]);
export type SidebarVariant = typeof SidebarVariant.Type;
export const DEFAULT_SIDEBAR_VARIANT: SidebarVariant = "project";
export const SidebarOrchestrationDataMode = Schema.Literals(["live", "demo"]);
export type SidebarOrchestrationDataMode = typeof SidebarOrchestrationDataMode.Type;
export const DEFAULT_SIDEBAR_ORCHESTRATION_DATA_MODE: SidebarOrchestrationDataMode = "live";

export const ClientSettingsSchema = Schema.Struct({
  allowActiveThreadsInFold: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  sidebarVariant: SidebarVariant.pipe(Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_VARIANT)),
  sidebarOrchestrationDataMode: SidebarOrchestrationDataMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_ORCHESTRATION_DATA_MODE),
  ),
  ideModeEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  sidebarGroupWorktreesWithParentProject: Schema.Boolean.pipe(
    Schema.withDecodingDefault(() => true),
  ),
  sidebarWorkerVisibilityScope: SidebarWorkerVisibilityScope.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE),
  ),
  sidebarWorkerLineageFilter: SidebarWorkerLineageFilter.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER),
  ),
  sidebarWorkerActivityFilter: SidebarWorkerActivityFilter.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER),
  ),
  chatViewInputWhenScrolling: ChatViewInputWhenScrolling.pipe(
    Schema.withDecodingDefault(() => DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING),
  ),
  workerChatViewVisibility: WorkerChatViewVisibility.pipe(
    Schema.withDecodingDefault(() => DEFAULT_WORKER_CHAT_VIEW_VISIBILITY),
  ),
  workerOrchestrationNoticesVisibility: WorkerOrchestrationNoticesVisibility.pipe(
    Schema.withDecodingDefault(() => DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY),
  ),
  changesPanelFilesChangedViewType: ChangesPanelFilesChangedViewType.pipe(
    Schema.withDecodingDefault(() => DEFAULT_CHANGES_PANEL_FILES_CHANGED_VIEW_TYPE),
  ),
  changesDrawerVisibility: ChangesDrawerVisibility.pipe(
    Schema.withDecodingDefault(() => DEFAULT_CHANGES_DRAWER_VISIBILITY),
  ),
  rememberChangesDrawerWidth: Schema.Boolean.pipe(
    Schema.withDecodingDefault(() => DEFAULT_REMEMBER_CHANGES_DRAWER_WIDTH),
  ),
  changesPanelWindowNavigationMode: ChangesPanelWindowNavigationMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_CHANGES_PANEL_WINDOW_NAVIGATION_MODE),
  ),
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  maxProjectThreadsBeforeFolding: NonNegativeInt.pipe(
    Schema.withDecodingDefault(() => DEFAULT_MAX_PROJECT_THREADS_BEFORE_FOLDING),
  ),
  showGitignoredFilesInMentions: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  timestampFormat: TimestampFormat.pipe(Schema.withDecodingDefault(() => DEFAULT_TIMESTAMP_FORMAT)),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;
export const StartupThreadTarget = Schema.Literals(["executive", "orchestrator"]);
export type StartupThreadTarget = typeof StartupThreadTarget.Type;
export const DEFAULT_STARTUP_THREAD_TARGET: StartupThreadTarget = "executive";
export const OllamaProtocol = Schema.Literals(["http", "https"]);
export type OllamaProtocol = typeof OllamaProtocol.Type;
export const DEFAULT_OLLAMA_PROTOCOL: OllamaProtocol = "http";
export const DEFAULT_OLLAMA_HOST = "192.168.10.12";
export const DEFAULT_OLLAMA_PORT = 11435;
export const DEFAULT_OLLAMA_API_PATH = "/api";
export const DEFAULT_OLLAMA_RESPONSES_API_PATH = "/v1";
export const DEFAULT_OLLAMA_MODEL = "qwen3:8b";
export const DEFAULT_CODEX_PROFILE_NAME = "t3-openai";
export const DEFAULT_OLLAMA_CODEX_HOME_PATH = "~/.codex-ollama";
export const DEFAULT_OLLAMA_CODEX_PROFILE_NAME = "t3-ollama-gpu";

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => fallback),
  );

const makeOllamaHostSetting = () =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || DEFAULT_OLLAMA_HOST),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_HOST),
  );

const makeOllamaApiPathSetting = () =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => {
          const normalized = value ? (value.startsWith("/") ? value : `/${value}`) : "";
          return Effect.succeed(normalized || DEFAULT_OLLAMA_API_PATH);
        },
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_API_PATH),
  );

const makeOllamaResponsesApiPathSetting = () =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => {
          const normalized = value ? (value.startsWith("/") ? value : `/${value}`) : "";
          return Effect.succeed(normalized || DEFAULT_OLLAMA_RESPONSES_API_PATH);
        },
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_RESPONSES_API_PATH),
  );

const makeOllamaModelSetting = () =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || DEFAULT_OLLAMA_MODEL),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_MODEL),
  );

const makeOllamaPortSetting = () =>
  Schema.Number.pipe(
    Schema.decodeTo(
      Schema.Int,
      SchemaTransformation.transformOrFail({
        decode: (value) => {
          if (!Number.isFinite(value)) {
            return Effect.succeed(DEFAULT_OLLAMA_PORT);
          }
          const normalized = Math.trunc(value);
          return Effect.succeed(Math.max(1, Math.min(65_535, normalized)));
        },
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_PORT),
  );

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  profileName: TrimmedString.pipe(Schema.withDecodingDefault(() => DEFAULT_CODEX_PROFILE_NAME)),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("claude"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const OllamaSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  protocol: OllamaProtocol.pipe(Schema.withDecodingDefault(() => DEFAULT_OLLAMA_PROTOCOL)),
  host: makeOllamaHostSetting(),
  port: makeOllamaPortSetting(),
  apiPath: makeOllamaApiPathSetting(),
  responsesApiPath: makeOllamaResponsesApiPathSetting(),
  codexBinaryPath: makeBinaryPathSetting("codex"),
  codexHomePath: TrimmedString.pipe(
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_CODEX_HOME_PATH),
  ),
  codexProfileName: TrimmedString.pipe(
    Schema.withDecodingDefault(() => DEFAULT_OLLAMA_CODEX_PROFILE_NAME),
  ),
  defaultModel: makeOllamaModelSetting(),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type OllamaSettings = typeof OllamaSettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  notifyActiveOrchestratorOnRejectedWorkerWake: Schema.Boolean.pipe(
    Schema.withDecodingDefault(() => false),
  ),
  startupThreadTarget: StartupThreadTarget.pipe(
    Schema.withDecodingDefault(() => DEFAULT_STARTUP_THREAD_TARGET),
  ),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(() => "local" as const satisfies ThreadEnvMode),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
    })),
  ),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    ollamaLocal: OllamaSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const CodexModelOptionsPatch = Schema.Struct({
  reasoningEffort: Schema.optionalKey(CodexModelOptions.fields.reasoningEffort),
  fastMode: Schema.optionalKey(CodexModelOptions.fields.fastMode),
});

const ClaudeModelOptionsPatch = Schema.Struct({
  thinking: Schema.optionalKey(ClaudeModelOptions.fields.thinking),
  effort: Schema.optionalKey(ClaudeModelOptions.fields.effort),
  fastMode: Schema.optionalKey(ClaudeModelOptions.fields.fastMode),
  contextWindow: Schema.optionalKey(ClaudeModelOptions.fields.contextWindow),
});

const OllamaModelOptionsPatch = Schema.Struct({
  ...OllamaModelOptions.fields,
});

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("codex")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(CodexModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ClaudeModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("ollamaLocal")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(OllamaModelOptionsPatch),
  }),
]);

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  homePath: Schema.optionalKey(Schema.String),
  profileName: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const OllamaSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  protocol: Schema.optionalKey(OllamaProtocol),
  host: Schema.optionalKey(Schema.String),
  port: Schema.optionalKey(Schema.Number),
  apiPath: Schema.optionalKey(Schema.String),
  responsesApiPath: Schema.optionalKey(Schema.String),
  codexBinaryPath: Schema.optionalKey(Schema.String),
  codexHomePath: Schema.optionalKey(Schema.String),
  codexProfileName: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  notifyActiveOrchestratorOnRejectedWorkerWake: Schema.optionalKey(Schema.Boolean),
  startupThreadTarget: Schema.optionalKey(StartupThreadTarget),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
      ollamaLocal: Schema.optionalKey(OllamaSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
