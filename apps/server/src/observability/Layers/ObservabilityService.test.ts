import { ThreadId } from "@wobex/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { ServerConfig } from "../../config.ts";
import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { ObservabilityStoreLive } from "../../persistence/Layers/ObservabilityStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ObservabilityStore,
  type ObservabilityStoreShape,
} from "../../persistence/Services/ObservabilityStore.ts";
import { ObservabilityService } from "../Services/ObservabilityService.ts";
import { ObservabilityServiceLive } from "./ObservabilityService.ts";

const liveLayer = it.layer(
  ObservabilityServiceLive.pipe(
    Layer.provide(ObservabilityStoreLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "wobex-observability-" })),
    Layer.provideMerge(NodeServices.layer),
  ),
);

liveLayer("ObservabilityService", (it) => {
  it.effect("flushes buffered writes before queries", () =>
    Effect.gen(function* () {
      const service = yield* ObservabilityService;
      const threadId = ThreadId.make("thread-service");

      yield* service.recordLog({
        source: "rpc",
        level: "warning",
        message: "rpc slow",
        threadId,
        turnId: null,
        provider: null,
        model: null,
        traceId: "trace-service",
        spanId: "span-service",
        outcome: "unknown",
        eventType: "rpc.completed",
        attributes: { method: "server.getConfig" },
      });

      const logs = yield* service.queryLogs({ threadId });
      const overview = yield* service.getOverview();

      assert.equal(logs.records.length, 1);
      assert.equal(logs.records[0]?.message, "rpc slow");
      assert.equal(overview.totalLogs, 1);
    }),
  );

  it.effect("keeps hot-path writes non-fatal when persistence fails", () =>
    Effect.gen(function* () {
      const service = yield* ObservabilityService;

      yield* service.recordLog({
        source: "server",
        level: "info",
        message: "will be dropped",
        threadId: null,
        turnId: null,
        provider: null,
        model: null,
        traceId: null,
        spanId: null,
        outcome: "unknown",
        eventType: "server.test",
        attributes: {},
      });
      yield* service.flush;
    }).pipe(Effect.provide(makeFailingServiceLayer())),
  );
});

function makeFailingServiceLayer() {
  const failingStore: ObservabilityStoreShape = {
    insertLog: () =>
      Effect.fail(
        new PersistenceSqlError({
          operation: "test.insertLog",
          detail: "forced failure",
        }),
      ),
    insertSpan: () => Effect.void,
    incrementRollup: () => Effect.void,
    getOverview: () =>
      Effect.succeed({
        totalLogs: 0,
        errorLogs: 0,
        warningLogs: 0,
        totalSpans: 0,
        slowRpcSpans: 0,
        providerTurns: 0,
        failedProviderTurns: 0,
        terminalRestarts: 0,
        gitFailures: 0,
        dbSizeBytes: 0,
        rawLogSizeBytes: 0,
      }),
    queryLogs: () => Effect.succeed([]),
    querySpans: () => Effect.succeed([]),
    getThreadStats: (input) =>
      Effect.succeed({
        threadId: input.threadId,
        totalLogs: 0,
        errorLogs: 0,
        providerEvents: 0,
        turns: 0,
        failedTurns: 0,
        latestEventAt: null,
      }),
    getProviderStats: () => Effect.succeed({ providers: [] }),
    clearLocalData: () =>
      Effect.succeed({
        deletedLogs: 0,
        deletedSpans: 0,
        deletedRollups: 0,
      }),
  };

  return ObservabilityServiceLive.pipe(
    Layer.provide(Layer.succeed(ObservabilityStore, failingStore)),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "wobex-observability-fail-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}
