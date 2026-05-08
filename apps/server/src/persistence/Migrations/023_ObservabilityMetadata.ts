import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS observability_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      source TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      thread_id TEXT,
      turn_id TEXT,
      provider TEXT,
      model TEXT,
      trace_id TEXT,
      span_id TEXT,
      outcome TEXT,
      event_type TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}'
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_logs_recorded_at
    ON observability_logs(recorded_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_logs_source_level
    ON observability_logs(source, level, recorded_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_logs_thread
    ON observability_logs(thread_id, recorded_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_logs_provider
    ON observability_logs(provider, model, recorded_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS observability_spans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      duration_ms REAL NOT NULL,
      outcome TEXT,
      rpc_method TEXT,
      thread_id TEXT,
      turn_id TEXT,
      provider TEXT,
      model TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}'
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_spans_recorded_at
    ON observability_spans(recorded_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_spans_rpc
    ON observability_spans(rpc_method, duration_ms DESC, recorded_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_spans_trace
    ON observability_spans(trace_id, span_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS observability_stats_rollups (
      bucket_start TEXT NOT NULL,
      bucket_size_seconds INTEGER NOT NULL,
      metric TEXT NOT NULL,
      dimensions_json TEXT NOT NULL DEFAULT '{}',
      value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (bucket_start, bucket_size_seconds, metric, dimensions_json)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_observability_stats_rollups_metric
    ON observability_stats_rollups(metric, bucket_start DESC)
  `;
});
