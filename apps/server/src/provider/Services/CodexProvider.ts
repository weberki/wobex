import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface CodexProviderShape extends ServerProviderShape {}

export class CodexProvider extends Context.Service<CodexProvider, CodexProviderShape>()(
  "wobex/provider/Services/CodexProvider",
) {}
