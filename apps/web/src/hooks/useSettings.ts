/**
 * Unified settings hook.
 *
 * Abstracts the split between server-authoritative settings (persisted in
 * `settings.json` on the server, fetched via `server.getConfig`) and
 * client-only settings (persisted in localStorage).
 *
 * Consumers use `useSettings(selector)` to read, and `useUpdateSettings()` to
 * write. The hook transparently routes reads/writes to the correct backing
 * store.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NonNegativeInt,
  ServerSettings,
  ServerSettingsPatch,
  ServerConfig,
  ModelSelection,
  ThreadEnvMode,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import {
  ChatViewInputWhenScrolling,
  ChangesDrawerVisibility,
  ChangesPanelFilesChangedViewType,
  ChangesPanelWindowNavigationMode,
  type ClientSettings,
  ClientSettingsSchema,
  DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING,
  DEFAULT_CHANGES_PANEL_FILES_CHANGED_VIEW_TYPE,
  DEFAULT_CHANGES_DRAWER_VISIBILITY,
  DEFAULT_CHANGES_PANEL_WINDOW_NAVIGATION_MODE,
  DEFAULT_REMEMBER_CHANGES_DRAWER_WIDTH,
  DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER,
  DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER,
  DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE,
  DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY,
  DEFAULT_WORKER_CHAT_VIEW_VISIBILITY,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  SidebarWorkerActivityFilter,
  SidebarWorkerLineageFilter,
  SidebarWorkerVisibilityScope,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TimestampFormat,
  UnifiedSettings,
  WorkerOrchestrationNoticesVisibility,
  WorkerChatViewVisibility,
} from "@t3tools/contracts/settings";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { useLocalStorage } from "./useLocalStorage";
import { normalizeCustomModelSlugs } from "~/modelSelection";
import { Predicate, Schema, Struct } from "effect";
import { DeepMutable } from "effect/Types";
import { deepMerge } from "@t3tools/shared/Struct";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
const OLD_SETTINGS_KEY = "t3code:app-settings:v1";

// ── Key sets for routing patches ─────────────────────────────────────

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: Partial<UnifiedSettings>): {
  serverPatch: ServerSettingsPatch;
  clientPatch: Partial<ClientSettings>;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as Partial<ClientSettings>,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Read merged settings. Selector narrows the subscription so components
 * only re-render when the slice they care about changes.
 */

export function useSettings<T extends UnifiedSettings = UnifiedSettings>(
  selector?: (s: UnifiedSettings) => T,
): T {
  const { data: serverConfig } = useQuery(serverConfigQueryOptions());
  const [clientSettings] = useLocalStorage(
    CLIENT_SETTINGS_STORAGE_KEY,
    DEFAULT_CLIENT_SETTINGS,
    ClientSettingsSchema,
  );

  const merged = useMemo<UnifiedSettings>(
    () => ({
      ...(serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS),
      ...clientSettings,
    }),
    [serverConfig?.settings, clientSettings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in the React Query cache, then
 * persisted via RPC. Client keys go straight to localStorage.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const [, setClientSettings] = useLocalStorage(
    CLIENT_SETTINGS_STORAGE_KEY,
    DEFAULT_CLIENT_SETTINGS,
    ClientSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<UnifiedSettings>) => {
      const { serverPatch, clientPatch } = splitPatch(patch);

      if (Object.keys(serverPatch).length > 0) {
        // Optimistic update of the React Query cache
        queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (old) => {
          if (!old) return old;
          return {
            ...old,
            settings: deepMerge(old.settings, serverPatch),
          };
        });
        // Fire-and-forget RPC — push will reconcile on success
        void ensureNativeApi().server.updateSettings(serverPatch);
      }

      if (Object.keys(clientPatch).length > 0) {
        setClientSettings((prev) => ({ ...prev, ...clientPatch }));
      }
    },
    [queryClient, setClientSettings],
  );

  const resetSettings = useCallback(() => {
    updateSettings(DEFAULT_UNIFIED_SETTINGS);
  }, [updateSettings]);

  return {
    updateSettings,
    resetSettings,
  };
}

// ── One-time migration from localStorage ─────────────────────────────

export function buildLegacyServerSettingsMigrationPatch(legacySettings: Record<string, unknown>) {
  const patch: DeepMutable<ServerSettingsPatch> = {};

  if (Predicate.isBoolean(legacySettings.enableAssistantStreaming)) {
    patch.enableAssistantStreaming = legacySettings.enableAssistantStreaming;
  }

  if (Schema.is(ThreadEnvMode)(legacySettings.defaultThreadEnvMode)) {
    patch.defaultThreadEnvMode = legacySettings.defaultThreadEnvMode;
  }

  if (Schema.is(ModelSelection)(legacySettings.textGenerationModelSelection)) {
    patch.textGenerationModelSelection = legacySettings.textGenerationModelSelection;
  }

  if (typeof legacySettings.codexBinaryPath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.binaryPath = legacySettings.codexBinaryPath;
  }

  if (typeof legacySettings.codexHomePath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.homePath = legacySettings.codexHomePath;
  }

  if (Array.isArray(legacySettings.customCodexModels)) {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.customModels = normalizeCustomModelSlugs(
      legacySettings.customCodexModels,
      new Set<string>(),
      "codex",
    );
  }

  if (Predicate.isString(legacySettings.claudeBinaryPath)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.binaryPath = legacySettings.claudeBinaryPath;
  }

  if (Array.isArray(legacySettings.customClaudeModels)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.customModels = normalizeCustomModelSlugs(
      legacySettings.customClaudeModels,
      new Set<string>(),
      "claudeAgent",
    );
  }

  return patch;
}

export function buildLegacyClientSettingsMigrationPatch(
  legacySettings: Record<string, unknown>,
): Partial<DeepMutable<ClientSettings>> {
  const patch: Partial<DeepMutable<ClientSettings>> = {};

  if (Predicate.isBoolean(legacySettings.allowActiveThreadsInFold)) {
    patch.allowActiveThreadsInFold = legacySettings.allowActiveThreadsInFold;
  }

  if (Predicate.isBoolean(legacySettings.sidebarOrchestrationModeEnabled)) {
    patch.sidebarOrchestrationModeEnabled = legacySettings.sidebarOrchestrationModeEnabled;
  }

  if (Predicate.isBoolean(legacySettings.ideModeEnabled)) {
    patch.ideModeEnabled = legacySettings.ideModeEnabled;
  } else if (legacySettings.ideModeEnabled === undefined) {
    patch.ideModeEnabled = DEFAULT_CLIENT_SETTINGS.ideModeEnabled;
  }

  if (Predicate.isBoolean(legacySettings.sidebarGroupWorktreesWithParentProject)) {
    patch.sidebarGroupWorktreesWithParentProject =
      legacySettings.sidebarGroupWorktreesWithParentProject;
  }

  if (Schema.is(SidebarWorkerVisibilityScope)(legacySettings.sidebarWorkerVisibilityScope)) {
    patch.sidebarWorkerVisibilityScope = legacySettings.sidebarWorkerVisibilityScope;
  } else if (legacySettings.sidebarWorkerVisibilityScope === undefined) {
    patch.sidebarWorkerVisibilityScope = DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE;
  }

  if (Schema.is(SidebarWorkerLineageFilter)(legacySettings.sidebarWorkerLineageFilter)) {
    patch.sidebarWorkerLineageFilter = legacySettings.sidebarWorkerLineageFilter;
  } else if (legacySettings.sidebarWorkerLineageFilter === undefined) {
    patch.sidebarWorkerLineageFilter = DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER;
  }

  if (Schema.is(SidebarWorkerActivityFilter)(legacySettings.sidebarWorkerActivityFilter)) {
    patch.sidebarWorkerActivityFilter = legacySettings.sidebarWorkerActivityFilter;
  } else if (legacySettings.sidebarWorkerActivityFilter === undefined) {
    patch.sidebarWorkerActivityFilter = DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER;
  }

  if (Schema.is(ChatViewInputWhenScrolling)(legacySettings.chatViewInputWhenScrolling)) {
    patch.chatViewInputWhenScrolling = legacySettings.chatViewInputWhenScrolling;
  } else if (legacySettings.chatViewInputWhenScrolling === undefined) {
    patch.chatViewInputWhenScrolling = DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING;
  }

  if (Schema.is(WorkerChatViewVisibility)(legacySettings.workerChatViewVisibility)) {
    patch.workerChatViewVisibility = legacySettings.workerChatViewVisibility;
  } else if (legacySettings.workerChatViewVisibility === undefined) {
    patch.workerChatViewVisibility = DEFAULT_WORKER_CHAT_VIEW_VISIBILITY;
  }

  if (
    Schema.is(WorkerOrchestrationNoticesVisibility)(
      legacySettings.workerOrchestrationNoticesVisibility,
    )
  ) {
    patch.workerOrchestrationNoticesVisibility =
      legacySettings.workerOrchestrationNoticesVisibility;
  } else if (legacySettings.workerOrchestrationNoticesVisibility === undefined) {
    patch.workerOrchestrationNoticesVisibility = DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY;
  }

  if (
    Schema.is(ChangesPanelFilesChangedViewType)(legacySettings.changesPanelFilesChangedViewType)
  ) {
    patch.changesPanelFilesChangedViewType = legacySettings.changesPanelFilesChangedViewType;
  } else if (legacySettings.changesPanelFilesChangedViewType === undefined) {
    patch.changesPanelFilesChangedViewType = DEFAULT_CHANGES_PANEL_FILES_CHANGED_VIEW_TYPE;
  }

  if (Schema.is(ChangesDrawerVisibility)(legacySettings.changesDrawerVisibility)) {
    patch.changesDrawerVisibility = legacySettings.changesDrawerVisibility;
  } else if (legacySettings.changesDrawerVisibility === undefined) {
    patch.changesDrawerVisibility = DEFAULT_CHANGES_DRAWER_VISIBILITY;
  }

  if (Predicate.isBoolean(legacySettings.rememberChangesDrawerWidth)) {
    patch.rememberChangesDrawerWidth = legacySettings.rememberChangesDrawerWidth;
  } else if (legacySettings.rememberChangesDrawerWidth === undefined) {
    patch.rememberChangesDrawerWidth = DEFAULT_REMEMBER_CHANGES_DRAWER_WIDTH;
  }

  if (
    Schema.is(ChangesPanelWindowNavigationMode)(legacySettings.changesPanelWindowNavigationMode)
  ) {
    patch.changesPanelWindowNavigationMode = legacySettings.changesPanelWindowNavigationMode;
  } else if (legacySettings.changesPanelWindowNavigationMode === undefined) {
    patch.changesPanelWindowNavigationMode = DEFAULT_CHANGES_PANEL_WINDOW_NAVIGATION_MODE;
  }

  if (Predicate.isBoolean(legacySettings.confirmThreadArchive)) {
    patch.confirmThreadArchive = legacySettings.confirmThreadArchive;
  }

  if (Predicate.isBoolean(legacySettings.confirmThreadDelete)) {
    patch.confirmThreadDelete = legacySettings.confirmThreadDelete;
  }

  if (Predicate.isBoolean(legacySettings.diffWordWrap)) {
    patch.diffWordWrap = legacySettings.diffWordWrap;
  }

  if (Schema.is(NonNegativeInt)(legacySettings.maxProjectThreadsBeforeFolding)) {
    patch.maxProjectThreadsBeforeFolding = legacySettings.maxProjectThreadsBeforeFolding;
  }

  if (Predicate.isBoolean(legacySettings.showGitignoredFilesInMentions)) {
    patch.showGitignoredFilesInMentions = legacySettings.showGitignoredFilesInMentions;
  }

  if (Schema.is(SidebarProjectSortOrder)(legacySettings.sidebarProjectSortOrder)) {
    patch.sidebarProjectSortOrder = legacySettings.sidebarProjectSortOrder;
  }

  if (Schema.is(SidebarThreadSortOrder)(legacySettings.sidebarThreadSortOrder)) {
    patch.sidebarThreadSortOrder = legacySettings.sidebarThreadSortOrder;
  }

  if (Schema.is(TimestampFormat)(legacySettings.timestampFormat)) {
    patch.timestampFormat = legacySettings.timestampFormat;
  }

  return patch;
}

/**
 * Call once on app startup.
 * If the legacy localStorage key exists, migrate its values to the new server
 * and client storage formats, then remove the legacy key so this only runs once.
 */
export function migrateLocalSettingsToServer(): void {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem(OLD_SETTINGS_KEY);
  if (!raw) return;

  try {
    const old = JSON.parse(raw);
    if (!Predicate.isObject(old)) return;

    // Migrate server-relevant keys via RPC
    const serverPatch = buildLegacyServerSettingsMigrationPatch(old);
    if (Object.keys(serverPatch).length > 0) {
      const api = ensureNativeApi();
      void api.server.updateSettings(serverPatch);
    }

    // Migrate client-only keys to the new localStorage key
    const clientPatch = buildLegacyClientSettingsMigrationPatch(old);
    if (Object.keys(clientPatch).length > 0) {
      const existing = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
      const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
      localStorage.setItem(
        CLIENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...current, ...clientPatch }),
      );
    }
  } catch (error) {
    console.error("[MIGRATION] Error migrating local settings:", error);
  } finally {
    // Remove the legacy key regardless to keep migration one-shot behavior.
    localStorage.removeItem(OLD_SETTINGS_KEY);
  }
}
