import { useEffect, useMemo } from "react";
import { BotIcon, HardHatIcon, MessageSquareTextIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import ChatView from "../ChatView";
import { useStore } from "../../store";
import { useUiStateStore } from "../../uiStateStore";
import { ThreadId, type ThreadId as ThreadIdType } from "@t3tools/contracts";
import { buildOrchestrationModeRowDescriptor } from "../../lib/orchestrationMode";
import { collectIdeDrawerThreads } from "../../lib/ide";
import type { Thread } from "../../types";

interface IdeChatDrawerProps {
  threadId: ThreadIdType;
}

function DrawerThreadLabel(props: {
  thread: Pick<Thread, "id" | "labels" | "modelSelection" | "spawnRole" | "title">;
}) {
  const descriptor = buildOrchestrationModeRowDescriptor({ thread: props.thread });
  const isWorker = props.thread.spawnRole === "worker";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {isWorker ? (
        <HardHatIcon className="size-3.5 shrink-0 text-amber-500" />
      ) : (
        <BotIcon className="size-3.5 shrink-0 text-sky-500" />
      )}
      {isWorker ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {descriptor.visibleBadges.map((badge) => (
            <Badge
              key={badge.key}
              variant="outline"
              className="h-4 min-w-0 max-w-24 px-1 text-[9px] leading-none text-muted-foreground/80"
              title={`${props.thread.title} · ${badge.label}`}
            >
              <span className="truncate">{badge.label}</span>
            </Badge>
          ))}
        </div>
      ) : (
        <span className="truncate">{props.thread.title}</span>
      )}
    </div>
  );
}

export function IdeChatDrawer({ threadId }: IdeChatDrawerProps) {
  const activeThread = useStore((store) => store.threads.find((thread) => thread.id === threadId));
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const selectedDrawerThreadId = useUiStateStore((state) => state.ideSelectedDrawerThreadId);
  const setIdeSelectedDrawerThreadId = useUiStateStore(
    (state) => state.setIdeSelectedDrawerThreadId,
  );

  const drawerThreads = useMemo(
    () =>
      activeThread
        ? collectIdeDrawerThreads({
            activeThreadId: activeThread.id,
            projects,
            threads,
          })
        : [],
    [activeThread, projects, threads],
  );

  useEffect(() => {
    if (drawerThreads.length === 0) {
      if (selectedDrawerThreadId !== null) {
        setIdeSelectedDrawerThreadId(null);
      }
      return;
    }

    if (
      selectedDrawerThreadId &&
      drawerThreads.some((thread) => thread.id === selectedDrawerThreadId)
    ) {
      return;
    }

    const defaultThreadId =
      drawerThreads.find((thread) => thread.id === threadId)?.id ?? drawerThreads[0]?.id ?? null;
    setIdeSelectedDrawerThreadId(defaultThreadId);
  }, [drawerThreads, selectedDrawerThreadId, setIdeSelectedDrawerThreadId, threadId]);

  const effectiveThreadId = selectedDrawerThreadId ?? threadId;
  const effectiveThread =
    drawerThreads.find((thread) => thread.id === effectiveThreadId) ??
    drawerThreads[0] ??
    activeThread ??
    null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquareTextIcon className="size-4 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
            Chat Drawer
          </span>
        </div>
        <div className="mt-2">
          <Select
            value={effectiveThread?.id ?? ""}
            onValueChange={(value) => {
              if (!value) {
                return;
              }
              const nextThreadId = ThreadId.makeUnsafe(value);
              setIdeSelectedDrawerThreadId(nextThreadId);
            }}
          >
            <SelectTrigger className="w-full min-w-0" aria-label="Select thread for chat drawer">
              <SelectValue>
                {effectiveThread ? <DrawerThreadLabel thread={effectiveThread} /> : "Select thread"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {drawerThreads.map((thread) => (
                <SelectItem key={thread.id} hideIndicator value={thread.id}>
                  <DrawerThreadLabel thread={thread} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {effectiveThread ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ChatView hideHeader layoutMode="drawer" threadId={effectiveThread.id} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No chat thread is available for this project.
          </div>
        )}
      </div>
    </div>
  );
}
