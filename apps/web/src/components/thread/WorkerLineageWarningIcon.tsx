import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { WorkerLineageIndicator, WorkerLineageIssueSeverity } from "../../lib/workerLineage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const ICON_CLASS_BY_SEVERITY: Record<WorkerLineageIssueSeverity, string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-sky-500",
};

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
            aria-label={indicator.label}
            className={`inline-flex shrink-0 items-center justify-center ${ICON_CLASS_BY_SEVERITY[indicator.severity]}`}
          >
            <Icon className="size-3" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-80 text-xs">
        {indicator.description}
      </TooltipPopup>
    </Tooltip>
  );
}
