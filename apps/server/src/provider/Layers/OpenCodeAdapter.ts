import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";

import type {
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from "@wobex/contracts";
import { RuntimeItemId, TurnId as TurnIdSchema } from "@wobex/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { nowIso, runtimeEventBase } from "../runtimeEventFactory";
import { OpenCodeAdapter, type OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import type {
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import { ServerSettingsService } from "../../serverSettings";
import type { OpenCodeSettings } from "@wobex/contracts";

const PROVIDER = "opencode" as const;
const LOCAL_HOST = "127.0.0.1";

export interface ManagedOpenCodeServerHandle {
  readonly child: ChildProcessWithoutNullStreams;
  kill(signal?: NodeJS.Signals): void;
}

export interface OpenCodeAdapterLiveOptions {
  readonly fetchImpl?: typeof fetch;
  readonly spawnManagedServer?: (input: {
    readonly binaryPath: string;
    readonly host: string;
    readonly port: number;
  }) => ManagedOpenCodeServerHandle;
}

interface OpenCodeTurnDraft {
  readonly id: TurnId;
  readonly userInput: string;
  assistantText: string;
  finalized: boolean;
}

interface OpenCodeThreadState {
  session: ProviderSession;
  providerSessionId: string;
  snapshot: ProviderThreadSnapshot;
  turnDrafts: Map<string, OpenCodeTurnDraft>;
  activeTurnId: TurnId | undefined;
  activeAbortController: AbortController | undefined;
  interruptedTurnIds: Set<string>;
  runtimeWarningEmitted: boolean;
}

interface ManagedServerState {
  readonly baseUrl: string;
  readonly handle: ManagedOpenCodeServerHandle;
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function openCodeAuthHeaders(
  settings: Pick<OpenCodeSettings, "serverUsername" | "serverPassword">,
) {
  const username = trimOrUndefined(settings.serverUsername);
  const password = trimOrUndefined(settings.serverPassword);
  if (!username || !password) {
    return {};
  }
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
  };
}

function defaultSpawnManagedServer(input: {
  readonly binaryPath: string;
  readonly host: string;
  readonly port: number;
}): ManagedOpenCodeServerHandle {
  const child = spawn(
    input.binaryPath,
    ["serve", "--hostname", input.host, "--port", String(input.port)],
    {
      stdio: "pipe",
      shell: process.platform === "win32",
      env: process.env,
    },
  );
  return {
    child,
    kill(signal?: NodeJS.Signals) {
      if (!child.killed) {
        child.kill(signal);
      }
    },
  };
}

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOCAL_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate local port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: T | null }> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  return {
    status: response.status,
    body: text.trim().length > 0 ? (JSON.parse(text) as T) : null,
  };
}

async function waitForServer(fetchImpl: typeof fetch, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for OpenCode server health check.");
}

async function consumeSse(input: {
  readonly response: Response;
  readonly signal: AbortSignal;
  readonly onEvent: (event: { type: string; data: string }) => void;
}): Promise<void> {
  const reader = input.response.body?.getReader();
  if (!reader) {
    throw new Error("OpenCode SSE response did not include a body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (!input.signal.aborted) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    buffer += decoder.decode(next.value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawBlock = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let type = "message";
      const dataLines: string[] = [];
      for (const line of rawBlock.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          type = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length > 0) {
        input.onEvent({ type, data: dataLines.join("\n") });
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function createSnapshot(threadId: ThreadId): ProviderThreadSnapshot {
  return {
    threadId,
    turns: [],
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

function validateTurnAttachments(
  input: ProviderSendTurnInput,
): Effect.Effect<void, ProviderAdapterValidationError> {
  if (!input.attachments || input.attachments.length === 0) {
    return Effect.void;
  }
  return Effect.fail(
    new ProviderAdapterValidationError({
      provider: PROVIDER,
      operation: "sendTurn",
      issue: "OpenCode attachment forwarding is not supported in v1.",
    }),
  );
}

function missingSession(threadId: ThreadId) {
  return new ProviderAdapterSessionNotFoundError({
    provider: PROVIDER,
    threadId,
  });
}

function finalizeTurnSnapshot(state: OpenCodeThreadState, turnId: TurnId): void {
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

const makeOpenCodeAdapter = Effect.fn("makeOpenCodeAdapter")(function* (
  options?: OpenCodeAdapterLiveOptions,
) {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const spawnManagedServer = options?.spawnManagedServer ?? defaultSpawnManagedServer;
  const serverSettings = yield* ServerSettingsService;
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const threadStates = new Map<ThreadId, OpenCodeThreadState>();
  let managedServer: ManagedServerState | undefined;
  let startingServer: Promise<ManagedServerState> | undefined;

  const emit = (event: ProviderRuntimeEvent): void => {
    Effect.runSync(Queue.offer(runtimeEventQueue, event));
  };

  const getSettings = () =>
    Effect.runPromise(
      serverSettings.getSettings.pipe(Effect.map((settings) => settings.providers.opencode)),
    );

  const ensureBaseUrl = async (): Promise<string> => {
    const settings = await getSettings();
    const externalUrl = trimOrUndefined(settings.serverUrl);
    if (externalUrl) {
      return externalUrl.replace(/\/+$/, "");
    }
    if (managedServer) {
      return managedServer.baseUrl;
    }
    if (startingServer) {
      return (await startingServer).baseUrl;
    }

    startingServer = (async () => {
      const port = await allocatePort();
      const baseUrl = `http://${LOCAL_HOST}:${port}`;
      const handle = spawnManagedServer({
        binaryPath: settings.binaryPath,
        host: LOCAL_HOST,
        port,
      });
      try {
        await waitForServer(fetchImpl, baseUrl);
      } catch (error) {
        handle.kill("SIGTERM");
        throw error;
      }
      const next = { baseUrl, handle };
      managedServer = next;
      return next;
    })();

    try {
      return (await startingServer).baseUrl;
    } finally {
      startingServer = undefined;
    }
  };

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      if (managedServer) {
        managedServer.handle.kill("SIGTERM");
        managedServer = undefined;
      }
    }),
  );

  const startSession: OpenCodeAdapterShape["startSession"] = (input) =>
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
      const resumedSessionId =
        resumeCursor && "sessionId" in resumeCursor && typeof resumeCursor.sessionId === "string"
          ? resumeCursor.sessionId
          : undefined;
      const baseUrl = yield* Effect.tryPromise(() => ensureBaseUrl()).pipe(
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

      const providerSessionId =
        resumedSessionId ??
        (yield* Effect.tryPromise(async () => {
          const settings = await getSettings();
          const response = await fetchJson<{ sessionId?: string; id?: string }>(
            fetchImpl,
            `${baseUrl}/api/sessions`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                ...openCodeAuthHeaders(settings),
              },
              body: JSON.stringify({
                ...(input.cwd ? { cwd: input.cwd } : {}),
                ...(input.modelSelection?.provider === PROVIDER
                  ? { model: input.modelSelection.model }
                  : {}),
              }),
            },
          );
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`OpenCode session creation failed with status ${response.status}.`);
          }
          const sessionId = response.body?.sessionId ?? response.body?.id;
          if (!sessionId) {
            throw new Error("OpenCode session creation response did not include a session id.");
          }
          return sessionId;
        }).pipe(
          Effect.mapError(
            (error) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "POST /api/sessions",
                detail: error instanceof Error ? error.message : String(error),
                cause: error,
              }),
          ),
        ));

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
        resumeCursor: { sessionId: providerSessionId },
        createdAt,
        updatedAt: createdAt,
      };

      const state: OpenCodeThreadState = {
        session,
        providerSessionId,
        snapshot: createSnapshot(input.threadId),
        turnDrafts: new Map(),
        activeTurnId: undefined,
        activeAbortController: undefined,
        interruptedTurnIds: new Set(),
        runtimeWarningEmitted: false,
      };
      threadStates.set(input.threadId, state);

      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId: input.threadId,
        }),
        type: "session.started",
        payload: {
          resume: { sessionId: providerSessionId },
        },
      });
      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId: input.threadId,
        }),
        type: "thread.started",
        payload: {
          providerThreadId: providerSessionId,
        },
      });
      if (!state.runtimeWarningEmitted) {
        state.runtimeWarningEmitted = true;
        emit({
          ...runtimeEventBase({
            provider: PROVIDER,
            threadId: input.threadId,
          }),
          type: "config.warning",
          payload: {
            summary: "OpenCode uses provider-default runtime controls in v1.",
            details:
              "The selected runtime mode is stored, but OpenCode transport does not yet map each mode to distinct provider controls.",
          },
        });
      }

      return session;
    });

  const sendTurn: OpenCodeAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      yield* validateTurnAttachments(input);
      const state = threadStates.get(input.threadId);
      if (!state) {
        return yield* missingSession(input.threadId);
      }
      if (state.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Thread '${input.threadId}' already has an active OpenCode turn.`,
        });
      }

      const turnId = TurnIdSchema.make(`opencode-turn-${crypto.randomUUID()}`);
      const assistantItemId = RuntimeItemId.make(`${String(turnId)}:assistant`);
      const promptText = input.input ?? "";
      state.turnDrafts.set(String(turnId), {
        id: turnId,
        userInput: promptText,
        assistantText: "",
        finalized: false,
      });
      state.activeTurnId = turnId;
      state.activeAbortController = new AbortController();

      const baseUrl = yield* Effect.tryPromise(() => ensureBaseUrl()).pipe(
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

      yield* Effect.tryPromise(async () => {
        const settings = await getSettings();
        const response = await fetchJson(
          fetchImpl,
          `${baseUrl}/api/sessions/${encodeURIComponent(state.providerSessionId)}/messages`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...openCodeAuthHeaders(settings),
            },
            body: JSON.stringify({
              input: promptText,
              ...(input.modelSelection?.provider === PROVIDER
                ? { model: input.modelSelection.model }
                : {}),
            }),
          },
        );
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`OpenCode message submission failed with status ${response.status}.`);
        }
      }).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "POST /api/sessions/:id/messages",
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );

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

      void (async () => {
        try {
          const settings = await getSettings();
          const response = await fetchImpl(
            `${baseUrl}/api/sessions/${encodeURIComponent(state.providerSessionId)}/events?turnId=${encodeURIComponent(String(turnId))}`,
            {
              headers: {
                Accept: "text/event-stream",
                ...openCodeAuthHeaders(settings),
              },
              signal: state.activeAbortController?.signal ?? null,
            },
          );
          if (!response.ok) {
            throw new Error(`OpenCode event stream failed with status ${response.status}.`);
          }
          await consumeSse({
            response,
            signal: state.activeAbortController?.signal ?? new AbortController().signal,
            onEvent: ({ type, data }) => {
              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(data) as Record<string, unknown>;
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
                      error instanceof Error
                        ? error.message
                        : "Failed to parse OpenCode SSE payload.",
                    class: "transport_error",
                  },
                });
                return;
              }

              const eventType = typeof parsed.type === "string" ? parsed.type : type;
              switch (eventType) {
                case "assistant.delta":
                case "message.delta":
                case "content.delta": {
                  const delta =
                    typeof parsed.delta === "string"
                      ? parsed.delta
                      : typeof parsed.text === "string"
                        ? parsed.text
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
                case "tool.started":
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                      itemId: RuntimeItemId.make(
                        typeof parsed.itemId === "string"
                          ? parsed.itemId
                          : `${String(turnId)}:tool:${crypto.randomUUID()}`,
                      ),
                    }),
                    type: "item.started",
                    payload: {
                      itemType: "dynamic_tool_call",
                      status: "inProgress",
                      ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
                    },
                  });
                  break;
                case "tool.completed":
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                      itemId: RuntimeItemId.make(
                        typeof parsed.itemId === "string"
                          ? parsed.itemId
                          : `${String(turnId)}:tool:${crypto.randomUUID()}`,
                      ),
                    }),
                    type: "item.completed",
                    payload: {
                      itemType: "dynamic_tool_call",
                      status: "completed",
                      ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
                    },
                  });
                  break;
                case "permission.requested":
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                    }),
                    type: "request.opened",
                    payload: {
                      requestType: "unknown",
                      ...(typeof parsed.detail === "string" ? { detail: parsed.detail } : {}),
                    },
                  });
                  break;
                case "permission.resolved":
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                    }),
                    type: "request.resolved",
                    payload: {
                      requestType: "unknown",
                      ...(typeof parsed.decision === "string" ? { decision: parsed.decision } : {}),
                    },
                  });
                  break;
                case "turn.completed":
                  finalizeTurnSnapshot(state, turnId);
                  state.activeTurnId = undefined;
                  state.activeAbortController = undefined;
                  state.interruptedTurnIds.delete(String(turnId));
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                    }),
                    type: "turn.completed",
                    payload: {
                      state: "completed",
                      ...(typeof parsed.stopReason === "string"
                        ? { stopReason: parsed.stopReason }
                        : {}),
                    },
                  });
                  break;
                case "turn.aborted":
                  finalizeTurnSnapshot(state, turnId);
                  state.activeTurnId = undefined;
                  state.activeAbortController = undefined;
                  state.interruptedTurnIds.delete(String(turnId));
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                    }),
                    type: "turn.aborted",
                    payload: {
                      reason:
                        typeof parsed.reason === "string"
                          ? parsed.reason
                          : "OpenCode turn aborted.",
                    },
                  });
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                    }),
                    type: "turn.completed",
                    payload: {
                      state: "interrupted",
                      stopReason: typeof parsed.reason === "string" ? parsed.reason : "interrupted",
                    },
                  });
                  break;
                case "warning":
                  emit({
                    ...runtimeEventBase({
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId,
                    }),
                    type: "config.warning",
                    payload: {
                      summary:
                        typeof parsed.summary === "string"
                          ? parsed.summary
                          : "OpenCode reported a configuration warning.",
                      ...(typeof parsed.details === "string" ? { details: parsed.details } : {}),
                    },
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
                        typeof parsed.message === "string"
                          ? parsed.message
                          : "OpenCode reported a runtime error.",
                      class: "provider_error",
                      detail: parsed,
                    },
                  });
                  break;
                default:
                  break;
              }
            },
          });
        } catch (error) {
          if (state.interruptedTurnIds.has(String(turnId))) {
            state.interruptedTurnIds.delete(String(turnId));
            return;
          }
          finalizeTurnSnapshot(state, turnId);
          state.activeTurnId = undefined;
          state.activeAbortController = undefined;
          emit({
            ...runtimeEventBase({
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
            }),
            type: "runtime.error",
            payload: {
              message: error instanceof Error ? error.message : "OpenCode stream failed.",
              class: "transport_error",
            },
          });
          emit({
            ...runtimeEventBase({
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
            }),
            type: "turn.completed",
            payload: {
              state: "failed",
              errorMessage: error instanceof Error ? error.message : "OpenCode stream failed.",
            },
          });
        }
      })();

      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: { sessionId: state.providerSessionId },
      };
    });

  const interruptTurn: OpenCodeAdapterShape["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const state = threadStates.get(threadId);
      if (!state) {
        return yield* missingSession(threadId);
      }
      const activeTurnId = turnId ?? state.activeTurnId;
      if (!activeTurnId) {
        return;
      }
      state.interruptedTurnIds.add(String(activeTurnId));
      state.activeAbortController?.abort();
      state.activeAbortController = undefined;
      state.activeTurnId = undefined;
      finalizeTurnSnapshot(state, activeTurnId);
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
      emit({
        ...runtimeEventBase({
          provider: PROVIDER,
          threadId,
          turnId: activeTurnId,
        }),
        type: "turn.completed",
        payload: {
          state: "interrupted",
          stopReason: "interrupted",
        },
      });
    });

  const respondToRequest: OpenCodeAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const state = threadStates.get(threadId);
      if (!state) {
        return yield* missingSession(threadId);
      }
      const baseUrl = yield* Effect.tryPromise(() => ensureBaseUrl()).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId,
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );
      yield* Effect.tryPromise(async () => {
        const settings = await getSettings();
        const response = await fetchJson(
          fetchImpl,
          `${baseUrl}/api/sessions/${encodeURIComponent(state.providerSessionId)}/requests/${encodeURIComponent(requestId)}`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...openCodeAuthHeaders(settings),
            },
            body: JSON.stringify({ decision } satisfies { decision: ProviderApprovalDecision }),
          },
        );
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`OpenCode request response failed with status ${response.status}.`);
        }
      }).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "POST /api/sessions/:id/requests/:requestId",
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );
    });

  const respondToUserInput: OpenCodeAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const state = threadStates.get(threadId);
      if (!state) {
        return yield* missingSession(threadId);
      }
      const baseUrl = yield* Effect.tryPromise(() => ensureBaseUrl()).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId,
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );
      yield* Effect.tryPromise(async () => {
        const settings = await getSettings();
        const response = await fetchJson(
          fetchImpl,
          `${baseUrl}/api/sessions/${encodeURIComponent(state.providerSessionId)}/user-input/${encodeURIComponent(requestId)}`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...openCodeAuthHeaders(settings),
            },
            body: JSON.stringify({ answers } satisfies { answers: ProviderUserInputAnswers }),
          },
        );
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`OpenCode user-input response failed with status ${response.status}.`);
        }
      }).pipe(
        Effect.mapError(
          (error) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "POST /api/sessions/:id/user-input/:requestId",
              detail: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
        ),
      );
    });

  const stopSession: OpenCodeAdapterShape["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const state = threadStates.get(threadId);
      if (!state) {
        return;
      }
      if (state.activeTurnId) {
        yield* interruptTurn(threadId, state.activeTurnId);
      }
      threadStates.delete(threadId);
    });

  const listSessions: OpenCodeAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(threadStates.values(), (state) => state.session));

  const hasSession: OpenCodeAdapterShape["hasSession"] = (threadId) =>
    Effect.succeed(threadStates.has(threadId));

  const readThread: OpenCodeAdapterShape["readThread"] = (threadId) => {
    const state = threadStates.get(threadId);
    return state ? Effect.succeed(state.snapshot) : Effect.fail(missingSession(threadId));
  };

  const rollbackThread: OpenCodeAdapterShape["rollbackThread"] = (_threadId) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "rollbackThread",
        issue: `Rollback is not supported for '${PROVIDER}' in v1.`,
      }),
    );

  const stopAll: OpenCodeAdapterShape["stopAll"] = () =>
    Effect.gen(function* () {
      for (const threadId of threadStates.keys()) {
        yield* stopSession(threadId);
      }
      yield* Effect.promise(async () => {
        if (managedServer) {
          managedServer.handle.kill("SIGTERM");
          managedServer = undefined;
        }
      });
    });

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies OpenCodeAdapterShape;
});

export const OpenCodeAdapterLive = Layer.effect(OpenCodeAdapter, makeOpenCodeAdapter());

export function makeOpenCodeAdapterLive(options?: OpenCodeAdapterLiveOptions) {
  return Layer.effect(OpenCodeAdapter, makeOpenCodeAdapter(options));
}
