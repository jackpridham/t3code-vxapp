import { TriangleAlertIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function WorkerLineageWarningIcon({ description }: { description: string | null }) {
  if (!description) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={description}
            className="inline-flex shrink-0 items-center justify-center text-amber-500"
          >
            <TriangleAlertIcon className="size-3" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-80 text-xs">
        {description}
      </TooltipPopup>
    </Tooltip>
  );
}
