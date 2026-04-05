import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DiffPanelShell } from "./DiffPanelShell";

describe("DiffPanelShell", () => {
  it("renders a top-right close button when an onClose handler is provided", () => {
    const markup = renderToStaticMarkup(
      <DiffPanelShell mode="inline" header={<div>Header</div>} onClose={vi.fn()}>
        <div>Body</div>
      </DiffPanelShell>,
    );

    expect(markup).toContain('aria-label="Close diff panel"');
  });

  it("omits the close button when no onClose handler is provided", () => {
    const markup = renderToStaticMarkup(
      <DiffPanelShell mode="inline" header={<div>Header</div>}>
        <div>Body</div>
      </DiffPanelShell>,
    );

    expect(markup).not.toContain('aria-label="Close diff panel"');
  });
});
