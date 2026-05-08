import {
  DEFAULT_EMPTY_OBSERVABILITY_OVERVIEW,
  DEFAULT_OBSERVABILITY_LOG_LIMIT,
  DEFAULT_OBSERVABILITY_SPAN_LIMIT,
  ObservabilityClearLocalDataResult,
  ObservabilityLogRecord,
  ObservabilityOverview,
  ObservabilityProviderStatsResult,
  ObservabilitySpanRecord,
  ObservabilityThreadStats,
} from "@wobex/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer, Schema } from "effect";

import {
  toPersistenceDecodeCauseError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  ObservabilityStore,
  type ObservabilityLogInsert,
  type ObservabilityRollupIncrement,
  type ObservabilitySpanInsert,
  type ObservabilityStoreShape,
} from "../Services/ObservabilityStore.ts";

type CountRow = { readonly count: number | string | bigint | null };
type LogDbRow = Omit<ObservabilityLogRecord, "attributes"> & {
  readonly attributesJson: string;
};
type SpanDbRow = Omit<ObservabilitySpanRecord, "attributes"> & {
  readonly attributesJson: string;
};
type OverviewRow = {
  readonly totalLogs: number | string | bigint | null;
  readonly errorLogs: number | string | bigint | null;
  readonly warningLogs: number | string | bigint | null;
  readonly totalSpans: number | string | bigint | null;
  readonly slowRpcSpans: number | string | bigint | null;
  readonly providerTurns: number | string | bigint | null;
  readonly failedProviderTurns: number | string | bigint | null;
  readonly terminalRestarts: number | string | bigint | null;
  readonly gitFailures: number | string | bigint | null;
};

function asCount(value: number | string | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

function escapeLike(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const decodeAttributes = (operation: string, attributesJson: string) =>
  Effect.try({
    try: () => JSON.parse(attributesJson) as unknown,
    catch: toPersistenceDecodeCauseError(operation),
  });

const decodeLogs = (rows: ReadonlyArray<LogDbRow>) =>
  Effect.forEach(rows, (row) =>
    decodeAttributes("ObservabilityStore.queryLogs:decodeAttributes", row.attributesJson).pipe(
      Effect.flatMap((attributes) =>
        Schema.decodeUnknownEffect(ObservabilityLogRecord)({
          ...row,
          attributes,
        }).pipe(
          Effect.mapError(toPersistenceDecodeError("ObservabilityStore.queryLogs:decodeRows")),
        ),
      ),
    ),
  );

const decodeSpans = (rows: ReadonlyArray<SpanDbRow>) =>
  Effect.forEach(rows, (row) =>
    decodeAttributes("ObservabilityStore.querySpans:decodeAttributes", row.attributesJson).pipe(
      Effect.flatMap((attributes) =>
        Schema.decodeUnknownEffect(ObservabilitySpanRecord)({
          ...row,
          attributes,
        }).pipe(
          Effect.mapError(toPersistenceDecodeError("ObservabilityStore.querySpans:decodeRows")),
        ),
      ),
    ),
  );

const makeObservabilityStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertLog: ObservabilityStoreShape["insertLog"] = (record: ObservabilityLogInsert) =>
    sql`
      INSERT INTO observability_logs (
        recorded_at,
        source,
        level,
        message,
        thread_id,
        turn_id,
        provider,
        model,
        trace_id,
        span_id,
        outcome,
        event_type,
        attributes_json
      )
      VALUES (
        ${record.recordedAt},
        ${record.source},
        ${record.level},
        ${record.message},
        ${record.threadId},
        ${record.turnId},
        ${record.provider},
        ${record.model},
        ${record.traceId},
        ${record.spanId},
        ${record.outcome},
        ${record.eventType},
        ${safeJsonStringify(record.attributes)}
      )
    `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("ObservabilityStore.insertLog")));

  const insertSpan: ObservabilityStoreShape["insertSpan"] = (record: ObservabilitySpanInsert) =>
    sql`
      INSERT INTO observability_spans (
        recorded_at,
        source,
        name,
        kind,
        trace_id,
        span_id,
        parent_span_id,
        duration_ms,
        outcome,
        rpc_method,
        thread_id,
        turn_id,
        provider,
        model,
        attributes_json
      )
      VALUES (
        ${record.recordedAt},
        ${record.source},
        ${record.name},
        ${record.kind},
        ${record.traceId},
        ${record.spanId},
        ${record.parentSpanId},
        ${record.durationMs},
        ${record.outcome},
        ${record.rpcMethod},
        ${record.threadId},
        ${record.turnId},
        ${record.provider},
        ${record.model},
        ${safeJsonStringify(record.attributes)}
      )
    `.pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("ObservabilityStore.insertSpan")));

  const incrementRollup: ObservabilityStoreShape["incrementRollup"] = (
    input: ObservabilityRollupIncrement,
  ) =>
    sql`
      INSERT INTO observability_stats_rollups (
        bucket_start,
        bucket_size_seconds,
        metric,
        dimensions_json,
        value,
        updated_at
      )
      VALUES (
        ${input.bucketStart},
        ${input.bucketSizeSeconds},
        ${input.metric},
        ${safeJsonStringify(input.dimensions)},
        ${input.value},
        ${input.updatedAt}
      )
      ON CONFLICT (bucket_start, bucket_size_seconds, metric, dimensions_json)
      DO UPDATE SET
        value = value + excluded.value,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ObservabilityStore.incrementRollup")),
    );

  const getOverview: ObservabilityStoreShape["getOverview"] = () =>
    sql<OverviewRow>`
      SELECT
        (SELECT COUNT(*) FROM observability_logs) AS "totalLogs",
        (SELECT COUNT(*) FROM observability_logs WHERE level = 'error') AS "errorLogs",
        (SELECT COUNT(*) FROM observability_logs WHERE level = 'warning') AS "warningLogs",
        (SELECT COUNT(*) FROM observability_spans) AS "totalSpans",
        (
          SELECT COUNT(*)
          FROM observability_spans
          WHERE rpc_method IS NOT NULL AND duration_ms >= 1000
        ) AS "slowRpcSpans",
        (
          SELECT COUNT(*)
          FROM observability_logs
          WHERE source = 'provider' AND event_type IN ('turn.started', 'turn.completed')
        ) AS "providerTurns",
        (
          SELECT COUNT(*)
          FROM observability_logs
          WHERE source = 'provider'
            AND event_type IN ('turn.aborted', 'runtime.error', 'turn.completed')
            AND (outcome = 'failure' OR level = 'error')
        ) AS "failedProviderTurns",
        (
          SELECT COUNT(*)
          FROM observability_logs
          WHERE source = 'terminal' AND event_type = 'restarted'
        ) AS "terminalRestarts",
        (
          SELECT COUNT(*)
          FROM observability_logs
          WHERE source = 'git' AND outcome = 'failure'
        ) AS "gitFailures"
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ObservabilityStore.getOverview:query")),
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(ObservabilityOverview)({
          ...DEFAULT_EMPTY_OBSERVABILITY_OVERVIEW,
          totalLogs: asCount(rows[0]?.totalLogs),
          errorLogs: asCount(rows[0]?.errorLogs),
          warningLogs: asCount(rows[0]?.warningLogs),
          totalSpans: asCount(rows[0]?.totalSpans),
          slowRpcSpans: asCount(rows[0]?.slowRpcSpans),
          providerTurns: asCount(rows[0]?.providerTurns),
          failedProviderTurns: asCount(rows[0]?.failedProviderTurns),
          terminalRestarts: asCount(rows[0]?.terminalRestarts),
          gitFailures: asCount(rows[0]?.gitFailures),
        }).pipe(Effect.mapError(toPersistenceDecodeError("ObservabilityStore.getOverview:decode"))),
      ),
    );

  const queryLogs: ObservabilityStoreShape["queryLogs"] = (input) => {
    const search = input.search && input.search.trim().length > 0 ? escapeLike(input.search) : null;
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_OBSERVABILITY_LOG_LIMIT, 1), 500);
    return sql<LogDbRow>`
      SELECT
        id,
        recorded_at AS "recordedAt",
        source,
        level,
        message,
        thread_id AS "threadId",
        turn_id AS "turnId",
        provider,
        model,
        trace_id AS "traceId",
        span_id AS "spanId",
        outcome,
        event_type AS "eventType",
        attributes_json AS "attributesJson"
      FROM observability_logs
      WHERE (${input.source ?? null} IS NULL OR source = ${input.source ?? null})
        AND (${input.level ?? null} IS NULL OR level = ${input.level ?? null})
        AND (${input.provider ?? null} IS NULL OR provider = ${input.provider ?? null})
        AND (${input.threadId ?? null} IS NULL OR thread_id = ${input.threadId ?? null})
        AND (${input.turnId ?? null} IS NULL OR turn_id = ${input.turnId ?? null})
        AND (${input.since ?? null} IS NULL OR recorded_at >= ${input.since ?? null})
        AND (${input.until ?? null} IS NULL OR recorded_at <= ${input.until ?? null})
        AND (${search} IS NULL OR message LIKE ${search} ESCAPE '\\')
      ORDER BY recorded_at DESC, id DESC
      LIMIT ${limit}
    `.pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ObservabilityStore.queryLogs:query",
          "ObservabilityStore.queryLogs:decodeRequest",
        ),
      ),
      Effect.flatMap(decodeLogs),
    );
  };

  const querySpans: ObservabilityStoreShape["querySpans"] = (input) => {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_OBSERVABILITY_SPAN_LIMIT, 1), 500);
    return sql<SpanDbRow>`
      SELECT
        id,
        recorded_at AS "recordedAt",
        source,
        name,
        kind,
        trace_id AS "traceId",
        span_id AS "spanId",
        parent_span_id AS "parentSpanId",
        duration_ms AS "durationMs",
        outcome,
        rpc_method AS "rpcMethod",
        thread_id AS "threadId",
        turn_id AS "turnId",
        provider,
        model,
        attributes_json AS "attributesJson"
      FROM observability_spans
      WHERE (${input.source ?? null} IS NULL OR source = ${input.source ?? null})
        AND (${input.provider ?? null} IS NULL OR provider = ${input.provider ?? null})
        AND (${input.threadId ?? null} IS NULL OR thread_id = ${input.threadId ?? null})
        AND (${input.turnId ?? null} IS NULL OR turn_id = ${input.turnId ?? null})
        AND (${input.rpcMethod ?? null} IS NULL OR rpc_method = ${input.rpcMethod ?? null})
        AND (${input.minDurationMs ?? null} IS NULL OR duration_ms >= ${input.minDurationMs ?? null})
        AND (${input.since ?? null} IS NULL OR recorded_at >= ${input.since ?? null})
        AND (${input.until ?? null} IS NULL OR recorded_at <= ${input.until ?? null})
      ORDER BY recorded_at DESC, id DESC
      LIMIT ${limit}
    `.pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ObservabilityStore.querySpans:query",
          "ObservabilityStore.querySpans:decodeRequest",
        ),
      ),
      Effect.flatMap(decodeSpans),
    );
  };

  const getThreadStats: ObservabilityStoreShape["getThreadStats"] = (input) =>
    sql<{
      readonly totalLogs: number | string | bigint | null;
      readonly errorLogs: number | string | bigint | null;
      readonly providerEvents: number | string | bigint | null;
      readonly turns: number | string | bigint | null;
      readonly failedTurns: number | string | bigint | null;
      readonly latestEventAt: string | null;
    }>`
      SELECT
        COUNT(*) AS "totalLogs",
        SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS "errorLogs",
        SUM(CASE WHEN source = 'provider' THEN 1 ELSE 0 END) AS "providerEvents",
        SUM(CASE WHEN source = 'provider' AND event_type LIKE 'turn.%' THEN 1 ELSE 0 END) AS "turns",
        SUM(
          CASE WHEN source = 'provider' AND (outcome = 'failure' OR level = 'error') THEN 1 ELSE 0 END
        ) AS "failedTurns",
        MAX(recorded_at) AS "latestEventAt"
      FROM observability_logs
      WHERE thread_id = ${input.threadId}
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ObservabilityStore.getThreadStats:query")),
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(ObservabilityThreadStats)({
          threadId: input.threadId,
          totalLogs: asCount(rows[0]?.totalLogs),
          errorLogs: asCount(rows[0]?.errorLogs),
          providerEvents: asCount(rows[0]?.providerEvents),
          turns: asCount(rows[0]?.turns),
          failedTurns: asCount(rows[0]?.failedTurns),
          latestEventAt: rows[0]?.latestEventAt ?? null,
        }).pipe(
          Effect.mapError(toPersistenceDecodeError("ObservabilityStore.getThreadStats:decode")),
        ),
      ),
    );

  const getProviderStats: ObservabilityStoreShape["getProviderStats"] = () =>
    sql<{
      readonly provider: unknown;
      readonly model: string | null;
      readonly totalLogs: number | string | bigint | null;
      readonly turns: number | string | bigint | null;
      readonly failures: number | string | bigint | null;
      readonly latestEventAt: string | null;
    }>`
      SELECT
        provider,
        model,
        COUNT(*) AS "totalLogs",
        SUM(CASE WHEN event_type LIKE 'turn.%' THEN 1 ELSE 0 END) AS "turns",
        SUM(CASE WHEN outcome = 'failure' OR level = 'error' THEN 1 ELSE 0 END) AS "failures",
        MAX(recorded_at) AS "latestEventAt"
      FROM observability_logs
      WHERE provider IS NOT NULL
      GROUP BY provider, model
      ORDER BY "totalLogs" DESC, provider ASC, model ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ObservabilityStore.getProviderStats:query")),
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(ObservabilityProviderStatsResult)({
          providers: rows.map((row) => ({
            provider: row.provider,
            model: row.model,
            totalLogs: asCount(row.totalLogs),
            turns: asCount(row.turns),
            failures: asCount(row.failures),
            latestEventAt: row.latestEventAt,
          })),
        }).pipe(
          Effect.mapError(toPersistenceDecodeError("ObservabilityStore.getProviderStats:decode")),
        ),
      ),
    );

  const countRows = (
    table: "observability_logs" | "observability_spans" | "observability_stats_rollups",
  ) => {
    switch (table) {
      case "observability_logs":
        return sql<CountRow>`SELECT COUNT(*) AS "count" FROM observability_logs`.pipe(
          Effect.map((rows) => asCount(rows[0]?.count)),
        );
      case "observability_spans":
        return sql<CountRow>`SELECT COUNT(*) AS "count" FROM observability_spans`.pipe(
          Effect.map((rows) => asCount(rows[0]?.count)),
        );
      case "observability_stats_rollups":
        return sql<CountRow>`SELECT COUNT(*) AS "count" FROM observability_stats_rollups`.pipe(
          Effect.map((rows) => asCount(rows[0]?.count)),
        );
    }
  };

  const clearLocalData: ObservabilityStoreShape["clearLocalData"] = () =>
    Effect.gen(function* () {
      const deletedLogs = yield* countRows("observability_logs");
      const deletedSpans = yield* countRows("observability_spans");
      const deletedRollups = yield* countRows("observability_stats_rollups");
      yield* sql`DELETE FROM observability_logs`;
      yield* sql`DELETE FROM observability_spans`;
      yield* sql`DELETE FROM observability_stats_rollups`;
      return yield* Schema.decodeUnknownEffect(ObservabilityClearLocalDataResult)({
        deletedLogs,
        deletedSpans,
        deletedRollups,
      }).pipe(
        Effect.mapError(toPersistenceDecodeError("ObservabilityStore.clearLocalData:decode")),
      );
    }).pipe(Effect.mapError(toPersistenceSqlError("ObservabilityStore.clearLocalData:query")));

  return {
    insertLog,
    insertSpan,
    incrementRollup,
    getOverview,
    queryLogs,
    querySpans,
    getThreadStats,
    getProviderStats,
    clearLocalData,
  } satisfies ObservabilityStoreShape;
});

export const ObservabilityStoreLive = Layer.effect(ObservabilityStore, makeObservabilityStore);
