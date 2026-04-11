import {
  DEFAULT_CHAT_VIEW_INPUT_WHEN_SCROLLING,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_WORKER_ORCHESTRATION_NOTICES_VISIBILITY,
  DEFAULT_WORKER_CHAT_VIEW_VISIBILITY,
} from "@t3tools/contracts/settings";
import { describe, expect, it } from "vitest";
import { buildLegacyClientSettingsMigrationPatch } from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("defaults sidebar orchestration mode to true", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarOrchestrationModeEnabled).toBe(true);
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

  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        allowActiveThreadsInFold: true,
        chatViewInputWhenScrolling: "hide",
        changesPanelWindowNavigationMode: "static",
        confirmThreadArchive: true,
        confirmThreadDelete: false,
        maxProjectThreadsBeforeFolding: 3,
        sidebarOrchestrationModeEnabled: true,
        sidebarProjectSortOrder: "manual",
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
      maxProjectThreadsBeforeFolding: 3,
      rememberChangesDrawerWidth: true,
      sidebarOrchestrationModeEnabled: true,
      sidebarProjectSortOrder: "manual",
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
      rememberChangesDrawerWidth: true,
      workerChatViewVisibility: "always_hide",
      workerOrchestrationNoticesVisibility: "always_hide",
    });
  });
});
