import type {
  ObservabilityClearLocalDataResult,
  ObservabilityLogQueryInput,
  ObservabilityLogRecord,
  ObservabilityOverview,
  ObservabilityProviderStatsResult,
  ObservabilitySpanQueryInput,
  ObservabilitySpanRecord,
  ObservabilityThreadStats,
  ObservabilityThreadStatsInput,
} from "@wobex/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export type ObservabilityLogInsert = Omit<ObservabilityLogRecord, "id">;
export type ObservabilitySpanInsert = Omit<ObservabilitySpanRecord, "id">;

export interface ObservabilityRollupIncrement {
  readonly bucketStart: string;
  readonly bucketSizeSeconds: number;
  readonly metric: string;
  readonly dimensions: Readonly<Record<string, unknown>>;
  readonly value: number;
  readonly updatedAt: string;
}

export interface ObservabilityStoreShape {
  readonly insertLog: (
    record: ObservabilityLogInsert,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly insertSpan: (
    record: ObservabilitySpanInsert,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly incrementRollup: (
    input: ObservabilityRollupIncrement,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getOverview: () => Effect.Effect<ObservabilityOverview, ProjectionRepositoryError>;
  readonly queryLogs: (
    input: ObservabilityLogQueryInput,
  ) => Effect.Effect<ReadonlyArray<ObservabilityLogRecord>, ProjectionRepositoryError>;
  readonly querySpans: (
    input: ObservabilitySpanQueryInput,
  ) => Effect.Effect<ReadonlyArray<ObservabilitySpanRecord>, ProjectionRepositoryError>;
  readonly getThreadStats: (
    input: ObservabilityThreadStatsInput,
  ) => Effect.Effect<ObservabilityThreadStats, ProjectionRepositoryError>;
  readonly getProviderStats: () => Effect.Effect<
    ObservabilityProviderStatsResult,
    ProjectionRepositoryError
  >;
  readonly clearLocalData: () => Effect.Effect<
    ObservabilityClearLocalDataResult,
    ProjectionRepositoryError
  >;
}

export class ObservabilityStore extends Context.Service<
  ObservabilityStore,
  ObservabilityStoreShape
>()("wobex/persistence/Services/ObservabilityStore") {}
