import {
  DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER,
  DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER,
  DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE,
  DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY,
  DEFAULT_WORKER_CHAT_VIEW_VISIBILITY,
} from "@t3tools/contracts/settings";
import { describe, expect, it } from "vitest";
import { buildLegacyClientSettingsMigrationPatch } from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("defaults sidebar orchestration mode to true", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarOrchestrationModeEnabled).toBe(true);
  });

  it("defaults worktree grouping to true", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarGroupWorktreesWithParentProject).toBe(true);
  });

  it("defaults IDE mode to disabled", () => {
    expect(DEFAULT_CLIENT_SETTINGS.ideModeEnabled).toBe(false);
  });

  it("defaults chat view input when scrolling to compact", () => {
    expect(DEFAULT_CLIENT_SETTINGS.chatViewInputWhenScrolling).toBe(
      DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING,
    );
  });

  it("defaults worker chat view to hidden", () => {
    expect(DEFAULT_CLIENT_SETTINGS.workerChatViewVisibility).toBe(
      DEFAULT_WORKER_CHAT_VIEW_VISIBILITY,
    );
  });

  it("defaults worker orchestration notices to hidden", () => {
    expect(DEFAULT_CLIENT_SETTINGS.workerOrchestrationNoticesVisibility).toBe(
      DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY,
    );
  });

  it("defaults worker sidebar filters", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarWorkerVisibilityScope).toBe(
      DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE,
    );
    expect(DEFAULT_CLIENT_SETTINGS.sidebarWorkerLineageFilter).toBe(
      DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER,
    );
    expect(DEFAULT_CLIENT_SETTINGS.sidebarWorkerActivityFilter).toBe(
      DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER,
    );
  });

  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        allowActiveThreadsInFold: true,
        chatViewInputWhenScrolling: "hide",
        changesPanelWindowNavigationMode: "static",
        confirmThreadArchive: true,
        confirmThreadDelete: false,
        ideModeEnabled: true,
        maxProjectThreadsBeforeFolding: 3,
        sidebarGroupWorktreesWithParentProject: false,
        sidebarOrchestrationModeEnabled: true,
        sidebarProjectSortOrder: "manual",
        sidebarWorkerActivityFilter: "active",
        sidebarWorkerLineageFilter: "only_invalid",
        sidebarWorkerVisibilityScope: "all_orchestrators",
        showGitignoredFilesInMentions: true,
        workerChatViewVisibility: "always_show",
        workerOrchestrationNoticesVisibility: "always_show",
      }),
    ).toEqual({
      allowActiveThreadsInFold: true,
      chatViewInputWhenScrolling: "hide",
      changesDrawerVisibility: "always_show",
      changesPanelFilesChangedViewType: "list",
      changesPanelWindowNavigationMode: "static",
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      ideModeEnabled: true,
      maxProjectThreadsBeforeFolding: 3,
      rememberChangesDrawerWidth: true,
      sidebarGroupWorktreesWithParentProject: false,
      sidebarOrchestrationModeEnabled: true,
      sidebarProjectSortOrder: "manual",
      sidebarWorkerActivityFilter: "active",
      sidebarWorkerLineageFilter: "only_invalid",
      sidebarWorkerVisibilityScope: "all_orchestrators",
      showGitignoredFilesInMentions: true,
      workerChatViewVisibility: "always_show",
      workerOrchestrationNoticesVisibility: "always_show",
    });
  });

  it("defaults the changes window navigation mode during legacy migration", () => {
    expect(buildLegacyClientSettingsMigrationPatch({})).toMatchObject({
      chatViewInputWhenScrolling: "compact",
      changesDrawerVisibility: "always_show",
      changesPanelWindowNavigationMode: "dynamic",
      ideModeEnabled: false,
      rememberChangesDrawerWidth: true,
      sidebarWorkerActivityFilter: "all",
      sidebarWorkerLineageFilter: "hide_invalid",
      sidebarWorkerVisibilityScope: "current_orchestrator",
      workerChatViewVisibility: "always_hide",
      workerOrchestrationNoticesVisibility: "always_hide",
    });
  });
});
