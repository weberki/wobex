import type {
  DevServerSnapshot,
  DevServerStartInput,
  DevServerStopInput,
  DevServerStreamEvent,
  ManagedDevServer,
  DevServerError,
} from "@wobex/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";

export interface DevServerManagerShape {
  readonly getSnapshot: () => Effect.Effect<DevServerSnapshot, DevServerError>;
  readonly start: (
    input: DevServerStartInput,
  ) => Effect.Effect<ManagedDevServer, DevServerError, OrchestrationEngineService>;
  readonly stop: (input: DevServerStopInput) => Effect.Effect<ManagedDevServer, DevServerError>;
  readonly stream: Stream.Stream<DevServerStreamEvent, DevServerError>;
}

export class DevServerManager extends Context.Service<DevServerManager, DevServerManagerShape>()(
  "wobex/devServers/DevServerManager",
) {}
