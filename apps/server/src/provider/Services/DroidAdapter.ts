import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface DroidAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "droid";
}

export class DroidAdapter extends Context.Service<DroidAdapter, DroidAdapterShape>()(
  "wobex/provider/Services/DroidAdapter",
) {}
