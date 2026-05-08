import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface ClaudeProviderShape extends ServerProviderShape {}

export class ClaudeProvider extends Context.Service<ClaudeProvider, ClaudeProviderShape>()(
  "wobex/provider/Services/ClaudeProvider",
) {}
