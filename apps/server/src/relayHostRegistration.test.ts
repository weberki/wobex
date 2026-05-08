import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  pollRelayHostPairingIntent,
  registerRelayHostPublicKey,
  requestRelayHostTunnelChallenge,
  resolveRelayHostApprovalUrl,
  revokeRelayHostRegistration,
  startRelayHostPairingIntent,
} from "./relayHostRegistration";
import { generateRelayHostKeyMaterial } from "./relayHostKeys";

describe("relayHostRegistration", () => {
  let servers: Array<{ readonly close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  it("creates a pairing intent, polls until approval, and returns the registration token", async () => {
    let pollCount = 0;
    const server = await makeServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/hosts/pairing-intents") {
        void readJson(req).then((body) => {
          expect(body).toEqual({ hostLabel: "Mac Mini" });
          respondJson(res, 200, {
            intent: {
              id: "intent-1",
              requestedByUserId: "user-1",
              deviceCode: "1234-5678",
              qrCodeUrl: "https://relay.example/pair/1234-5678",
              status: "pending",
              createdAt: "2026-04-15T10:00:00.000Z",
              expiresAt: "2026-04-15T10:10:00.000Z",
              approvedAt: null,
            },
          });
        });
        return;
      }

      if (req.method === "GET" && req.url === "/api/hosts/pairing-intents/intent-1") {
        pollCount += 1;
        respondJson(
          res,
          200,
          pollCount === 1
            ? {
                intent: {
                  id: "intent-1",
                  requestedByUserId: "user-1",
                  deviceCode: "1234-5678",
                  status: "pending",
                  createdAt: "2026-04-15T10:00:00.000Z",
                  expiresAt: "2026-04-15T10:10:00.000Z",
                  approvedAt: null,
                },
              }
            : {
                intent: {
                  id: "intent-1",
                  requestedByUserId: "user-1",
                  deviceCode: "1234-5678",
                  status: "approved",
                  createdAt: "2026-04-15T10:00:00.000Z",
                  expiresAt: "2026-04-15T10:10:00.000Z",
                  approvedAt: "2026-04-15T10:01:00.000Z",
                  hostId: "host-1",
                },
                host: {
                  id: "host-1",
                  ownerUserId: "user-1",
                  label: "Mac Mini",
                  status: "offline",
                  lastSeenAt: null,
                  createdAt: "2026-04-15T10:00:00.000Z",
                  updatedAt: "2026-04-15T10:00:00.000Z",
                  activeGrantCount: 0,
                },
                registrationToken: {
                  tokenId: "token-1",
                  token: "relay-token-1",
                  expiresAt: "2026-04-15T10:20:00.000Z",
                },
              },
        );
        return;
      }

      if (req.method === "POST" && req.url === "/api/hosts/host-1/revoke") {
        expect(req.headers.authorization).toBe("Bearer relay-token-1");
        respondJson(res, 200, { revoked: true });
        return;
      }

      respondJson(res, 404, { error: "not found" });
    });
    servers.push(server);

    const intent = await startRelayHostPairingIntent({
      relayUrl: server.url,
      hostLabel: "Mac Mini",
    });
    expect(intent.deviceCode).toBe("1234-5678");
    expect(intent.approvalUrl).toBe("https://relay.example/pair/1234-5678");
    expect(resolveRelayHostApprovalUrl(intent.intent, server.url)).toBe(
      "https://relay.example/pair/1234-5678",
    );

    const approved = await pollRelayHostPairingIntent({
      relayUrl: server.url,
      intentId: intent.intent.id,
      pollIntervalMs: 1,
      timeoutMs: 1_000,
    });
    expect(approved.host.id).toBe("host-1");
    expect(approved.registrationToken.token).toBe("relay-token-1");

    await revokeRelayHostRegistration({
      relayUrl: server.url,
      hostId: approved.host.id,
      registrationToken: approved.registrationToken.token,
    });
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("registers a host public key and requests a tunnel challenge", async () => {
    const keyMaterial = generateRelayHostKeyMaterial();
    const server = await makeServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/hosts/host-1/public-key") {
        expect(req.headers.authorization).toBe("Bearer relay-token-1");
        void readJson(req).then((body) => {
          expect(body).toEqual({
            hostId: "host-1",
            registrationToken: "relay-token-1",
            hostKeyId: keyMaterial.hostKeyId,
            publicKeyPem: keyMaterial.hostPublicKeyPem,
            algorithm: "ed25519",
          });
          respondJson(res, 200, {
            hostId: "host-1",
            hostKeyId: keyMaterial.hostKeyId,
            trustedRelaySigningKeyId: "relay-key-1",
            trustedRelaySigningKey: "relay-signing-secret",
          });
        });
        return;
      }
      if (req.method === "POST" && req.url === "/api/hosts/host-1/tunnel-challenge") {
        expect(req.headers.authorization).toBe("Bearer relay-token-1");
        void readJson(req).then((body) => {
          expect(body).toEqual({
            hostId: "host-1",
            hostKeyId: keyMaterial.hostKeyId,
          });
          respondJson(res, 200, {
            challengeId: "challenge-1",
            nonce: "nonce-1",
            expiresAt: "2026-04-15T10:10:00.000Z",
          });
        });
        return;
      }
      respondJson(res, 404, { error: "not found" });
    });
    servers.push(server);

    await expect(
      registerRelayHostPublicKey({
        relayUrl: server.url,
        hostId: "host-1",
        registrationToken: "relay-token-1",
        keyMaterial,
      }),
    ).resolves.toEqual({
      hostId: "host-1",
      hostKeyId: keyMaterial.hostKeyId,
      trustedRelaySigningKeyId: "relay-key-1",
      trustedRelaySigningKey: "relay-signing-secret",
    });

    await expect(
      requestRelayHostTunnelChallenge({
        relayUrl: server.url,
        hostId: "host-1",
        registrationToken: "relay-token-1",
        hostKeyId: keyMaterial.hostKeyId,
      }),
    ).resolves.toEqual({
      challengeId: "challenge-1",
      nonce: "nonce-1",
      expiresAt: "2026-04-15T10:10:00.000Z",
    });
  });
});

async function makeServer(
  handler: RequestListener,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
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
      }),
  };
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

function respondJson(response: ServerResponse<IncomingMessage>, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload, "utf8"));
  response.end(payload);
}
