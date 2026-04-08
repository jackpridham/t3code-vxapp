import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import CodeFileViewer, { annotateHighlightedCodeHtml } from "./CodeFileViewer";

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: { classList, offsetHeight: 0 },
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

describe("annotateHighlightedCodeHtml", () => {
  it("adds line-number and marker attributes to highlighted output", () => {
    const html =
      '<pre class="shiki"><code><span class="line"><span>const first = 1;</span></span>\n<span class="line"><span>const second = 2;</span></span></code></pre>';

    const result = annotateHighlightedCodeHtml(html, new Map([[2, "modified"]]));

    expect(result.lineCount).toBe(2);
    expect(result.html).toContain('data-line-number="1"');
    expect(result.html).toContain('data-line-number="2"');
    expect(result.html).toContain('data-line-marker="modified"');
    expect(result.html).toContain("code-file-viewer__line");
    expect(result.html).not.toContain("</span>\n<span");
  });
});

describe("CodeFileViewer", () => {
  it("renders a loading state", () => {
    const markup = renderToStaticMarkup(
      <CodeFileViewer path="src/example.ts" content="" markers={new Map()} loading />,
    );

    expect(markup).toMatch(/Loading code file/i);
  });

  it("renders an error state", () => {
    const markup = renderToStaticMarkup(
      <CodeFileViewer
        path="src/example.ts"
        content=""
        markers={new Map()}
        error="Unable to load file."
      />,
    );

    expect(markup).toContain("Unable to load file.");
  });

  it("renders a plain-text fallback with gutter marker attributes", () => {
    const markup = renderToStaticMarkup(
      <CodeFileViewer
        path="src/example.ts"
        content={"const first = 1;\nconst second = 2;"}
        markers={new Map([[2, "added"]])}
      />,
    );

    expect(markup).toContain("code-file-viewer__plain");
    expect(markup).toContain('data-line-number="1"');
    expect(markup).toContain('data-line-number="2"');
    expect(markup).toContain('data-line-marker="added"');
    expect(markup).toContain("const first = 1;");
    expect(markup).toContain("const second = 2;");
  });
});
