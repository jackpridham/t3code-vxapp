import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WorkerLineageIndicator } from "../../lib/workerLineage";
import { WorkerLineageWarningIcon } from "./WorkerLineageWarningIcon";

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipPopup: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip-popup">{children}</div>
  ),
}));

describe("WorkerLineageWarningIcon", () => {
  it("renders one highest-severity icon and lists every issue with severity in the tooltip", () => {
    const indicator: WorkerLineageIndicator = {
      severity: "error",
      label: "Worker ownership problem",
      description:
        "Worker ownership problem: Missing orchestratorThreadId. Missing parentThreadId. Missing workflowId.",
      issues: [
        {
          key: "missing-orchestrator-thread-id",
          severity: "error",
          message: "Missing orchestratorThreadId.",
        },
        {
          key: "missing-parent-thread-id",
          severity: "warning",
          message: "Missing parentThreadId.",
        },
        {
          key: "missing-workflow-id",
          severity: "info",
          message: "Missing workflowId.",
        },
      ],
    };

    const markup = renderToStaticMarkup(<WorkerLineageWarningIcon indicator={indicator} />);

    expect(markup).toContain('aria-label="Worker ownership problem: Missing orchestratorThreadId.');
    expect(markup).toContain("Worker ownership problem");
    expect(markup).toContain("Error: Missing orchestratorThreadId.");
    expect(markup).toContain("Warning: Missing parentThreadId.");
    expect(markup).toContain("Info: Missing workflowId.");
    expect(markup).not.toContain("Worker lineage warning: Missing parentThreadId.");
  });
});
