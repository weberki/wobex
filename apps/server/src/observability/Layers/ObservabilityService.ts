import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_EMPTY_OBSERVABILITY_OVERVIEW, ObservabilityQueryError } from "@wobex/contracts";
import { Effect, Layer, Ref } from "effect";

import { ServerConfig } from "../../config.ts";
import { ObservabilityStore } from "../../persistence/Services/ObservabilityStore.ts";
import {
  compactObservabilityLogInput,
  compactObservabilitySpanInput,
  ObservabilityService,
  type ObservabilityLogInput,
  type ObservabilityServiceShape,
  type ObservabilitySpanInput,
} from "../Services/ObservabilityService.ts";

const FLUSH_INTERVAL_MS = 500;
const FLUSH_THRESHOLD = 50;
const MAX_BUFFERED_RECORDS = 2_000;

type BufferedRecord =
  | {
      readonly type: "log";
      readonly record: ReturnType<typeof compactObservabilityLogInput>;
    }
  | {
      readonly type: "span";
      readonly record: ReturnType<typeof compactObservabilitySpanInput>;
    };

function toQueryError(operation: string) {
  return (cause: unknown) =>
    new ObservabilityQueryError({
      operation,
      detail: `Failed to execute ${operation}`,
      cause,
    });
}

async function directorySizeBytes(root: string): Promise<number> {
  let total = 0;
  async function visit(current: string): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(current);
    } catch {
      return;
    }
    if (stat.isFile()) {
      total += stat.size;
      return;
    }
    if (!stat.isDirectory()) {
      return;
    }
    const entries = await fs.readdir(current);
    await Promise.all(entries.map((entry) => visit(path.join(current, entry))));
  }
  await visit(root);
  return total;
}

const statFileSize = (filePath: string) =>
  Effect.promise(async () => {
    try {
      return (await fs.stat(filePath)).size;
    } catch {
      return 0;
    }
  });

const makeObservabilityService = Effect.gen(function* () {
  const store = yield* ObservabilityStore;
  const config = yield* ServerConfig;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedRecord>>([]);

  const drainBuffer: ObservabilityServiceShape["flush"] = Effect.gen(function* () {
    const records = yield* Ref.modify(bufferRef, (current) => [current, []] as const);
    for (const record of records) {
      if (record.type === "log") {
        yield* store
          .insertLog(record.record)
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("failed to persist observability log", { cause }),
            ),
          );
      } else {
        yield* store
          .insertSpan(record.record)
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("failed to persist observability span", { cause }),
            ),
          );
      }
    }
  });

  const enqueue = (record: BufferedRecord) =>
    Ref.modify(bufferRef, (current) => {
      const appended = [...current, record];
      const next =
        appended.length > MAX_BUFFERED_RECORDS
          ? appended.slice(appended.length - MAX_BUFFERED_RECORDS)
          : appended;
      return [next.length, next] as const;
    }).pipe(
      Effect.flatMap((size) =>
        size >= FLUSH_THRESHOLD
          ? drainBuffer.pipe(Effect.ignore({ log: true }), Effect.forkDetach, Effect.asVoid)
          : Effect.void,
      ),
    );

  yield* Effect.sleep(`${FLUSH_INTERVAL_MS} millis`).pipe(
    Effect.andThen(drainBuffer),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => drainBuffer);

  const recordLog: ObservabilityServiceShape["recordLog"] = (input: ObservabilityLogInput) =>
    enqueue({ type: "log", record: compactObservabilityLogInput(input) });

  const recordSpan: ObservabilityServiceShape["recordSpan"] = (input: ObservabilitySpanInput) =>
    enqueue({ type: "span", record: compactObservabilitySpanInput(input) });

  const recordLogNow: ObservabilityServiceShape["recordLogNow"] = (input) =>
    store
      .insertLog(compactObservabilityLogInput(input))
      .pipe(Effect.mapError(toQueryError("observability.recordLogNow")));

  const recordSpanNow: ObservabilityServiceShape["recordSpanNow"] = (input) =>
    store
      .insertSpan(compactObservabilitySpanInput(input))
      .pipe(Effect.mapError(toQueryError("observability.recordSpanNow")));

  const getOverview: ObservabilityServiceShape["getOverview"] = () =>
    drainBuffer.pipe(
      Effect.andThen(store.getOverview()),
      Effect.flatMap((overview) =>
        Effect.all({
          dbSizeBytes: statFileSize(config.dbPath),
          rawLogSizeBytes: Effect.promise(() => directorySizeBytes(config.logsDir)),
        }).pipe(
          Effect.map((sizes) => ({
            ...overview,
            dbSizeBytes: sizes.dbSizeBytes,
            rawLogSizeBytes: sizes.rawLogSizeBytes,
          })),
        ),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("failed to query observability overview", { cause }).pipe(
          Effect.as(DEFAULT_EMPTY_OBSERVABILITY_OVERVIEW),
        ),
      ),
    );

  return {
    recordLog,
    recordSpan,
    flush: drainBuffer,
    getOverview,
    queryLogs: (input) =>
      drainBuffer.pipe(
        Effect.andThen(store.queryLogs(input)),
        Effect.map((records) => ({ records: [...records] })),
        Effect.mapError(toQueryError("observability.queryLogs")),
      ),
    querySpans: (input) =>
      drainBuffer.pipe(
        Effect.andThen(store.querySpans(input)),
        Effect.map((records) => ({ records: [...records] })),
        Effect.mapError(toQueryError("observability.querySpans")),
      ),
    getThreadStats: (input) =>
      drainBuffer.pipe(
        Effect.andThen(store.getThreadStats(input)),
        Effect.mapError(toQueryError("observability.getThreadStats")),
      ),
    getProviderStats: () =>
      drainBuffer.pipe(
        Effect.andThen(store.getProviderStats()),
        Effect.mapError(toQueryError("observability.getProviderStats")),
      ),
    clearLocalData: () =>
      drainBuffer.pipe(
        Effect.andThen(store.clearLocalData()),
        Effect.mapError(toQueryError("observability.clearLocalData")),
      ),
    recordLogNow,
    recordSpanNow,
  } satisfies ObservabilityServiceShape;
});

export const ObservabilityServiceLive = Layer.effect(
  ObservabilityService,
  makeObservabilityService,
);
