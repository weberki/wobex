import { ThreadId, TurnId } from "@wobex/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { ObservabilityStore } from "../Services/ObservabilityStore.ts";
import { ObservabilityStoreLive } from "./ObservabilityStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(ObservabilityStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const threadId = ThreadId.make("thread-observability");
const turnId = TurnId.make("turn-observability");
const baseRecordedAt = "2026-04-12T20:00:00.000Z";

layer("ObservabilityStore", (it) => {
  it.effect("inserts logs and filters query results", () =>
    Effect.gen(function* () {
      const store = yield* ObservabilityStore;
      yield* store.clearLocalData();

      yield* store.insertLog({
        recordedAt: baseRecordedAt,
        source: "provider",
        level: "error",
        message: "turn failed with compact summary",
        threadId,
        turnId,
        provider: "codex",
        model: "gpt-5.4",
        traceId: "trace-provider",
        spanId: "span-provider",
        outcome: "failure",
        eventType: "turn.completed",
        attributes: { requestId: "req-1" },
      });
      yield* store.insertLog({
        recordedAt: "2026-04-12T20:01:00.000Z",
        source: "git",
        level: "info",
        message: "status success",
        threadId: null,
        turnId: null,
        provider: null,
        model: null,
        traceId: null,
        spanId: null,
        outcome: "success",
        eventType: "status",
        attributes: {},
      });

      const records = yield* store.queryLogs({
        source: "provider",
        level: "error",
        threadId,
        search: "failed",
      });

      assert.equal(records.length, 1);
      assert.equal(records[0]?.message, "turn failed with compact summary");
      assert.deepEqual(records[0]?.attributes, { requestId: "req-1" });
    }),
  );

  it.effect("computes rollups, spans, and provider/thread stats", () =>
    Effect.gen(function* () {
      const store = yield* ObservabilityStore;
      yield* store.clearLocalData();

      yield* store.insertLog({
        recordedAt: baseRecordedAt,
        source: "provider",
        level: "info",
        message: "turn started",
        threadId,
        turnId,
        provider: "claudeAgent",
        model: "claude-sonnet",
        traceId: null,
        spanId: null,
        outcome: "unknown",
        eventType: "turn.started",
        attributes: {},
      });
      yield* store.insertLog({
        recordedAt: "2026-04-12T20:02:00.000Z",
        source: "terminal",
        level: "info",
        message: "terminal restarted",
        threadId,
        turnId: null,
        provider: null,
        model: null,
        traceId: null,
        spanId: null,
        outcome: "unknown",
        eventType: "restarted",
        attributes: {},
      });
      yield* store.insertSpan({
        recordedAt: "2026-04-12T20:03:00.000Z",
        source: "rpc",
        name: "rpc.git.status",
        kind: "server",
        traceId: "trace-rpc",
        spanId: "span-rpc",
        parentSpanId: null,
        durationMs: 1_250,
        outcome: "success",
        rpcMethod: "git.status",
        threadId,
        turnId: null,
        provider: null,
        model: null,
        attributes: { aggregate: "git" },
      });
      yield* store.incrementRollup({
        bucketStart: "2026-04-12T20:00:00.000Z",
        bucketSizeSeconds: 60,
        metric: "rpc.latency",
        dimensions: { method: "git.status" },
        value: 1,
        updatedAt: "2026-04-12T20:03:00.000Z",
      });

      const overview = yield* store.getOverview();
      const spans = yield* store.querySpans({ rpcMethod: "git.status", minDurationMs: 1_000 });
      const threadStats = yield* store.getThreadStats({ threadId });
      const providerStats = yield* store.getProviderStats();

      assert.equal(overview.totalLogs, 2);
      assert.equal(overview.slowRpcSpans, 1);
      assert.equal(overview.providerTurns, 1);
      assert.equal(overview.terminalRestarts, 1);
      assert.equal(spans.length, 1);
      assert.deepEqual(spans[0]?.attributes, { aggregate: "git" });
      assert.equal(threadStats.totalLogs, 2);
      assert.equal(providerStats.providers[0]?.provider, "claudeAgent");
    }),
  );

  it.effect("clears local metadata without touching raw files", () =>
    Effect.gen(function* () {
      const store = yield* ObservabilityStore;
      yield* store.clearLocalData();

      yield* store.insertLog({
        recordedAt: baseRecordedAt,
        source: "server",
        level: "info",
        message: "server booted",
        threadId: null,
        turnId: null,
        provider: null,
        model: null,
        traceId: null,
        spanId: null,
        outcome: "success",
        eventType: "server.boot",
        attributes: {},
      });
      yield* store.insertSpan({
        recordedAt: baseRecordedAt,
        source: "server",
        name: "server.boot",
        kind: "internal",
        traceId: "trace-server",
        spanId: "span-server",
        parentSpanId: null,
        durationMs: 4,
        outcome: "success",
        rpcMethod: null,
        threadId: null,
        turnId: null,
        provider: null,
        model: null,
        attributes: {},
      });

      const cleared = yield* store.clearLocalData();
      const overview = yield* store.getOverview();

      assert.equal(cleared.deletedLogs, 1);
      assert.equal(cleared.deletedSpans, 1);
      assert.equal(overview.totalLogs, 0);
      assert.equal(overview.totalSpans, 0);
    }),
  );

  it.effect("fails with PersistenceDecodeError for malformed attribute json", () =>
    Effect.gen(function* () {
      const store = yield* ObservabilityStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.clearLocalData();

      yield* sql`
        INSERT INTO observability_logs (
          recorded_at,
          source,
          level,
          message,
          attributes_json
        )
        VALUES (
          ${baseRecordedAt},
          ${"server"},
          ${"info"},
          ${"bad attributes"},
          ${"{"}
        )
      `;

      const result = yield* Effect.result(store.queryLogs({ source: "server" }));

      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.ok(Schema.is(PersistenceDecodeError)(result.failure));
      }
    }),
  );
});
