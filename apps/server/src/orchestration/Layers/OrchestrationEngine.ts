import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from "@wobex/contracts";
import { OrchestrationCommand } from "@wobex/contracts";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Metric,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  metricAttributes,
  orchestrationCommandAckDuration,
  orchestrationCommandsTotal,
  orchestrationCommandDuration,
} from "../../observability/Metrics.ts";
import { ObservabilityService } from "../../observability/Services/ObservabilityService.ts";
import { isPersistenceError, toPersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  OrchestrationCommandInternalError,
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationCommandTimeoutError,
  type OrchestrationDispatchError,
} from "../Errors.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";

interface CommandEnvelope {
  command: OrchestrationCommand;
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>;
  executionState: Ref.Ref<CommandExecutionState>;
  startedAtMs: number;
  deadlineAtMs: number;
}

const ORCHESTRATION_DISPATCH_TIMEOUT_MS = 45_000;
type CommandExecutionState = "queued" | "in-flight" | "abandoned";
type DispatchTimeoutDecision = { kind: "abandon" } | { kind: "wait" };

function commandToAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: ProjectId | ThreadId;
} {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return {
        aggregateKind: "project",
        aggregateId: command.projectId,
      };
    default:
      return {
        aggregateKind: "thread",
        aggregateId: command.threadId,
      };
  }
}

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const observabilityOption = yield* Effect.serviceOption(ObservabilityService);

  let readModel = createEmptyReadModel(new Date().toISOString());

  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>();

  const makeCommandTimeoutError = (command: OrchestrationCommand) =>
    new OrchestrationCommandTimeoutError({
      commandId: command.commandId,
      commandType: command.type,
      timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
    });

  const makeCommandInternalError = (
    command: OrchestrationCommand,
    detail = "The orchestration worker crashed before the command could finish.",
  ) =>
    new OrchestrationCommandInternalError({
      commandId: command.commandId,
      commandType: command.type,
      detail,
    });

  const resolveStoredCommandOutcome = (
    command: OrchestrationCommand,
  ): Effect.Effect<{ sequence: number }, OrchestrationDispatchError> =>
    Effect.gen(function* () {
      const existingReceipt = yield* commandReceiptRepository
        .getByCommandId({
          commandId: command.commandId,
        })
        .pipe(Effect.catch(() => Effect.succeed(Option.none())));
      if (Option.isNone(existingReceipt)) {
        return yield* makeCommandTimeoutError(command);
      }
      if (existingReceipt.value.status === "accepted") {
        return {
          sequence: existingReceipt.value.resultSequence,
        };
      }
      return yield* new OrchestrationCommandPreviouslyRejectedError({
        commandId: command.commandId,
        detail: existingReceipt.value.error ?? "Previously rejected.",
      });
    });

  const processEnvelope = (envelope: CommandEnvelope): Effect.Effect<void> => {
    const dispatchStartSequence = readModel.snapshotSequence;
    const processingStartedAtMs = Date.now();
    const remainingBudgetMs = Math.max(0, envelope.deadlineAtMs - Date.now());
    const aggregateRef = commandToAggregateRef(envelope.command);
    const baseMetricAttributes = {
      commandType: envelope.command.type,
      aggregateKind: aggregateRef.aggregateKind,
    } as const;
    const reconcileReadModelAfterDispatchFailure = Effect.gen(function* () {
      const persistedEvents = yield* Stream.runCollect(
        eventStore.readFromSequence(dispatchStartSequence),
      ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)));
      if (persistedEvents.length === 0) {
        return;
      }

      let nextReadModel = readModel;
      for (const persistedEvent of persistedEvents) {
        nextReadModel = yield* projectEvent(nextReadModel, persistedEvent);
      }
      readModel = nextReadModel;

      for (const persistedEvent of persistedEvents) {
        yield* PubSub.publish(eventPubSub, persistedEvent);
      }
    });

    const dispatchEffect = Effect.gen(function* () {
      const shouldSkip = yield* Ref.modify(envelope.executionState, (state) => {
        if (state === "abandoned") {
          return [true, state] as const;
        }
        return [false, "in-flight"] as const;
      });
      if (shouldSkip) {
        return yield* makeCommandTimeoutError(envelope.command);
      }
      if (remainingBudgetMs === 0) {
        return yield* makeCommandTimeoutError(envelope.command);
      }

      yield* Effect.annotateCurrentSpan({
        "orchestration.command_id": envelope.command.commandId,
        "orchestration.command_type": envelope.command.type,
        "orchestration.aggregate_kind": aggregateRef.aggregateKind,
        "orchestration.aggregate_id": aggregateRef.aggregateId,
      });

      const existingReceipt = yield* commandReceiptRepository.getByCommandId({
        commandId: envelope.command.commandId,
      });
      if (Option.isSome(existingReceipt)) {
        if (existingReceipt.value.status === "accepted") {
          return {
            sequence: existingReceipt.value.resultSequence,
          };
        }
        return yield* new OrchestrationCommandPreviouslyRejectedError({
          commandId: envelope.command.commandId,
          detail: existingReceipt.value.error ?? "Previously rejected.",
        });
      }

      const eventBase = yield* decideOrchestrationCommand({
        command: envelope.command,
        readModel,
      });
      const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];
      const committedCommand = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const committedEvents: OrchestrationEvent[] = [];
            let nextReadModel = readModel;

            for (const nextEvent of eventBases) {
              const savedEvent = yield* eventStore.append(nextEvent);
              nextReadModel = yield* projectEvent(nextReadModel, savedEvent);
              yield* projectionPipeline.projectEvent(savedEvent);
              committedEvents.push(savedEvent);
            }

            const lastSavedEvent = committedEvents.at(-1) ?? null;
            if (lastSavedEvent === null) {
              return yield* new OrchestrationCommandInvariantError({
                commandType: envelope.command.type,
                detail: "Command produced no events.",
              });
            }

            yield* commandReceiptRepository.upsert({
              commandId: envelope.command.commandId,
              aggregateKind: lastSavedEvent.aggregateKind,
              aggregateId: lastSavedEvent.aggregateId,
              acceptedAt: lastSavedEvent.occurredAt,
              resultSequence: lastSavedEvent.sequence,
              status: "accepted",
              error: null,
            });

            return {
              committedEvents,
              lastSequence: lastSavedEvent.sequence,
              nextReadModel,
            } as const;
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.fail(
              toPersistenceSqlError("OrchestrationEngine.processEnvelope:transaction")(sqlError),
            ),
          ),
        );

      readModel = committedCommand.nextReadModel;
      for (const [index, event] of committedCommand.committedEvents.entries()) {
        yield* PubSub.publish(eventPubSub, event);
        if (index === 0) {
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandAckDuration,
              metricAttributes({
                ...baseMetricAttributes,
                ackEventType: event.type,
              }),
            ),
            Duration.millis(Math.max(0, Date.now() - envelope.startedAtMs)),
          );
        }
      }
      return { sequence: committedCommand.lastSequence };
    }).pipe(
      Effect.timeoutOption(Duration.millis(remainingBudgetMs)),
      Effect.flatMap((outcome) =>
        Option.match(outcome, {
          onNone: () => Effect.fail(makeCommandTimeoutError(envelope.command)),
          onSome: Effect.succeed,
        }),
      ),
      Effect.catchCause(
        (cause): Effect.Effect<{ sequence: number }, OrchestrationDispatchError> => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.interrupt;
          }
          const squashed = Cause.squash(cause);
          if (
            Schema.is(OrchestrationCommandInvariantError)(squashed) ||
            Schema.is(OrchestrationCommandPreviouslyRejectedError)(squashed) ||
            Schema.is(OrchestrationCommandTimeoutError)(squashed) ||
            isPersistenceError(squashed)
          ) {
            return Effect.fail(squashed);
          }
          return Effect.logError("orchestration command crashed while processing").pipe(
            Effect.annotateLogs({
              commandId: envelope.command.commandId,
              commandType: envelope.command.type,
              cause: Cause.pretty(cause),
            }),
            Effect.flatMap(() => Effect.fail(makeCommandInternalError(envelope.command))),
          );
        },
      ),
      Effect.withSpan(`orchestration.command.${envelope.command.type}`),
    );

    return Effect.exit(dispatchEffect).pipe(
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          const outcome = Exit.isSuccess(exit)
            ? "success"
            : Cause.hasInterruptsOnly(exit.cause)
              ? "interrupt"
              : "failure";
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandDuration,
              metricAttributes(baseMetricAttributes),
            ),
            Duration.millis(Math.max(0, Date.now() - processingStartedAtMs)),
          );
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandsTotal,
              metricAttributes({
                ...baseMetricAttributes,
                outcome,
              }),
            ),
            1,
          );
          if (Option.isSome(observabilityOption)) {
            yield* observabilityOption.value.recordLog({
              recordedAt: new Date().toISOString(),
              source: "orchestration",
              level: outcome === "failure" ? "error" : outcome === "interrupt" ? "warning" : "info",
              message: `${envelope.command.type} ${outcome}`,
              threadId:
                aggregateRef.aggregateKind === "thread"
                  ? (aggregateRef.aggregateId as ThreadId)
                  : null,
              turnId: null,
              provider: null,
              model: null,
              traceId: null,
              spanId: null,
              outcome,
              eventType: envelope.command.type,
              attributes: {
                commandId: envelope.command.commandId,
                aggregateKind: aggregateRef.aggregateKind,
              },
            });
          }

          if (Exit.isSuccess(exit)) {
            yield* Deferred.succeed(envelope.result, exit.value);
            return;
          }

          let error = Cause.squash(exit.cause) as OrchestrationDispatchError;
          if (!Schema.is(OrchestrationCommandPreviouslyRejectedError)(error)) {
            yield* reconcileReadModelAfterDispatchFailure.pipe(
              Effect.catch(() =>
                Effect.logWarning(
                  "failed to reconcile orchestration read model after dispatch failure",
                ).pipe(
                  Effect.annotateLogs({
                    commandId: envelope.command.commandId,
                    snapshotSequence: readModel.snapshotSequence,
                  }),
                ),
              ),
            );

            if (Schema.is(OrchestrationCommandTimeoutError)(error)) {
              const resolvedTimeoutOutcome = yield* Effect.exit(
                resolveStoredCommandOutcome(envelope.command),
              );
              if (Exit.isSuccess(resolvedTimeoutOutcome)) {
                yield* Deferred.succeed(envelope.result, resolvedTimeoutOutcome.value);
                return;
              }
              error = Cause.squash(resolvedTimeoutOutcome.cause) as OrchestrationDispatchError;
            }

            if (Schema.is(OrchestrationCommandInvariantError)(error)) {
              yield* commandReceiptRepository
                .upsert({
                  commandId: envelope.command.commandId,
                  aggregateKind: aggregateRef.aggregateKind,
                  aggregateId: aggregateRef.aggregateId,
                  acceptedAt: new Date().toISOString(),
                  resultSequence: readModel.snapshotSequence,
                  status: "rejected",
                  error: error.message,
                })
                .pipe(Effect.catch(() => Effect.void));
            }
          }

          yield* Deferred.fail(envelope.result, error);
        }),
      ),
    );
  };

  yield* projectionPipeline.bootstrap;
  readModel = yield* projectionSnapshotQuery.getSnapshot();

  const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
  yield* Effect.forkScoped(worker);
  yield* Effect.logDebug("orchestration engine started").pipe(
    Effect.annotateLogs({ sequence: readModel.snapshotSequence }),
  );

  const getReadModel: OrchestrationEngineShape["getReadModel"] = () =>
    Effect.sync((): OrchestrationReadModel => readModel);

  const readEvents: OrchestrationEngineShape["readEvents"] = (fromSequenceExclusive) =>
    eventStore.readFromSequence(fromSequenceExclusive);

  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ sequence: number }, OrchestrationDispatchError>();
      const executionState = yield* Ref.make<CommandExecutionState>("queued");
      const startedAtMs = Date.now();
      yield* Queue.offer(commandQueue, {
        command,
        result,
        executionState,
        startedAtMs,
        deadlineAtMs: startedAtMs + ORCHESTRATION_DISPATCH_TIMEOUT_MS,
      });
      return yield* Deferred.await(result).pipe(
        Effect.timeoutOption(Duration.millis(ORCHESTRATION_DISPATCH_TIMEOUT_MS)),
        Effect.flatMap((outcome) =>
          Option.match(outcome, {
            onSome: Effect.succeed,
            onNone: () =>
              Ref.modify(
                executionState,
                (state): readonly [DispatchTimeoutDecision, CommandExecutionState] =>
                  state === "queued"
                    ? [{ kind: "abandon" }, "abandoned"]
                    : [{ kind: "wait" }, state],
              ).pipe(
                Effect.flatMap((decision) =>
                  decision.kind === "wait"
                    ? Effect.logWarning(
                        "orchestration dispatch exceeded timeout while command was already in flight",
                      ).pipe(
                        Effect.annotateLogs({
                          commandId: command.commandId,
                          commandType: command.type,
                          timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
                        }),
                        Effect.flatMap(() => Deferred.await(result)),
                      )
                    : Effect.logWarning(
                        "orchestration dispatch timed out before command started",
                      ).pipe(
                        Effect.annotateLogs({
                          commandId: command.commandId,
                          commandType: command.type,
                          timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
                        }),
                        Effect.flatMap(() => Effect.fail(makeCommandTimeoutError(command))),
                      ),
                ),
              ),
          }),
        ),
      );
    });

  return {
    getReadModel,
    readEvents,
    dispatch,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (wsServer, ProviderRuntimeIngestion, CheckpointReactor, etc.)
    // each independently receive all domain events.
    get streamDomainEvents(): OrchestrationEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
  } satisfies OrchestrationEngineShape;
});

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
);
