import { Layer, ServiceMap } from "effect";

export interface KnowledgeConfigShape {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly authToken: string | undefined;
  readonly timeoutMs: number;
}

export class KnowledgeConfig extends ServiceMap.Service<KnowledgeConfig, KnowledgeConfigShape>()(
  "t3/knowledge/KnowledgeConfig",
) {
  static readonly layer = Layer.succeed(KnowledgeConfig, {
    enabled: process.env.T3_KNOWLEDGE_ENABLED === "1",
    baseUrl: process.env.T3_KNOWLEDGE_BASE_URL?.trim() || "http://127.0.0.1:8787",
    authToken: process.env.T3_KNOWLEDGE_AUTH_TOKEN?.trim() || undefined,
    timeoutMs: Number.parseInt(process.env.T3_KNOWLEDGE_TIMEOUT_MS ?? "15000", 10) || 15000,
  } satisfies KnowledgeConfigShape);

  static readonly layerTest = (overrides: Partial<KnowledgeConfigShape> = {}) =>
    Layer.succeed(KnowledgeConfig, {
      enabled: false,
      baseUrl: "http://127.0.0.1:8787",
      authToken: undefined,
      timeoutMs: 15000,
      ...overrides,
    } satisfies KnowledgeConfigShape);
}
