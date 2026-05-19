import type { AgentsVxappOwnerBoundaryError } from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";

export function VortexErrorBanner(props: {
  readonly heading: string;
  readonly error: AgentsVxappOwnerBoundaryError | null;
  readonly fallbackMessage: string;
}) {
  const code = props.error?.code ?? null;
  const title = props.error?.title ?? null;
  const message = props.error?.message ?? props.fallbackMessage;

  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-2 text-[11px] leading-relaxed text-red-800 dark:text-red-200">
      <div className="flex items-start gap-2">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium">{props.heading}</p>
            {code ? (
              <span className="rounded border border-red-500/25 bg-background/55 px-1 py-0.5 text-[10px] font-semibold">
                Error {code}
              </span>
            ) : null}
          </div>
          {title ? (
            <p className="mt-0.5 font-medium text-red-700/95 dark:text-red-200/90">{title}</p>
          ) : null}
          <p className="mt-0.5 text-red-700/90 dark:text-red-200/80">{message}</p>
          {props.error?.ownerErrorCode ? (
            <p className="mt-1 text-[10px] text-red-700/80 dark:text-red-200/70">
              owner code: <code>{props.error.ownerErrorCode}</code>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
