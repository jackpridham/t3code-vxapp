import { ThreadId, type NativeApi } from "@t3tools/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRuntimeSnapshotQueryOptions } from "./agentRuntimeReactQuery";
import * as nativeApi from "~/nativeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agentRuntimeSnapshotQueryOptions", () => {
  it("forwards the executive thread id to the server runtime API", async () => {
    const threadId = ThreadId.makeUnsafe("thread-cto-current");
    const getAgentRuntimeSnapshot = vi.fn().mockResolvedValue({
      agentKind: "executive",
      threadId,
    });
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      server: {
        getAgentRuntimeSnapshot,
      },
    } as unknown as NativeApi);

    const options = agentRuntimeSnapshotQueryOptions({
      agentKind: "executive",
      threadId,
    });
    const queryClient = new QueryClient();
    await queryClient.fetchQuery(options);

    expect(getAgentRuntimeSnapshot).toHaveBeenCalledWith({
      agentKind: "executive",
      threadId: ThreadId.makeUnsafe("thread-cto-current"),
    });
  });
});
