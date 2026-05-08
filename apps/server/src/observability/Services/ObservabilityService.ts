import type {
  ObservabilityLogQueryInput,
  ObservabilityOverview,
  ObservabilityProviderStatsResult,
  ObservabilityQueryError,
  ObservabilityQueryLogsResult,
  ObservabilityQuerySpansResult,
  ObservabilityClearLocalDataResult,
  ObservabilitySpanQueryInput,
  ObservabilityThreadStats,
  ObservabilityThreadStatsInput,
} from "@wobex/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  ObservabilityLogInsert,
  ObservabilitySpanInsert,
} from "../../persistence/Services/ObservabilityStore.ts";

export type ObservabilityLogInput = Omit<ObservabilityLogInsert, "recordedAt" | "attributes"> &
  Partial<Pick<ObservabilityLogInsert, "recordedAt" | "attributes">>;
export type ObservabilitySpanInput = Omit<ObservabilitySpanInsert, "recordedAt" | "attributes"> &
  Partial<Pick<ObservabilitySpanInsert, "recordedAt" | "attributes">>;

export interface ObservabilityServiceShape {
  readonly recordLog: (input: ObservabilityLogInput) => Effect.Effect<void>;
  readonly recordSpan: (input: ObservabilitySpanInput) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
  readonly getOverview: () => Effect.Effect<ObservabilityOverview>;
  readonly queryLogs: (
    input: ObservabilityLogQueryInput,
  ) => Effect.Effect<ObservabilityQueryLogsResult, ObservabilityQueryError>;
  readonly querySpans: (
    input: ObservabilitySpanQueryInput,
  ) => Effect.Effect<ObservabilityQuerySpansResult, ObservabilityQueryError>;
  readonly getThreadStats: (
    input: ObservabilityThreadStatsInput,
  ) => Effect.Effect<ObservabilityThreadStats, ObservabilityQueryError>;
  readonly getProviderStats: () => Effect.Effect<
    ObservabilityProviderStatsResult,
    ObservabilityQueryError
  >;
  readonly clearLocalData: () => Effect.Effect<
    ObservabilityClearLocalDataResult,
    ObservabilityQueryError
  >;
  readonly recordLogNow: (
    input: ObservabilityLogInput,
  ) => Effect.Effect<void, ObservabilityQueryError>;
  readonly recordSpanNow: (
    input: ObservabilitySpanInput,
  ) => Effect.Effect<void, ObservabilityQueryError>;
}

export class ObservabilityService extends Context.Service<
  ObservabilityService,
  ObservabilityServiceShape
>()("wobex/observability/Services/ObservabilityService") {}

export function compactObservabilityLogInput(input: ObservabilityLogInput): ObservabilityLogInsert {
  return {
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    source: input.source,
    level: input.level,
    message: input.message.length > 2_000 ? `${input.message.slice(0, 1_997)}...` : input.message,
    threadId: input.threadId ?? null,
    turnId: input.turnId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    traceId: input.traceId ?? null,
    spanId: input.spanId ?? null,
    outcome: input.outcome ?? null,
    eventType: input.eventType ?? null,
    attributes: input.attributes ?? {},
  };
}

export function compactObservabilitySpanInput(
  input: ObservabilitySpanInput,
): ObservabilitySpanInsert {
  return {
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    source: input.source,
    name: input.name,
    kind: input.kind,
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId ?? null,
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : 0,
    outcome: input.outcome ?? null,
    rpcMethod: input.rpcMethod ?? null,
    threadId: input.threadId ?? null,
    turnId: input.turnId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    attributes: input.attributes ?? {},
  };
}
