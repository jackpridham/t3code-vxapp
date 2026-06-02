export interface BrowserWsFrame {
  readonly dir: "in" | "out";
  readonly t: number;
  readonly wallTime: number;
  readonly raw: string;
  readonly byteLength: number;
}

export interface RpcExchange {
  readonly id: string;
  readonly method: string;
  readonly requestBody: Record<string, unknown>;
  readonly requestBytes: number;
  readonly responseBytes: number | null;
  readonly result: unknown;
  readonly error: unknown;
  readonly sentAt: number;
  readonly receivedAt: number | null;
}

export interface DomainEventEvidence {
  readonly frame: BrowserWsFrame;
  readonly event: Record<string, unknown>;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBrowserWsFrame(value: unknown): BrowserWsFrame | null {
  if (!isRecord(value)) {
    return null;
  }
  const dir = value.dir;
  const raw = value.raw;
  const t = value.t;
  const wallTime = value.wallTime;
  if (
    (dir !== "in" && dir !== "out") ||
    typeof raw !== "string" ||
    typeof t !== "number" ||
    !Number.isFinite(t) ||
    typeof wallTime !== "number" ||
    !Number.isFinite(wallTime)
  ) {
    return null;
  }
  return {
    dir,
    raw,
    t,
    wallTime,
    byteLength:
      typeof value.byteLength === "number" && Number.isFinite(value.byteLength)
        ? value.byteLength
        : utf8ByteLength(raw),
  };
}

export function normalizeBrowserWsFrames(values: readonly unknown[]): readonly BrowserWsFrame[] {
  return values.flatMap((value) => {
    const frame = normalizeBrowserWsFrame(value);
    return frame ? [frame] : [];
  });
}

export function extractOutboundMethod(frame: BrowserWsFrame): string | null {
  if (frame.dir !== "out") {
    return null;
  }
  const parsed = safeParseJson(frame.raw);
  if (!isRecord(parsed) || !isRecord(parsed.body)) {
    return null;
  }
  const tag = parsed.body._tag;
  return typeof tag === "string" && tag.length > 0 ? tag : null;
}

export function pairRpcExchanges(frames: readonly BrowserWsFrame[]): readonly RpcExchange[] {
  const requests = new Map<
    string,
    {
      readonly frame: BrowserWsFrame;
      readonly body: Record<string, unknown>;
      readonly method: string;
    }
  >();
  const exchanges: RpcExchange[] = [];

  for (const frame of frames) {
    const parsed = safeParseJson(frame.raw);
    if (!isRecord(parsed)) {
      continue;
    }
    if (frame.dir === "out") {
      const id = parsed.id;
      if (typeof id !== "string" || !isRecord(parsed.body)) {
        continue;
      }
      const method = parsed.body._tag;
      if (typeof method !== "string") {
        continue;
      }
      requests.set(id, { frame, body: parsed.body, method });
      continue;
    }

    const id = parsed.id;
    if (typeof id !== "string") {
      continue;
    }
    const request = requests.get(id);
    if (!request) {
      continue;
    }
    exchanges.push({
      id,
      method: request.method,
      requestBody: request.body,
      requestBytes: request.frame.byteLength,
      responseBytes: frame.byteLength,
      result: parsed.result,
      error: parsed.error,
      sentAt: request.frame.wallTime,
      receivedAt: frame.wallTime,
    });
  }

  for (const [id, request] of requests.entries()) {
    if (exchanges.some((exchange) => exchange.id === id)) {
      continue;
    }
    exchanges.push({
      id,
      method: request.method,
      requestBody: request.body,
      requestBytes: request.frame.byteLength,
      responseBytes: null,
      result: undefined,
      error: undefined,
      sentAt: request.frame.wallTime,
      receivedAt: null,
    });
  }

  return exchanges;
}

export function extractDomainEvents(
  frames: readonly BrowserWsFrame[],
): readonly DomainEventEvidence[] {
  const output: DomainEventEvidence[] = [];
  for (const frame of frames) {
    if (frame.dir !== "in") {
      continue;
    }
    const parsed = safeParseJson(frame.raw);
    if (
      !isRecord(parsed) ||
      parsed.type !== "push" ||
      parsed.channel !== "orchestration.domainEvent" ||
      !isRecord(parsed.data)
    ) {
      continue;
    }
    output.push({ frame, event: parsed.data });
  }
  return output;
}

export function getPath(value: unknown, path: string): unknown {
  if (path.length === 0) {
    return value;
  }
  let current = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function summarizeExchanges(exchanges: readonly RpcExchange[]) {
  return exchanges.map((exchange) => ({
    id: exchange.id,
    method: exchange.method,
    requestBytes: exchange.requestBytes,
    responseBytes: exchange.responseBytes,
    elapsedMs:
      exchange.receivedAt === null ? null : Math.max(0, exchange.receivedAt - exchange.sentAt),
    hasError: exchange.error !== undefined && exchange.error !== null,
  }));
}

export function makeRecorderInitScript(): string {
  return String.raw`
(() => {
  const OriginalWebSocket = window.WebSocket;
  const log = [];
  Object.defineProperty(window, "__t3PerfWsLog", {
    configurable: true,
    value: log,
  });
  const byteLength = (value) => new TextEncoder().encode(String(value)).length;
  class T3PerfLoggedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener("message", (event) => {
        const raw = String(event.data);
        log.push({ dir: "in", t: performance.now(), wallTime: Date.now(), raw, byteLength: byteLength(raw) });
      });
    }
    send(data) {
      const raw = String(data);
      log.push({ dir: "out", t: performance.now(), wallTime: Date.now(), raw, byteLength: byteLength(raw) });
      return super.send(data);
    }
  }
  Object.defineProperty(T3PerfLoggedWebSocket, "CONNECTING", { value: OriginalWebSocket.CONNECTING });
  Object.defineProperty(T3PerfLoggedWebSocket, "OPEN", { value: OriginalWebSocket.OPEN });
  Object.defineProperty(T3PerfLoggedWebSocket, "CLOSING", { value: OriginalWebSocket.CLOSING });
  Object.defineProperty(T3PerfLoggedWebSocket, "CLOSED", { value: OriginalWebSocket.CLOSED });
  window.WebSocket = T3PerfLoggedWebSocket;
})();
`;
}
