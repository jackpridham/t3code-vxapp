import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { WorkerLineageIndicator, WorkerLineageIssueSeverity } from "../../lib/workerLineage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const ICON_CLASS_BY_SEVERITY: Record<WorkerLineageIssueSeverity, string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-sky-500",
};

function formatSeverityLabel(severity: WorkerLineageIssueSeverity): string {
  return severity === "error" ? "Error" : severity === "warning" ? "Warning" : "Info";
}

export function WorkerLineageWarningIcon({
  indicator,
}: {
  indicator: WorkerLineageIndicator | null;
}) {
  if (!indicator) {
    return null;
  }

  const Icon =
    indicator.severity === "error"
      ? CircleAlertIcon
      : indicator.severity === "warning"
        ? TriangleAlertIcon
        : InfoIcon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={indicator.description}
            className={`inline-flex shrink-0 items-center justify-center ${ICON_CLASS_BY_SEVERITY[indicator.severity]}`}
          >
            <Icon className="size-3" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-80 text-xs">
        <div className="space-y-1">
          <div className="font-medium">{indicator.label}</div>
          <ul className="space-y-0.5">
            {indicator.issues.map((issue) => (
              <li key={issue.key}>
                {formatSeverityLabel(issue.severity)}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
