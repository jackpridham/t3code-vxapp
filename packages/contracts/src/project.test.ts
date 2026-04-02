import { describe, expect, it } from "vitest";

import { ProjectSearchEntriesInput } from "./project";
import { Schema } from "effect";

describe("ProjectSearchEntriesInput", () => {
  it("accepts an empty query for scoped pickers", () => {
    expect(
      Schema.decodeSync(ProjectSearchEntriesInput)({
        cwd: "/workspace/app",
        query: "",
        limit: 20,
      }),
    ).toEqual({
      cwd: "/workspace/app",
      query: "",
      limit: 20,
      includeIgnored: false,
    });
  });
});
