import { setTimeout as delay } from "node:timers/promises";

import {
  RelayHostTunnelAuthInput,
  RelayHostTunnelAuthResult,
  RelayHostTunnelFrame,
  RelayHostTunnelHostErrorFrame,
  RelayHostTunnelHostStatusFrame,
  RelayHostTunnelHttpRequestFrame,
  RelayHostTunnelHttpResponseFrame,
  RelayHostTunnelWsCloseFrame,
  RelayHostTunnelWsMessageFrame,
  RelayHostTunnelWsOpenFrame,
  type RelayHostStatus,
} from "@wobex/contracts";
import { Schema } from "effect";
import { Effect, Layer } from "effect";
import WebSocket, { type RawData } from "ws";

import { ServerConfig } from "./config";
import { readRelayHostConnection } from "./relayHostConfig";
import { resolveRelayHostTunnelUrl } from "./relayHostRegistration";
import type { RelayHostConnectionConfig } from "./relayHostConfig";
import { requestRelayHostTunnelChallenge } from "./relayHostRegistration";
import { signRelayHostTunnelChallenge } from "./relayHostKeys";
import { ensureRelayHostConnectionEnrollment } from "./relayHostEnrollment";

const decodeTunnelFrame = Schema.decodeUnknownSync(RelayHostTunnelFrame);
const decodeAuthResult = Schema.decodeUnknownSync(RelayHostTunnelAuthResult);

const DEFAULT_INITIAL_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 5_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

export interface RelayHostConnectorOptions {
  readonly connection: RelayHostConnectionConfig;
  readonly localHttpOrigin: string;
  readonly localWebSocketOrigin: string;
  readonly fetchImpl?: typeof fetch;
  readonly webSocketImpl?: typeof WebSocket;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly backoffMultiplier?: number;
  readonly onStatus?: (status: RelayHostStatus, detail?: string) => void;
  readonly onError?: (error: unknown) => void;
  readonly signal?: AbortSignal;
}

export interface RelayHostConnectorHandle {
  readonly stop: () => void;
  readonly ready: Promise<void>;
}

export function startRelayHostConnector(
  options: RelayHostConnectorOptions,
): RelayHostConnectorHandle {
  const controller = new AbortController();
  const signal = mergeAbortSignals(controller.signal, options.signal);
  const WebSocketCtor = options.webSocketImpl ?? WebSocket;
  const fetchImpl = options.fetchImpl ?? fetch;
  const initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const backoffMultiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const localHttpOrigin = normalizeHttpOrigin(options.localHttpOrigin);
  const localWebSocketOrigin = normalizeWebSocketOrigin(options.localWebSocketOrigin);

  let readyResolved = false;
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const openLocalSockets = new Map<string, WebSocket>();
  const pendingLocalMessages = new Map<string, RelayHostTunnelWsMessageFrame[]>();
  let currentRelaySocket: WebSocket | undefined;

  const stop = () => {
    if (currentRelaySocket && currentRelaySocket.readyState === WebSocketCtor.OPEN) {
      sendStatus(currentRelaySocket, "offline", "relay host tunnel stopped");
    }
    controller.abort();
  };

  const markReady = () => {
    if (!readyResolved) {
      readyResolved = true;
      readyResolve();
    }
  };

  const sendStatus = (
    relaySocket: WebSocket | undefined,
    status: RelayHostStatus,
    detail?: string,
  ) => {
    if (!relaySocket || relaySocket.readyState !== WebSocketCtor.OPEN) {
      return;
    }
    const frame = {
      version: 1,
      type: "host.status",
      hostId: options.connection.hostId,
      timestamp: new Date().toISOString(),
      payload: {
        status,
        ...(detail ? { detail } : {}),
      },
    } as unknown as RelayHostTunnelHostStatusFrame;
    relaySocket.send(JSON.stringify(frame));
    options.onStatus?.(status, detail);
  };

  const sendHostError = (
    relaySocket: WebSocket | undefined,
    code: string,
    message: string,
    retryable: boolean,
  ) => {
    if (!relaySocket || relaySocket.readyState !== WebSocketCtor.OPEN) {
      return;
    }
    const frame = {
      version: 1,
      type: "host.error",
      hostId: options.connection.hostId,
      timestamp: new Date().toISOString(),
      payload: {
        code,
        message,
        retryable,
      },
    } as unknown as RelayHostTunnelHostErrorFrame;
    relaySocket.send(JSON.stringify(frame));
  };

  const closeAllLocalSockets = (code = 1012, reason = "Relay host tunnel closed") => {
    for (const [streamId, socket] of openLocalSockets.entries()) {
      if (
        socket.readyState === WebSocketCtor.OPEN ||
        socket.readyState === WebSocketCtor.CONNECTING
      ) {
        socket.close(code, reason);
      }
      openLocalSockets.delete(streamId);
    }
    pendingLocalMessages.clear();
  };

  const forwardHttpRequest = async (
    relaySocket: WebSocket,
    frame: RelayHostTunnelHttpRequestFrame,
  ) => {
    try {
      const requestUrl = new URL(frame.payload.path, localHttpOrigin);
      if (frame.payload.query) {
        requestUrl.search = new URLSearchParams(frame.payload.query).toString();
      }
      const response = await fetchImpl(requestUrl, {
        method: frame.payload.method,
        headers: frame.payload.headers,
        body:
          frame.payload.bodyBase64 !== undefined
            ? Buffer.from(frame.payload.bodyBase64, "base64")
            : undefined,
      });
      const responseBuffer = Buffer.from(await response.arrayBuffer());
      const responseHeaders = headersToRecord(response.headers);
      const responseFrame = {
        version: 1,
        type: "http.response",
        hostId: options.connection.hostId,
        requestId: frame.requestId,
        timestamp: new Date().toISOString(),
        payload: {
          statusCode: response.status,
          ...(Object.keys(responseHeaders).length > 0 ? { headers: responseHeaders } : {}),
          ...(responseBuffer.length > 0 ? { bodyBase64: responseBuffer.toString("base64") } : {}),
          byteCount: responseBuffer.length,
        },
      } as unknown as RelayHostTunnelHttpResponseFrame;
      relaySocket.send(JSON.stringify(responseFrame));
    } catch (error) {
      const responseFrame = {
        version: 1,
        type: "http.response",
        hostId: options.connection.hostId,
        requestId: frame.requestId,
        timestamp: new Date().toISOString(),
        payload: {
          statusCode: 502,
          byteCount: 0,
        },
      } as unknown as RelayHostTunnelHttpResponseFrame;
      relaySocket.send(JSON.stringify(responseFrame));
      sendHostError(relaySocket, "http.request.failed", stringifyError(error), false);
    }
  };

  const openLocalWebSocket = (relaySocket: WebSocket, frame: RelayHostTunnelWsOpenFrame) => {
    const localUrl = new URL(frame.payload.path, localWebSocketOrigin);
    if (frame.payload.query) {
      localUrl.search = new URLSearchParams(frame.payload.query).toString();
    }

    const localSocket = new WebSocketCtor(
      localUrl,
      frame.payload.subprotocol ? [frame.payload.subprotocol] : undefined,
      frame.payload.headers ? { headers: frame.payload.headers } : undefined,
    );

    openLocalSockets.set(frame.streamId, localSocket);

    localSocket.on("open", () => {
      flushPendingMessages(frame.streamId, localSocket);
    });
    localSocket.on("message", (data: RawData, isBinary: boolean) => {
      if (relaySocket.readyState !== WebSocketCtor.OPEN) {
        return;
      }
      const buffer = toBuffer(data);
      const messageFrame = {
        version: 1,
        type: "ws.message",
        hostId: options.connection.hostId,
        streamId: frame.streamId,
        timestamp: new Date().toISOString(),
        payload: {
          direction: "host-to-client",
          isBinary,
          data: isBinary ? buffer.toString("base64") : buffer.toString("utf8"),
          byteCount: buffer.byteLength,
        },
      } as unknown as RelayHostTunnelWsMessageFrame;
      relaySocket.send(JSON.stringify(messageFrame));
    });
    localSocket.on("close", (code: number, reasonBuffer: Buffer) => {
      openLocalSockets.delete(frame.streamId);
      pendingLocalMessages.delete(frame.streamId);
      if (relaySocket.readyState === WebSocketCtor.OPEN) {
        const closeFrame = {
          version: 1,
          type: "ws.close",
          hostId: options.connection.hostId,
          streamId: frame.streamId,
          timestamp: new Date().toISOString(),
          payload: {
            code,
            ...(reasonBuffer.byteLength > 0 ? { reason: reasonBuffer.toString("utf8") } : {}),
            initiatedBy: "host",
          },
        } as unknown as RelayHostTunnelWsCloseFrame;
        relaySocket.send(JSON.stringify(closeFrame));
      }
    });
    localSocket.on("error", (error: unknown) => {
      if (relaySocket.readyState === WebSocketCtor.OPEN) {
        sendHostError(relaySocket, "ws.open.failed", stringifyError(error), false);
      }
    });
  };

  const flushPendingMessages = (streamId: string, localSocket: WebSocket) => {
    const pending = pendingLocalMessages.get(streamId);
    if (!pending || pending.length === 0 || localSocket.readyState !== WebSocketCtor.OPEN) {
      return;
    }
    for (const frame of pending) {
      if (frame.payload.isBinary) {
        localSocket.send(Buffer.from(frame.payload.data, "base64"));
      } else {
        localSocket.send(frame.payload.data);
      }
    }
    pendingLocalMessages.delete(streamId);
  };

  const forwardWsMessage = (frame: RelayHostTunnelWsMessageFrame) => {
    const localSocket = openLocalSockets.get(frame.streamId);
    if (!localSocket || localSocket.readyState !== WebSocketCtor.OPEN) {
      const pending = pendingLocalMessages.get(frame.streamId) ?? [];
      pendingLocalMessages.set(frame.streamId, [...pending, frame]);
      return;
    }
    if (frame.payload.isBinary) {
      localSocket.send(Buffer.from(frame.payload.data, "base64"));
    } else {
      localSocket.send(frame.payload.data);
    }
  };

  const closeLocalWebSocket = (frame: RelayHostTunnelWsCloseFrame) => {
    const localSocket = openLocalSockets.get(frame.streamId);
    if (!localSocket) {
      pendingLocalMessages.delete(frame.streamId);
      return;
    }
    if (
      localSocket.readyState === WebSocketCtor.CLOSING ||
      localSocket.readyState === WebSocketCtor.CLOSED
    ) {
      return;
    }
    localSocket.close(frame.payload.code, frame.payload.reason ?? "Relay requested close");
  };

  const handleRelayFrame = async (relaySocket: WebSocket, message: unknown) => {
    const frame = tryDecode(decodeTunnelFrame, message);
    if (!frame) {
      sendHostError(relaySocket, "protocol.invalid", "Received an invalid relay frame.", false);
      throw new FatalRelayConnectorError("Received an invalid relay frame.");
    }

    switch (frame.type) {
      case "http.request":
        await forwardHttpRequest(relaySocket, frame);
        return;
      case "ws.open":
        openLocalWebSocket(relaySocket, frame);
        return;
      case "ws.message":
        forwardWsMessage(frame);
        return;
      case "ws.close":
        closeLocalWebSocket(frame);
        return;
      case "host.status":
        return;
      case "host.error":
        if (!frame.payload.retryable) {
          throw new FatalRelayConnectorError(`${frame.payload.code}: ${frame.payload.message}`);
        }
        return;
    }
  };

  let currentReconnectAttempt = 0;

  void (async () => {
    let backoffMs = initialBackoffMs;
    while (!signal.aborted) {
      try {
        await connectOnce({
          WebSocketCtor,
          fetchImpl,
          localHttpOrigin,
          localWebSocketOrigin,
          connection: options.connection,
          signal,
          reconnectAttempt: currentReconnectAttempt,
          onRelaySocketChange: (relaySocket) => {
            currentRelaySocket = relaySocket;
          },
          onOpen: (socket) => {
            sendStatus(
              socket,
              "reconnecting",
              currentReconnectAttempt > 0 ? "retrying relay tunnel" : "connecting relay tunnel",
            );
          },
          onAuthenticated: (socket) => {
            markReady();
            if (signal.aborted) {
              return;
            }
            if (currentReconnectAttempt > 0) {
              sendStatus(socket, "replaying", "replaying local host state");
              sendStatus(socket, "recovered", "local host tunnel recovered");
            } else {
              sendStatus(socket, "online", "relay host tunnel connected");
            }
          },
          onMessage: handleRelayFrame,
        });
        if (signal.aborted) {
          break;
        }
        currentReconnectAttempt += 1;
        backoffMs = Math.min(maxBackoffMs, Math.max(1, backoffMs * backoffMultiplier));
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        options.onError?.(error);
        if (isFatalRelayConnectorError(error)) {
          break;
        }
        currentReconnectAttempt += 1;
        backoffMs = Math.min(maxBackoffMs, Math.max(1, backoffMs * backoffMultiplier));
      }

      if (signal.aborted) {
        break;
      }
      closeAllLocalSockets();
      await delay(backoffMs);
    }
    closeAllLocalSockets();
  })().catch((error) => {
    options.onError?.(error);
  });

  return { stop, ready };
}

interface ConnectOnceInput {
  readonly WebSocketCtor: typeof WebSocket;
  readonly fetchImpl: typeof fetch;
  readonly localHttpOrigin: string;
  readonly localWebSocketOrigin: string;
  readonly connection: RelayHostConnectionConfig;
  readonly reconnectAttempt: number;
  readonly signal: AbortSignal;
  readonly onRelaySocketChange: (relaySocket: WebSocket | undefined) => void;
  readonly onOpen: (relaySocket: WebSocket) => void;
  readonly onAuthenticated: (relaySocket: WebSocket) => void;
  readonly onMessage: (relaySocket: WebSocket, message: unknown) => Promise<void>;
}

async function connectOnce(input: ConnectOnceInput): Promise<void> {
  const relaySocket = new input.WebSocketCtor(resolveRelayHostTunnelUrl(input.connection.relayUrl));
  if (
    !input.connection.hostKeyId ||
    !input.connection.hostPrivateKeyPem ||
    !input.connection.hostPublicKeyPem
  ) {
    throw new FatalRelayConnectorError("Relay host key material is not configured.");
  }
  const challenge = await requestRelayHostTunnelChallenge({
    relayUrl: input.connection.relayUrl,
    hostId: input.connection.hostId,
    registrationToken: input.connection.registrationToken,
    hostKeyId: input.connection.hostKeyId,
    fetchImpl: input.fetchImpl,
  });
  const authInput = {
    hostId: input.connection.hostId,
    hostKeyId: input.connection.hostKeyId,
    challengeId: challenge.challengeId,
    challengeSignature: signRelayHostTunnelChallenge({
      relayUrl: input.connection.relayUrl,
      hostId: input.connection.hostId,
      hostKeyId: input.connection.hostKeyId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      hostPrivateKeyPem: input.connection.hostPrivateKeyPem,
    }),
    relayUrl: input.connection.relayUrl,
    reconnectAttempt: input.reconnectAttempt,
  } as unknown as typeof RelayHostTunnelAuthInput.Type;

  return await new Promise<void>((resolve, reject) => {
    let authenticated = false;
    let settled = false;

    const cleanup = () => {
      input.onRelaySocketChange(undefined);
      relaySocket.off("open", handleOpen);
      relaySocket.off("message", handleMessage);
      relaySocket.off("close", handleClose);
      relaySocket.off("error", handleError);
      input.signal.removeEventListener("abort", handleAbort);
    };

    const settle = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler();
    };

    const handleAbort = () => {
      if (
        relaySocket.readyState === input.WebSocketCtor.OPEN ||
        relaySocket.readyState === input.WebSocketCtor.CONNECTING
      ) {
        relaySocket.close(1000, "Relay host connector stopped");
      }
      settle(resolve);
    };

    const handleOpen = () => {
      input.onRelaySocketChange(relaySocket);
      input.onOpen(relaySocket);
      relaySocket.send(JSON.stringify(authInput));
    };

    const handleMessage = (raw: RawData, isBinary: boolean) => {
      void (async () => {
        const parsed = JSON.parse(isBinary ? toBuffer(raw).toString("utf8") : raw.toString());
        if (!authenticated) {
          const authResult = tryDecode(decodeAuthResult, parsed);
          if (!authResult) {
            throw new FatalRelayConnectorError("Relay host tunnel did not authenticate.");
          }
          authenticated = true;
          input.onAuthenticated(relaySocket);
          return;
        }

        await input.onMessage(relaySocket, parsed);
      })().catch((error) => {
        settle(() => reject(error));
      });
    };

    const handleClose = () => {
      settle(resolve);
    };

    const handleError = (error: unknown) => {
      if (!authenticated) {
        settle(() => reject(new FatalRelayConnectorError(stringifyError(error))));
        return;
      }
      settle(resolve);
    };

    input.signal.addEventListener("abort", handleAbort, { once: true });
    relaySocket.on("open", handleOpen);
    relaySocket.on("message", handleMessage);
    relaySocket.on("close", handleClose);
    relaySocket.on("error", handleError);
  });
}

class FatalRelayConnectorError extends Error {}

function isFatalRelayConnectorError(error: unknown): error is FatalRelayConnectorError {
  return error instanceof FatalRelayConnectorError;
}

function normalizeHttpOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "http:") {
    throw new Error("localHttpOrigin must use http://");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeWebSocketOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "ws:") {
    throw new Error("localWebSocketOrigin must use ws://");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    result[name] = value;
  }
  return result;
}

function toBuffer(raw: RawData): Buffer {
  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8");
  }
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return Buffer.from([]);
}

function tryDecode<T>(decode: (input: unknown) => T, input: unknown): T | undefined {
  try {
    return decode(input);
  } catch {
    return undefined;
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown relay host connector error";
}

function mergeAbortSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  if (!secondary) {
    return primary;
  }
  if (secondary.aborted) {
    return secondary;
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  primary.addEventListener("abort", onAbort, { once: true });
  secondary.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

export const RelayHostConnectorLive = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const relayConnection = yield* Effect.promise(() =>
        readRelayHostConnection(config.secretsDir),
      ).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!relayConnection) {
        return null;
      }
      const enrolledConnection = yield* Effect.promise(() =>
        ensureRelayHostConnectionEnrollment({
          secretsDir: config.secretsDir,
          connection: relayConnection,
        }),
      );
      const handle = startRelayHostConnector({
        connection: enrolledConnection,
        localHttpOrigin: `http://127.0.0.1:${config.port}`,
        localWebSocketOrigin: `ws://127.0.0.1:${config.port}`,
      });
      return handle;
    }),
    (handle) =>
      Effect.sync(() => {
        handle?.stop();
      }),
  ),
);
