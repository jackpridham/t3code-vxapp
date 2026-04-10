import { ThreadId } from "@t3tools/contracts";
import type { OrchestrationModeSessionCatalogEntry } from "../../lib/orchestrationMode";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const CREATE_NEW_SESSION_VALUE = "__new_orchestration_session__";

function describeSessionOption(session: OrchestrationModeSessionCatalogEntry): string {
  const activityLabel =
    session.archivedAt === null
      ? `Active · updated ${formatRelativeTimeLabel(session.updatedAt)}`
      : `Archived · updated ${formatRelativeTimeLabel(session.updatedAt)}`;
  return `${activityLabel} · ${session.workerThreadCount} worker${session.workerThreadCount === 1 ? "" : "s"}`;
}

export function OrchestrationSessionSelector(props: {
  projectName: string;
  selectedRootThreadId: ThreadId | null;
  sessionOptions: readonly OrchestrationModeSessionCatalogEntry[];
  isLoading: boolean;
  errorMessage?: string | null;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
  onSelectSession: (rootThreadId: ThreadId) => void;
  onCreateSession?: () => void;
}) {
  const compact = props.compact ?? false;
  const iconOnly = props.iconOnly ?? false;

  return (
    <div className={cn(compact || iconOnly ? "min-w-0" : "px-2 pb-2", props.className)}>
      {compact || iconOnly ? null : (
        <div className="mb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Sessions
        </div>
      )}
      <Select
        value={props.selectedRootThreadId ?? ""}
        onValueChange={(value) => {
          if (!value || value.length === 0) {
            return;
          }
          if (value === CREATE_NEW_SESSION_VALUE) {
            props.onCreateSession?.();
            return;
          }
          props.onSelectSession(ThreadId.makeUnsafe(value));
        }}
      >
        <SelectTrigger
          size={compact || iconOnly ? "xs" : undefined}
          variant={iconOnly ? "ghost" : undefined}
          className={cn(
            iconOnly
              ? "size-5 justify-center gap-0 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
              : compact
                ? "h-7 w-28 max-w-full text-[11px]"
                : "h-8 w-full text-xs",
            "min-w-0",
          )}
          aria-label={`Orchestration sessions for ${props.projectName}`}
        >
          {iconOnly ? null : (
            <SelectValue placeholder={props.isLoading ? "Loading..." : "Session"} />
          )}
        </SelectTrigger>
        <SelectPopup align={iconOnly ? "end" : "start"} alignItemWithTrigger={false}>
          <SelectItem value={CREATE_NEW_SESSION_VALUE}>
            <div className="flex min-w-0 flex-col py-0.5 text-left">
              <span className="truncate text-xs font-medium">
                {`New ${props.projectName} Session`}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">
                Archive the current session workers and start fresh
              </span>
            </div>
          </SelectItem>
          {props.sessionOptions.map((session) => (
            <SelectItem key={session.rootThreadId} value={session.rootThreadId}>
              <div className="flex min-w-0 flex-col py-0.5 text-left">
                <span className="truncate text-xs">{session.title}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {describeSessionOption(session)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {props.errorMessage && !compact && !iconOnly ? (
        <p className="mt-1 text-[10px] text-destructive">{props.errorMessage}</p>
      ) : null}
    </div>
  );
}
