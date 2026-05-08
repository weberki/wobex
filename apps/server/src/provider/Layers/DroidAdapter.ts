import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@wobex/contracts";
import { RuntimeItemId, TurnId as TurnIdSchema } from "@wobex/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { nowIso, runtimeEventBase } from "../runtimeEventFactory";
import { DroidAdapter, type DroidAdapterShape } from "../Services/DroidAdapter.ts";
import type {
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import { ServerSettingsService } from "../../serverSettings";

const PROVIDER = "droid" as const;

export interface DroidSpawnHandle {
  readonly child: ChildProcessWithoutNullStreams;
  kill(signal?: NodeJS.Signals): void;
}

export interface DroidAdapterLiveOptions {
  readonly spawnProcess?: (input: {
    readonly binaryPath: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string;
  }) => DroidSpawnHandle;
}

interface DroidTurnDraft {
  readonly id: TurnId;
  readonly userInput: string;
  assistantText: string;
  finalized: boolean;
}

interface DroidThreadState {
  session: ProviderSession;
  providerSessionId: string | undefined;
  snapshot: ProviderThreadSnapshot;
  turnDrafts: Map<string, DroidTurnDraft>;
  activeTurnId: TurnId | undefined;
  activeProcess: DroidSpawnHandle | undefined;
  interruptedTurnIds: Set<string>;
}

function defaultSpawnProcess(input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
}): DroidSpawnHandle {
  const child = spawn(input.binaryPath, [...input.args], {
    cwd: input.cwd,
    stdio: "pipe",
    shell: process.platform === "win32",
    env: process.env,
  });
  return {
    child,
    kill(signal?: NodeJS.Signals) {
      if (!child.killed) {
        child.kill(signal);
      }
    },
  };
}

function createSnapshot(threadId: ThreadId): ProviderThreadSnapshot {
  return {
    threadId,
    turns: [],
  };
}

function finalizeTurnSnapshot(state: DroidThreadState, turnId: TurnId): void {
  const draft = state.turnDrafts.get(String(turnId));
  if (!draft || draft.finalized) {
    return;
  }
  draft.finalized = true;
  const turn: ProviderThreadTurnSnapshot = {
    id: turnId,
    items: [
      {
        type: "userMessage",
        content: [{ type: "text", text: draft.userInput }],
      },
      ...(draft.assistantText.length > 0
        ? [{ type: "assistantMessage", text: draft.assistantText }]
        : []),
    ],
  };
  state.snapshot = {
    threadId: state.snapshot.threadId,
    turns: [...state.snapshot.turns.filter((entry) => entry.id !== turnId), turn],
  };
}

function validateStartProvider(
  input: ProviderSessionStartInput,
): Effect.Effect<void, ProviderAdapterValidationError> {
  if (input.provider === undefined || input.provider === PROVIDER) {
    return Effect.void;
  }
  return Effect.fail(
    new ProviderAdapterValidationError({
      provider: PROVIDER,
      operation: "startSession",
      issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
    }),
  );
}

function validateTurnInput(
  input: ProviderSendTurnInput,
): Effect.Effect<void, ProviderAdapterValidationError> {
  if (input.attachments && input.attachments.length > 0) {
    return Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "Droid attachment forwarding is not supported in v1.",
      }),
    );
  }
  return Effect.void;
}

function toAutoArgs(runtimeMode: ProviderSession["runtimeMode"]): ReadonlyArray<string> {
  switch (runtimeMode) {
    case "auto-accept-edits":
      return ["--auto", "low"];
    case "full-access":
      return ["--auto", "medium"];
    default:
      return [];
  }
}

function missingSession(threadId: ThreadId) {
  return new ProviderAdapterSessionNotFoundError({
    provider: PROVIDER,
    threadId,
  });
}

async function writePromptFile(promptText: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wobex-droid-"));
  const promptPath = path.join(tempDir, "prompt.txt");
  await fs.writeFile(promptPath, promptText, "utf8");
  return promptPath;
}

async function removePromptFile(promptPath: string): Promise<void> {
  await fs.rm(path.dirname(promptPath), { recursive: true, force: true });
}

const makeDroidAdapter = Effect.fn("makeDroidAdapter")(function* (
  options?: DroidAdapterLiveOptions,
) {
  const spawnProcess = options?.spawnProcess ?? defaultSpawnProcess;
  const serverSettings = yield* ServerSettingsService;
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const threadStates = new Map<ThreadId, DroidThreadState>();

  const emit = (event: ProviderRuntimeEvent): void => {
    Effect.runSync(Queue.offer(runtimeEventQueue, event));
  };

  const getSettings = () =>
    Effect.runPromise(
      serverSettings.getSettings.pipe(Effect.map((settings) => settings.providers.droid)),
    );

  const startSession: DroidAdapterShape["startSession"] = (input) =>
    Effect.gen(function* () {
      yield* validateStartProvider(input);
      const existing = threadStates.get(input.threadId);
      if (existing) {
        return existing.session;
      }

      const resumeCursor =
        input.resumeCursor &&
        typeof input.resumeCursor === "object" &&
        !Array.isArray(input.resumeCursor)
          ? input.resumeCursor
          : null;
      const providerSessionId =
        resumeCursor && "sessionId" in resumeCursor && typeof resumeCursor.sessionId === "string"
          ? resumeCursor.sessionId
          : undefined;
      const createdAt = nowIso();
      const session: ProviderSession = {
        provider: PROVIDER,
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.provider === PROVIDER
          ? { model: input.modelSelection.model }
          : {}),
        threadId: input.threadId,
        ...(providerSessionId ? { resumeCursor: { sessionId: providerSessionId } } : {}),
        createdAt,
        updatedAt: createdAt,
      };

      threadStates.set(input.threadId, {
        session,
        providerSessionId,
        snapshot: createSnapshot(input.threadId),
        turnDrafts: new Map(),
        activeTurnId: undefined,
        activeProcess: undefined,
        interruptedTurnIds: new Set(),
      });

      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId: input.threadId,
        }),
        type: "session.started",
        payload: providerSessionId ? { resume: { sessionId: providerSessionId } } : {},
      });
      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId: input.threadId,
        }),
        type: "thread.started",
        payload: providerSessionId ? { providerThreadId: providerSessionId } : {},
      });

      return session;
    });

  const sendTurn: DroidAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      yield* validateTurnInput(input);
      const state = threadStates.get(input.threadId);
      if (!state) {
        return yield* missingSession(input.threadId);
      }
      if (state.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Thread '${input.threadId}' already has a running Droid turn.`,
        });
      }

      const settings = yield* Effect.tryPromise(() => getSettings()).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );
      const turnId = TurnIdSchema.make(`droid-turn-${crypto.randomUUID()}`);
      const assistantItemId = RuntimeItemId.make(`${String(turnId)}:assistant`);
      const promptText = input.input ?? "";
      const promptPath = yield* Effect.tryPromise(() => writePromptFile(promptText)).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );

      const handle = yield* Effect.try({
        try: () =>
          spawnProcess({
            binaryPath: settings.binaryPath,
            args: [
              "exec",
              "-f",
              promptPath,
              "--output-format",
              "stream-json",
              ...(state.session.cwd ? ["--cwd", state.session.cwd] : []),
              ...(state.providerSessionId ? ["--session-id", state.providerSessionId] : []),
              ...(input.modelSelection?.provider === PROVIDER
                ? ["--model", input.modelSelection.model]
                : []),
              ...toAutoArgs(state.session.runtimeMode),
            ],
            ...(state.session.cwd ? { cwd: state.session.cwd } : {}),
          }),
        catch: (error) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: error instanceof Error ? error.message : String(error),
            cause: error,
          }),
      });

      state.turnDrafts.set(String(turnId), {
        id: turnId,
        userInput: promptText,
        assistantText: "",
        finalized: false,
      });
      state.activeTurnId = turnId;
      state.activeProcess = handle;

      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          itemId: assistantItemId,
        }),
        type: "turn.started",
        payload:
          input.modelSelection?.provider === PROVIDER ? { model: input.modelSelection.model } : {},
      });

      const turnStartResult: ProviderTurnStartResult & { resumeCursor?: { sessionId: string } } = {
        threadId: input.threadId,
        turnId,
        ...(state.providerSessionId
          ? { resumeCursor: { sessionId: state.providerSessionId } }
          : {}),
      };

      const lines = createInterface({ input: handle.child.stdout });
      const stderrChunks: string[] = [];
      let completed = false;

      const completeTurn = (
        payload: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>["payload"],
      ) => {
        if (completed) {
          return;
        }
        completed = true;
        finalizeTurnSnapshot(state, turnId);
        state.activeTurnId = undefined;
        state.activeProcess = undefined;
        emit({
          ...runtimeEventBase({
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
          }),
          type: "turn.completed",
          payload,
        });
        void removePromptFile(promptPath);
      };

      handle.child.stderr.on("data", (chunk) => {
        stderrChunks.push(chunk.toString());
      });

      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (
            typeof event.session_id === "string" &&
            state.providerSessionId !== event.session_id
          ) {
            state.providerSessionId = event.session_id;
            state.session = {
              ...state.session,
              resumeCursor: { sessionId: event.session_id },
              updatedAt: nowIso(),
            };
            turnStartResult.resumeCursor = { sessionId: event.session_id };
          }

          switch (typeof event.type === "string" ? event.type : "") {
            case "assistant":
            case "message": {
              const delta =
                typeof event.delta === "string"
                  ? event.delta
                  : typeof event.text === "string"
                    ? event.text
                    : "";
              const draft = state.turnDrafts.get(String(turnId));
              if (draft) {
                draft.assistantText += delta;
              }
              emit({
                ...runtimeEventBase({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  itemId: assistantItemId,
                }),
                type: "content.delta",
                payload: {
                  streamKind: "assistant_text",
                  delta,
                },
              });
              break;
            }
            case "tool_call":
              emit({
                ...runtimeEventBase({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  itemId: RuntimeItemId.make(
                    typeof event.tool_use_id === "string"
                      ? event.tool_use_id
                      : `${String(turnId)}:tool:${crypto.randomUUID()}`,
                  ),
                }),
                type: "item.started",
                payload: {
                  itemType: "dynamic_tool_call",
                  status: "inProgress",
                  ...(typeof event.tool_name === "string" ? { title: event.tool_name } : {}),
                },
              });
              break;
            case "tool_result":
              emit({
                ...runtimeEventBase({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  itemId: RuntimeItemId.make(
                    typeof event.tool_use_id === "string"
                      ? event.tool_use_id
                      : `${String(turnId)}:tool:${crypto.randomUUID()}`,
                  ),
                }),
                type: "item.completed",
                payload: {
                  itemType: "dynamic_tool_call",
                  status: "completed",
                  ...(typeof event.tool_name === "string" ? { title: event.tool_name } : {}),
                },
              });
              break;
            case "completion":
              completeTurn({
                state: "completed",
                ...(typeof event.stop_reason === "string" ? { stopReason: event.stop_reason } : {}),
              });
              break;
            case "error":
              emit({
                ...runtimeEventBase({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                }),
                type: "runtime.error",
                payload: {
                  message:
                    typeof event.message === "string"
                      ? event.message
                      : "Droid subprocess reported an error.",
                  class: "provider_error",
                  detail: event,
                },
              });
              break;
            default:
              break;
          }
        } catch (error) {
          emit({
            ...runtimeEventBase({
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
            }),
            type: "runtime.error",
            payload: {
              message:
                error instanceof Error ? error.message : "Failed to parse Droid stream-json line.",
              class: "transport_error",
            },
          });
        }
      });

      handle.child.once("error", (error) => {
        emit({
          ...runtimeEventBase({
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
          }),
          type: "runtime.error",
          payload: {
            message: error.message,
            class: "transport_error",
          },
        });
        completeTurn({
          state: "failed",
          errorMessage: error.message,
        });
      });

      handle.child.once("exit", (code, signal) => {
        if (state.interruptedTurnIds.has(String(turnId))) {
          state.interruptedTurnIds.delete(String(turnId));
          completeTurn({
            state: "interrupted",
            stopReason: "interrupted",
          });
          return;
        }
        if (code === 0) {
          completeTurn({
            state: "completed",
          });
          return;
        }
        const stderr = stderrChunks.join("").trim();
        emit({
          ...runtimeEventBase({
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
          }),
          type: "runtime.error",
          payload: {
            message:
              stderr.length > 0
                ? stderr
                : `Droid subprocess exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`,
            class: "provider_error",
          },
        });
        completeTurn({
          state: "failed",
          errorMessage:
            stderr.length > 0
              ? stderr
              : `Droid subprocess exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`,
        });
      });

      return turnStartResult;
    });

  const interruptTurn: DroidAdapterShape["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const state = threadStates.get(threadId);
      if (!state) {
        return yield* missingSession(threadId);
      }
      const activeTurnId = turnId ?? state.activeTurnId;
      if (!activeTurnId || !state.activeProcess) {
        return;
      }
      state.interruptedTurnIds.add(String(activeTurnId));
      state.activeProcess.kill("SIGTERM");
      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId,
          turnId: activeTurnId,
        }),
        type: "turn.aborted",
        payload: {
          reason: "Interrupted by user.",
        },
      });
    });

  const stopSession: DroidAdapterShape["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const state = threadStates.get(threadId);
      if (!state) {
        return;
      }
      if (state.activeTurnId && state.activeProcess) {
        yield* interruptTurn(threadId, state.activeTurnId);
      }
      threadStates.delete(threadId);
    });

  const listSessions: DroidAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(threadStates.values(), (state) => state.session));

  const hasSession: DroidAdapterShape["hasSession"] = (threadId) =>
    Effect.succeed(threadStates.has(threadId));

  const readThread: DroidAdapterShape["readThread"] = (threadId) => {
    const state = threadStates.get(threadId);
    return state ? Effect.succeed(state.snapshot) : Effect.fail(missingSession(threadId));
  };

  const rollbackThread: DroidAdapterShape["rollbackThread"] = (_threadId) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "rollbackThread",
        issue: `Rollback is not supported for '${PROVIDER}' in v1.`,
      }),
    );

  const unsupportedOperation = (operation: string) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation,
        issue: `Droid ${operation} is not supported in v1.`,
      }),
    );

  const stopAll: DroidAdapterShape["stopAll"] = () =>
    Effect.gen(function* () {
      for (const threadId of threadStates.keys()) {
        yield* stopSession(threadId);
      }
    });

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "restart-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: () => unsupportedOperation("respondToRequest"),
    respondToUserInput: () => unsupportedOperation("respondToUserInput"),
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies DroidAdapterShape;
});

export const DroidAdapterLive = Layer.effect(DroidAdapter, makeDroidAdapter());

export function makeDroidAdapterLive(options?: DroidAdapterLiveOptions) {
  return Layer.effect(DroidAdapter, makeDroidAdapter(options));
}
