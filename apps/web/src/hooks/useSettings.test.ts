import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vitest";
import { buildLegacyClientSettingsMigrationPatch } from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("defaults sidebar orchestration mode to false", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarOrchestrationModeEnabled).toBe(false);
  });

  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        allowActiveThreadsInFold: true,
        changesPanelWindowNavigationMode: "static",
        confirmThreadArchive: true,
        confirmThreadDelete: false,
        maxProjectThreadsBeforeFolding: 3,
        sidebarOrchestrationModeEnabled: true,
        sidebarProjectSortOrder: "manual",
        showGitignoredFilesInMentions: true,
      }),
    ).toEqual({
      allowActiveThreadsInFold: true,
      changesDrawerVisibility: "always_show",
      changesPanelFilesChangedViewType: "list",
      changesPanelWindowNavigationMode: "static",
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      maxProjectThreadsBeforeFolding: 3,
      sidebarOrchestrationModeEnabled: true,
      sidebarProjectSortOrder: "manual",
      showGitignoredFilesInMentions: true,
    });
  });

  it("defaults the changes window navigation mode during legacy migration", () => {
    expect(buildLegacyClientSettingsMigrationPatch({})).toMatchObject({
      changesDrawerVisibility: "always_show",
      changesPanelWindowNavigationMode: "dynamic",
    });
  });
});
