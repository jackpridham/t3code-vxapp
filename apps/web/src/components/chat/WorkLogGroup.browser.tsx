import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WorkLogGroup } from "./WorkLogGroup";

describe("WorkLogGroup", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders expanded thinking rows as a thoughts list instead of raw payload", async () => {
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <WorkLogGroup
        groupId="thinking-group"
        groupedEntries={[
          {
            id: "thinking-entry",
            createdAt: "2026-02-23T00:00:01.000Z",
            label: "Thinking",
            detail: "Need to inspect the ingestion path.",
            thoughts: ["Compare the provider event shapes.", "Need to inspect the ingestion path."],
            tone: "thinking",
            rawPayload: '{"text":"this should stay hidden for thinking rows"}',
          },
        ]}
        isExpanded={false}
        onToggleGroup={() => {}}
      />,
      { container: host },
    );

    try {
      await page.getByLabelText("Show work entry details").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Thoughts");
        expect(text).toContain("Compare the provider event shapes.");
        expect(text).toContain("Need to inspect the ingestion path.");
        expect(text).not.toContain("Raw payload");
        expect(text).not.toContain("this should stay hidden for thinking rows");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
