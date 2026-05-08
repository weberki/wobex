import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, verify as verifySignature } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";

import { startRelayHostConnector } from "./relayHostConnector";
import { saveRelayHostConnection } from "./relayHostConfig";

describe("relayHostConnector", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it.skip("authenticates with a signed tunnel challenge and forwards HTTP and WebSocket frames", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wobex-relay-host-connector-"));
    const secretsDir = join(baseDir, "secrets");

    const localHttp = await makeHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/echo?hello=world") {
        respondJson(res, 200, { ok: true, method: req.method });
        return;
      }
      respondJson(res, 404, { error: "not found" });
    });
    cleanups.push(localHttp.close);

    const localWebSocket = await makeWebSocketServer({
      path: "/socket",
      onMessage: (socket) => {
        socket.send("pong");
      },
    });
    cleanups.push(localWebSocket.close);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const hostKeyId = "host-key-1";
    let currentChallengeId = "challenge-1";
    let currentNonce = "relay-nonce-1";
    let handlerError: Error | null = null;

    const relayServer = await makeWebSocketServer({
      path: "/api/host-tunnel",
      httpHandler: (req, res) => {
        if (req.method === "POST" && req.url === "/api/hosts/host-1/tunnel-challenge") {
          if (req.headers.authorization !== "Bearer relay-token-1") {
            handlerError = new Error(
              `unexpected authorization header: ${String(req.headers.authorization)}`,
            );
            respondJson(res, 401, { error: "unauthorized" });
            return true;
          }
          void readJson(req)
            .then((body) => {
              if (
                JSON.stringify(body) !==
                JSON.stringify({
                  hostId: "host-1",
                  hostKeyId,
                })
              ) {
                handlerError = new Error(
                  `unexpected challenge request body: ${JSON.stringify(body)}`,
                );
                respondJson(res, 400, { error: "unexpected body" });
                return;
              }
              currentChallengeId = authPayloads.length === 0 ? "challenge-1" : "challenge-2";
              currentNonce = authPayloads.length === 0 ? "relay-nonce-1" : "relay-nonce-2";
              respondJson(res, 200, {
                challengeId: currentChallengeId,
                nonce: currentNonce,
                expiresAt: "2026-04-15T10:05:00.000Z",
              });
            })
            .catch((error) => {
              handlerError = error instanceof Error ? error : new Error(String(error));
              respondJson(res, 500, { error: "challenge parse failed" });
            });
          return true;
        }
        return false;
      },
      onConnection: (socket) => {
        let authenticated = false;
        socket.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString()) as any;
          relayFrames.push(parsed);

          if (parsed.type === "host.status") {
            return;
          }

          if (!authenticated) {
            authPayloads.push(parsed as { readonly reconnectAttempt?: number });
            if (parsed.hostId !== "host-1") {
              handlerError = new Error(`unexpected hostId: ${String(parsed.hostId)}`);
              return;
            }
            if (parsed.hostKeyId !== hostKeyId) {
              handlerError = new Error(`unexpected hostKeyId: ${String(parsed.hostKeyId)}`);
              return;
            }
            if (parsed.challengeId !== currentChallengeId) {
              handlerError = new Error(
                `unexpected challengeId: ${String(parsed.challengeId)} expected ${currentChallengeId}`,
              );
              return;
            }
            if (parsed.relayUrl !== connection.relayUrl) {
              handlerError = new Error(`unexpected relayUrl: ${String(parsed.relayUrl)}`);
              return;
            }
            const verified = verifySignature(
              null,
              Buffer.from(
                JSON.stringify({
                  relayUrl: connection.relayUrl,
                  hostId: "host-1",
                  hostKeyId,
                  challengeId: currentChallengeId,
                  nonce: currentNonce,
                }),
                "utf8",
              ),
              publicKeyPem,
              Buffer.from(parsed.challengeSignature, "base64url"),
            );
            if (!verified) {
              handlerError = new Error("challenge signature did not verify");
              return;
            }
            const reconnectAttempt = Number(parsed.reconnectAttempt ?? 0);
            socket.send(
              JSON.stringify({
                authenticated: true,
                host: {
                  id: "host-1",
                  ownerUserId: "user-1",
                  label: "Mac Mini",
                  status: "online",
                  lastSeenAt: "2026-04-15T10:00:00.000Z",
                  createdAt: "2026-04-15T10:00:00.000Z",
                  updatedAt: "2026-04-15T10:00:00.000Z",
                  activeGrantCount: 1,
                },
                connectedAt: "2026-04-15T10:00:00.000Z",
              }),
            );
            authenticated = true;
            if (reconnectAttempt !== 0) {
              handlerError = new Error(`unexpected reconnectAttempt: ${reconnectAttempt}`);
              return;
            }
            queueMicrotask(() => {
              socket.send(
                JSON.stringify({
                  version: 1,
                  type: "http.request",
                  hostId: "host-1",
                  requestId: "request-1",
                  timestamp: "2026-04-15T10:00:00.000Z",
                  payload: {
                    method: "GET",
                    path: "/api/echo",
                    query: { hello: "world" },
                    headers: { accept: "application/json" },
                  },
                }),
              );
              socket.send(
                JSON.stringify({
                  version: 1,
                  type: "ws.open",
                  hostId: "host-1",
                  streamId: "stream-1",
                  timestamp: "2026-04-15T10:00:00.000Z",
                  payload: {
                    path: "/socket",
                    headers: {},
                  },
                }),
              );
              socket.send(
                JSON.stringify({
                  version: 1,
                  type: "ws.message",
                  hostId: "host-1",
                  streamId: "stream-1",
                  timestamp: "2026-04-15T10:00:00.000Z",
                  payload: {
                    direction: "client-to-host",
                    isBinary: false,
                    data: "ping",
                  },
                }),
              );
            });
            return;
          }

          if (parsed.type === "http.response" && parsed.requestId === "request-1") {
            responseFrameSeen = true;
            if (parsed.payload.statusCode !== 200 || !(parsed.payload.byteCount > 0)) {
              handlerError = new Error("unexpected http.response frame");
              return;
            }
          }

          if (
            parsed.type === "ws.message" &&
            parsed.streamId === "stream-1" &&
            parsed.payload?.direction === "host-to-client"
          ) {
            hostToClientMessageSeen = true;
            if (parsed.payload.data !== "pong") {
              handlerError = new Error(`unexpected ws payload: ${String(parsed.payload.data)}`);
              return;
            }
          }

          if (parsed.type === "ws.close" && parsed.streamId === "stream-1") {
            hostCloseFrameSeen = true;
            if (parsed.payload.initiatedBy !== "host") {
              handlerError = new Error(
                `unexpected ws close initiator: ${String(parsed.payload.initiatedBy)}`,
              );
              return;
            }
          }

          if (responseFrameSeen && hostToClientMessageSeen && !streamCloseFrameSent) {
            streamCloseFrameSent = true;
            socket.send(
              JSON.stringify({
                version: 1,
                type: "ws.close",
                hostId: "host-1",
                streamId: "stream-1",
                timestamp: "2026-04-15T10:00:00.000Z",
                payload: {
                  code: 1000,
                  reason: "done",
                  initiatedBy: "relay",
                },
              }),
            );
          }
        });
      },
    });
    cleanups.push(relayServer.close);

    const connection = await saveRelayHostConnection({
      secretsDir,
      relayUrl: relayServer.httpUrl,
      hostId: "host-1",
      registrationToken: "relay-token-1",
      hostKeyId,
      hostPublicKeyPem: publicKeyPem,
      hostPrivateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      now: new Date("2026-04-15T10:00:00.000Z"),
    });

    const relayFrames: Array<unknown> = [];
    const authPayloads: Array<{ readonly reconnectAttempt?: number }> = [];
    const statusEvents: Array<string> = [];
    let responseFrameSeen = false;
    let hostToClientMessageSeen = false;
    let hostCloseFrameSeen = false;
    let streamCloseFrameSent = false;

    const handle = startRelayHostConnector({
      connection,
      localHttpOrigin: localHttp.url,
      localWebSocketOrigin: localWebSocket.wsUrl,
      webSocketImpl: WebSocket,
      initialBackoffMs: 25,
      maxBackoffMs: 50,
      backoffMultiplier: 1,
      onStatus: (status, detail) => {
        statusEvents.push(`${status}${detail ? `:${detail}` : ""}`);
      },
      onError: (error) => {
        statusEvents.push(`error:${error instanceof Error ? error.message : String(error)}`);
      },
    });
    cleanups.push(async () => {
      handle.stop();
      await handle.ready.catch(() => undefined);
    });

    await waitForPromise(
      handle.ready,
      5_000,
      () =>
        `connector did not become ready; auth=${authPayloads.length}, statuses=${statusEvents.join(" | ")}, relayFrames=${relayFrames.length}${handlerError ? `, handlerError=${handlerError.message}` : ""}`,
    );
    await waitFor(() => {
      if (handlerError) {
        throw handlerError;
      }
      return responseFrameSeen && hostToClientMessageSeen && hostCloseFrameSeen;
    });
    handle.stop();
    expect(authPayloads).toHaveLength(1);
    expect(authPayloads[0]?.reconnectAttempt ?? 0).toBe(0);
  });
});

async function makeHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}

async function makeWebSocketServer(input: {
  readonly path: string;
  readonly httpHandler?: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => boolean;
  readonly onMessage?: (socket: WebSocket, data: RawData) => void;
  readonly onConnection?: (socket: WebSocket) => void;
}): Promise<{
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly close: () => Promise<void>;
}> {
  const httpServer = createServer((req, res) => {
    if (input.httpHandler?.(req, res)) {
      return;
    }
    respondJson(res, 404, { error: "not found" });
  });
  const server = new WebSocketServer({ server: httpServer, path: input.path });
  server.on("connection", (socket) => {
    input.onConnection?.(socket);
    if (input.onMessage) {
      socket.on("message", (data) => {
        input.onMessage?.(socket, data);
      });
    }
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          httpServer.closeAllConnections?.();
          httpServer.close((httpError) => {
            if (httpError) {
              reject(httpError);
              return;
            }
            resolve();
          });
        });
      }),
  };
}

function respondJson(response: ServerResponse<IncomingMessage>, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload, "utf8"));
  response.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for relay host connector activity");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: () => string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message())), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
