import { describe, expect, it } from "vitest";
import { buildLegacyClientSettingsMigrationPatch } from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        allowActiveThreadsInFold: true,
        confirmThreadArchive: true,
        confirmThreadDelete: false,
        maxProjectThreadsBeforeFolding: 3,
        sidebarProjectSortOrder: "manual",
        showGitignoredFilesInMentions: true,
      }),
    ).toEqual({
      allowActiveThreadsInFold: true,
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      maxProjectThreadsBeforeFolding: 3,
      sidebarProjectSortOrder: "manual",
      showGitignoredFilesInMentions: true,
    });
  });
});
