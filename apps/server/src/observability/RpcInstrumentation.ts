import { Duration, Effect, Exit, Metric, Option, Stream } from "effect";

import { outcomeFromExit } from "./Attributes.ts";
import { metricAttributes, rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";
import { ObservabilityService } from "./Services/ObservabilityService.ts";

const annotateRpcSpan = (
  method: string,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<void, never, never> =>
  Effect.annotateCurrentSpan({
    "rpc.method": method,
    ...traceAttributes,
  });

const recordRpcStreamMetrics = <E>(
  method: string,
  startedAt: number,
  exit: Exit.Exit<unknown, E>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Metric.update(
      Metric.withAttributes(rpcRequestDuration, metricAttributes({ method })),
      Duration.millis(Math.max(0, Date.now() - startedAt)),
    );
    yield* Metric.update(
      Metric.withAttributes(
        rpcRequestsTotal,
        metricAttributes({
          method,
          outcome: outcomeFromExit(exit),
        }),
      ),
      1,
    );
  });

const recordRpcLocalObservation = <E>(
  method: string,
  startedAt: number,
  exit: Exit.Exit<unknown, E>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) =>
  Effect.gen(function* () {
    const observabilityOption = yield* Effect.serviceOption(ObservabilityService);
    if (Option.isNone(observabilityOption)) return;

    const durationMs = Math.max(0, Date.now() - startedAt);
    const outcome = outcomeFromExit(exit);
    const observedAt = new Date().toISOString();
    const traceId = `rpc-${crypto.randomUUID()}`;
    const spanId = crypto.randomUUID();
    const observability = observabilityOption.value;
    yield* observability.recordSpan({
      recordedAt: observedAt,
      source: "rpc",
      name: `rpc.${method}`,
      kind: "server",
      traceId,
      spanId,
      parentSpanId: null,
      durationMs,
      outcome,
      rpcMethod: method,
      threadId: null,
      turnId: null,
      provider: null,
      model: null,
      attributes: traceAttributes ?? {},
    });
    if (outcome !== "success") {
      yield* observability.recordLog({
        recordedAt: observedAt,
        source: "rpc",
        level: outcome === "failure" ? "error" : "warning",
        message: `${method} ${outcome}`,
        threadId: null,
        turnId: null,
        provider: null,
        model: null,
        traceId,
        spanId,
        outcome,
        eventType: "rpc.completed",
        attributes: traceAttributes ?? {},
      });
    }
  });

export const observeRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* annotateRpcSpan(method, traceAttributes);
    const startedAt = Date.now();

    const observed = effect.pipe(
      Effect.onExit((exit) => recordRpcLocalObservation(method, startedAt, exit, traceAttributes)),
    );

    return yield* observed.pipe(
      withMetrics({
        counter: rpcRequestsTotal,
        timer: rpcRequestDuration,
        attributes: {
          method,
        },
      }),
    );
  });

export const observeRpcStream = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* annotateRpcSpan(method, traceAttributes);
      const startedAt = Date.now();
      return stream.pipe(
        Stream.onExit((exit) =>
          recordRpcStreamMetrics(method, startedAt, exit).pipe(
            Effect.andThen(recordRpcLocalObservation(method, startedAt, exit, traceAttributes)),
          ),
        ),
      );
    }),
  );

export const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
  method: string,
  effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Stream.Stream<A, StreamError | EffectError, StreamContext | EffectContext> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* annotateRpcSpan(method, traceAttributes);
      const startedAt = Date.now();
      const exit = yield* Effect.exit(effect);

      if (Exit.isFailure(exit)) {
        yield* recordRpcStreamMetrics(method, startedAt, exit).pipe(
          Effect.andThen(recordRpcLocalObservation(method, startedAt, exit, traceAttributes)),
        );
        return yield* Effect.failCause(exit.cause);
      }

      return exit.value.pipe(
        Stream.onExit((streamExit) =>
          recordRpcStreamMetrics(method, startedAt, streamExit).pipe(
            Effect.andThen(
              recordRpcLocalObservation(method, startedAt, streamExit, traceAttributes),
            ),
          ),
        ),
      );
    }),
  );
