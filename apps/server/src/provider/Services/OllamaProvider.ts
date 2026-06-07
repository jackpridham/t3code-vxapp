import { ServiceMap } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface OllamaProviderShape extends ServerProviderShape {}

export class OllamaProvider extends ServiceMap.Service<OllamaProvider, OllamaProviderShape>()(
  "t3/provider/Services/OllamaProvider",
) {}
