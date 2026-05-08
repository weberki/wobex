import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface OpenCodeProviderShape extends ServerProviderShape {}

export class OpenCodeProvider extends Context.Service<OpenCodeProvider, OpenCodeProviderShape>()(
  "wobex/provider/Services/OpenCodeProvider",
) {}
