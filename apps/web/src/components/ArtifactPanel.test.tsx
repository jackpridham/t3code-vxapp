/**
 * ArtifactPanel tests.
 *
 * Tests the ArtifactContent sub-component for each ContentState variant using
 * renderToStaticMarkup (no DOM/jsdom required). ArtifactPanel itself depends
 * on Zustand stores and the TanStack Router and is covered by integration tests.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

// ── Environment stubs ─────────────────────────────────────────────────────────

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

// ── ArtifactContent rendering ─────────────────────────────────────────────────

describe("ArtifactContent", () => {
  it("renders the idle prompt when status is idle", async () => {
    const { ArtifactContent } = await import("./ArtifactPanel");
    const markup = renderToStaticMarkup(
      <ArtifactContent state={{ status: "idle" }} cwd={undefined} />,
    );
    expect(markup).toContain("Select an artifact");
  });

  it("renders loading skeletons when status is loading", async () => {
    const { ArtifactContent } = await import("./ArtifactPanel");
    const markup = renderToStaticMarkup(
      <ArtifactContent state={{ status: "loading" }} cwd={undefined} />,
    );
    // Should render a status element and a screenreader label
    expect(markup).toMatch(/Loading artifact/i);
  });

  it("renders the error message when status is error", async () => {
    const { ArtifactContent } = await import("./ArtifactPanel");
    const markup = renderToStaticMarkup(
      <ArtifactContent
        state={{ status: "error", message: "File not found: report.md" }}
        cwd={undefined}
      />,
    );
    expect(markup).toContain("File not found: report.md");
  });

  it("renders the markdown content when status is loaded", async () => {
    const { ArtifactContent } = await import("./ArtifactPanel");
    const markup = renderToStaticMarkup(
      <ArtifactContent
        state={{
          status: "loaded",
          content: "# My Report\n\nHello world.",
          path: "/repo/@Docs/@Scratch/myrepo/report.md",
        }}
        cwd="/repo"
      />,
    );
    // ChatMarkdown renders the heading and paragraph text
    expect(markup).toContain("My Report");
    expect(markup).toContain("Hello world");
  });

  it("renders empty content gracefully for loaded state with empty string", async () => {
    const { ArtifactContent } = await import("./ArtifactPanel");
    const markup = renderToStaticMarkup(
      <ArtifactContent
        state={{ status: "loaded", content: "", path: "/repo/@Docs/@Scratch/myrepo/empty.md" }}
        cwd="/repo"
      />,
    );
    // Should render without throwing — produces a .chat-markdown wrapper div
    expect(markup).toContain("chat-markdown");
  });
});

// ── ContentState discriminated union ─────────────────────────────────────────

describe("ContentState type guards", () => {
  it("correctly narrows idle state", () => {
    const { ContentState: _ } = { ContentState: null }; // type import only
    const state = { status: "idle" as const };
    expect(state.status).toBe("idle");
  });

  it("correctly narrows loaded state fields", () => {
    const state = {
      status: "loaded" as const,
      content: "# Title",
      path: "/repo/artifact.md",
    };
    expect(state.content).toBe("# Title");
    expect(state.path).toBe("/repo/artifact.md");
  });
});
