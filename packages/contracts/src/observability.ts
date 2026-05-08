import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const ObservabilityLogSource = Schema.Literals([
  "analytics",
  "browser",
  "git",
  "orchestration",
  "provider",
  "rpc",
  "server",
  "terminal",
]);
export type ObservabilityLogSource = typeof ObservabilityLogSource.Type;

export const ObservabilityLogLevel = Schema.Literals(["debug", "info", "warning", "error"]);
export type ObservabilityLogLevel = typeof ObservabilityLogLevel.Type;

export const ObservabilityOutcome = Schema.Literals(["success", "failure", "interrupt", "unknown"]);
export type ObservabilityOutcome = typeof ObservabilityOutcome.Type;

const NullableString = Schema.NullOr(Schema.String);
const NullableNonEmptyString = Schema.NullOr(TrimmedNonEmptyString);
const NullableProviderKind = Schema.NullOr(ProviderKind);
const UnknownJsonRecord = Schema.Record(Schema.String, Schema.Unknown);

export const ObservabilityLogRecord = Schema.Struct({
  id: NonNegativeInt,
  recordedAt: IsoDateTime,
  source: ObservabilityLogSource,
  level: ObservabilityLogLevel,
  message: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  provider: NullableProviderKind,
  model: NullableString,
  traceId: NullableNonEmptyString,
  spanId: NullableNonEmptyString,
  outcome: Schema.NullOr(ObservabilityOutcome),
  eventType: NullableNonEmptyString,
  attributes: UnknownJsonRecord,
});
export type ObservabilityLogRecord = typeof ObservabilityLogRecord.Type;

export const ObservabilitySpanRecord = Schema.Struct({
  id: NonNegativeInt,
  recordedAt: IsoDateTime,
  source: ObservabilityLogSource,
  name: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
  parentSpanId: NullableNonEmptyString,
  durationMs: Schema.Number,
  outcome: Schema.NullOr(ObservabilityOutcome),
  rpcMethod: NullableNonEmptyString,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  provider: NullableProviderKind,
  model: NullableString,
  attributes: UnknownJsonRecord,
});
export type ObservabilitySpanRecord = typeof ObservabilitySpanRecord.Type;

export const ObservabilityLogQueryInput = Schema.Struct({
  source: Schema.optionalKey(ObservabilityLogSource),
  level: Schema.optionalKey(ObservabilityLogLevel),
  provider: Schema.optionalKey(ProviderKind),
  threadId: Schema.optionalKey(ThreadId),
  turnId: Schema.optionalKey(TurnId),
  search: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(IsoDateTime),
  until: Schema.optionalKey(IsoDateTime),
  limit: Schema.optionalKey(NonNegativeInt),
});
export type ObservabilityLogQueryInput = typeof ObservabilityLogQueryInput.Type;

export const ObservabilitySpanQueryInput = Schema.Struct({
  source: Schema.optionalKey(ObservabilityLogSource),
  provider: Schema.optionalKey(ProviderKind),
  threadId: Schema.optionalKey(ThreadId),
  turnId: Schema.optionalKey(TurnId),
  rpcMethod: Schema.optionalKey(TrimmedNonEmptyString),
  minDurationMs: Schema.optionalKey(NonNegativeInt),
  since: Schema.optionalKey(IsoDateTime),
  until: Schema.optionalKey(IsoDateTime),
  limit: Schema.optionalKey(NonNegativeInt),
});
export type ObservabilitySpanQueryInput = typeof ObservabilitySpanQueryInput.Type;

export const ObservabilityQueryLogsResult = Schema.Struct({
  records: Schema.Array(ObservabilityLogRecord),
});
export type ObservabilityQueryLogsResult = typeof ObservabilityQueryLogsResult.Type;

export const ObservabilityQuerySpansResult = Schema.Struct({
  records: Schema.Array(ObservabilitySpanRecord),
});
export type ObservabilityQuerySpansResult = typeof ObservabilityQuerySpansResult.Type;

export const ObservabilityOverview = Schema.Struct({
  totalLogs: NonNegativeInt,
  errorLogs: NonNegativeInt,
  warningLogs: NonNegativeInt,
  totalSpans: NonNegativeInt,
  slowRpcSpans: NonNegativeInt,
  providerTurns: NonNegativeInt,
  failedProviderTurns: NonNegativeInt,
  terminalRestarts: NonNegativeInt,
  gitFailures: NonNegativeInt,
  dbSizeBytes: NonNegativeInt,
  rawLogSizeBytes: NonNegativeInt,
});
export type ObservabilityOverview = typeof ObservabilityOverview.Type;

export const ObservabilityThreadStatsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ObservabilityThreadStatsInput = typeof ObservabilityThreadStatsInput.Type;

export const ObservabilityThreadStats = Schema.Struct({
  threadId: ThreadId,
  totalLogs: NonNegativeInt,
  errorLogs: NonNegativeInt,
  providerEvents: NonNegativeInt,
  turns: NonNegativeInt,
  failedTurns: NonNegativeInt,
  latestEventAt: Schema.NullOr(IsoDateTime),
});
export type ObservabilityThreadStats = typeof ObservabilityThreadStats.Type;

export const ObservabilityProviderStat = Schema.Struct({
  provider: ProviderKind,
  model: Schema.NullOr(Schema.String),
  totalLogs: NonNegativeInt,
  turns: NonNegativeInt,
  failures: NonNegativeInt,
  latestEventAt: Schema.NullOr(IsoDateTime),
});
export type ObservabilityProviderStat = typeof ObservabilityProviderStat.Type;

export const ObservabilityProviderStatsResult = Schema.Struct({
  providers: Schema.Array(ObservabilityProviderStat),
});
export type ObservabilityProviderStatsResult = typeof ObservabilityProviderStatsResult.Type;

export const ObservabilityClearLocalDataResult = Schema.Struct({
  deletedLogs: NonNegativeInt,
  deletedSpans: NonNegativeInt,
  deletedRollups: NonNegativeInt,
});
export type ObservabilityClearLocalDataResult = typeof ObservabilityClearLocalDataResult.Type;

export class ObservabilityQueryError extends Schema.TaggedErrorClass<ObservabilityQueryError>()(
  "ObservabilityQueryError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Observability query failed in ${this.operation}: ${this.detail}`;
  }
}

export const ObservabilityRpcSchemas = {
  getOverview: {
    input: Schema.Struct({}),
    output: ObservabilityOverview,
  },
  queryLogs: {
    input: ObservabilityLogQueryInput,
    output: ObservabilityQueryLogsResult,
  },
  querySpans: {
    input: ObservabilitySpanQueryInput,
    output: ObservabilityQuerySpansResult,
  },
  getThreadStats: {
    input: ObservabilityThreadStatsInput,
    output: ObservabilityThreadStats,
  },
  getProviderStats: {
    input: Schema.Struct({}),
    output: ObservabilityProviderStatsResult,
  },
  clearLocalData: {
    input: Schema.Struct({}),
    output: ObservabilityClearLocalDataResult,
  },
} as const;

export const DEFAULT_OBSERVABILITY_LOG_LIMIT = 100;
export const DEFAULT_OBSERVABILITY_SPAN_LIMIT = 100;
export const DEFAULT_EMPTY_OBSERVABILITY_OVERVIEW: ObservabilityOverview = Schema.decodeSync(
  ObservabilityOverview,
)({
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
});
