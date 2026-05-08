import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface DroidProviderShape extends ServerProviderShape {}

export class DroidProvider extends Context.Service<DroidProvider, DroidProviderShape>()(
  "wobex/provider/Services/DroidProvider",
) {}
