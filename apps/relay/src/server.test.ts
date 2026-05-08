import { generateKeyPairSync, sign as signPayload } from "node:crypto";

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createRelayServer, type RelayServerHandle } from "./server";
import type { RelayEmailSender } from "./email";

interface TestContext {
  baseUrl: string;
  wsBaseUrl: string;
  cookieJar: string;
  csrfToken: string;
  relay: RelayServerHandle;
}

let currentRelay: RelayServerHandle | null = null;

afterEach(async () => {
  if (currentRelay) {
    await currentRelay.close();
    currentRelay = null;
  }
});

describe("relay server runtime", () => {
  it("enforces browser auth and CSRF before protected routes", async () => {
    const context = await startRelay();
    const unauthenticatedHosts = await fetchJson(`${context.baseUrl}/api/hosts`);
    expect(unauthenticatedHosts.response.status).toBe(401);

    const csrf = await fetchJson(`${context.baseUrl}/api/auth/csrf`);
    expect(csrf.response.status).toBe(200);
    context.cookieJar = mergeCookies(context.cookieJar, setCookieHeader(csrf.response));
    context.csrfToken = csrf.body.csrfToken as string;

    const blockedStart = await fetchJson(`${context.baseUrl}/api/auth/login/start`, {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com" }),
      headers: {
        "content-type": "application/json",
      },
    });
    expect(blockedStart.response.status).toBe(403);

    const loginStart = await fetchJson(`${context.baseUrl}/api/auth/login/start`, {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com", deviceLabel: "iPhone" }),
      headers: {
        "content-type": "application/json",
        cookie: context.cookieJar,
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(loginStart.response.status).toBe(200);
    expect(loginStart.body.verificationCode).toBeTruthy();

    const loginVerify = await fetchJson(`${context.baseUrl}/api/auth/login/verify`, {
      method: "POST",
      body: JSON.stringify({
        challengeId: loginStart.body.challengeId,
        code: loginStart.body.verificationCode,
      }),
      headers: {
        "content-type": "application/json",
        cookie: context.cookieJar,
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(loginVerify.response.status).toBe(200);
    context.cookieJar = mergeCookies(context.cookieJar, setCookieHeader(loginVerify.response));
    context.csrfToken = loginVerify.body.csrfToken as string;

    const me = await fetchJson(`${context.baseUrl}/api/me`, {
      headers: {
        cookie: context.cookieJar,
      },
    });
    expect(me.response.status).toBe(200);
    expect(me.body.user.email).toBe("owner@example.com");

    const authHosts = await fetchJson(`${context.baseUrl}/api/hosts`, {
      headers: {
        cookie: context.cookieJar,
      },
    });
    expect(authHosts.response.status).toBe(200);
    expect(authHosts.body.hosts).toEqual([]);
  });

  it("sends login codes through the configured email sender when debug codes are disabled", async () => {
    const sentCodes: Array<{ email: string; code: string; deviceLabel: string }> = [];
    const context = await startRelay({
      debugAuthCodes: false,
      emailFrom: "relay@example.com",
      smtpHost: "smtp.example.com",
      emailSender: {
        async sendLoginCode(input) {
          sentCodes.push({
            email: input.email,
            code: input.code,
            deviceLabel: input.deviceLabel,
          });
          return { deliveryHint: "Sent to ow***@example.com" };
        },
      },
    });

    const csrf = await fetchJson(`${context.baseUrl}/api/auth/csrf`);
    context.cookieJar = mergeCookies(context.cookieJar, setCookieHeader(csrf.response));
    context.csrfToken = csrf.body.csrfToken as string;

    const loginStart = await fetchJson(`${context.baseUrl}/api/auth/login/start`, {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com", deviceLabel: "iPhone" }),
      headers: {
        "content-type": "application/json",
        cookie: context.cookieJar,
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(loginStart.response.status).toBe(200);
    expect(loginStart.body.verificationCode).toBeUndefined();
    expect(loginStart.body.deliveryHint).toBe("Sent to ow***@example.com");
    expect(sentCodes).toEqual([
      {
        email: "owner@example.com",
        code: expect.stringMatching(/^\d{6}$/),
        deviceLabel: "iPhone",
      },
    ]);

    const loginVerify = await fetchJson(`${context.baseUrl}/api/auth/login/verify`, {
      method: "POST",
      body: JSON.stringify({
        challengeId: loginStart.body.challengeId,
        code: sentCodes[0]?.code,
      }),
      headers: {
        "content-type": "application/json",
        cookie: context.cookieJar,
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(loginVerify.response.status).toBe(200);
    expect(loginVerify.body.user.email).toBe("owner@example.com");
  });

  it("rejects login start when public email delivery is not configured", async () => {
    const context = await startRelay({
      debugAuthCodes: false,
    });

    const csrf = await fetchJson(`${context.baseUrl}/api/auth/csrf`);
    context.cookieJar = mergeCookies(context.cookieJar, setCookieHeader(csrf.response));
    context.csrfToken = csrf.body.csrfToken as string;

    const loginStart = await fetchJson(`${context.baseUrl}/api/auth/login/start`, {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com", deviceLabel: "iPhone" }),
      headers: {
        "content-type": "application/json",
        cookie: context.cookieJar,
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(loginStart.response.status).toBe(503);
    expect(loginStart.body.error).toContain("email delivery");
  });

  it("returns host offline before tunnel connection and proxies HTTP requests through a live host tunnel", async () => {
    const context = await startRelay();
    const session = await bootstrapBrowserSession(context);
    const host = context.relay.runtime.store.createHost(session.userId, "Mac Mini");
    const registration = context.relay.runtime.store.rotateHostRegistrationToken(host.id);
    context.relay.runtime.store.createHostGrant(host.id, session.deviceId);

    const offline = await fetchJson(`${context.baseUrl}/h/${host.id}/api/offline`, {
      headers: {
        cookie: context.cookieJar,
      },
    });
    expect(offline.response.status).toBe(503);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const hostSocket = await connectAuthenticatedHostSocket({
      context,
      hostId: host.id,
      registrationToken: registration.token,
      hostKeyId: "host-key-1",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey,
    });
    const requestFrames: Array<{ requestId: string; path: string }> = [];

    hostSocket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as {
        type: string;
        requestId?: string;
        hostId: string;
        payload?: { path?: string };
      };
      if (frame.type !== "http.request" || !frame.requestId || !frame.payload?.path) {
        return;
      }
      requestFrames.push({ requestId: frame.requestId, path: frame.payload.path });
      if (requestFrames.length < 2) {
        return;
      }
      const first = requestFrames[0]!;
      const second = requestFrames[1]!;
      sendHostHttpResponse(hostSocket, host.id, second.requestId, 201, second.path);
      sendHostHttpResponse(hostSocket, host.id, first.requestId, 200, first.path);
    });

    await waitForWebSocketOpen(hostSocket);

    const firstRequest = fetchJson(`${context.baseUrl}/h/${host.id}/api/first`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": context.csrfToken,
      },
      body: JSON.stringify({ message: "first payload" }),
    });
    const secondRequest = fetchJson(`${context.baseUrl}/h/${host.id}/api/second`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": context.csrfToken,
      },
      body: JSON.stringify({ message: "second payload" }),
    });

    const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
    expect(firstResponse.response.status).toBe(200);
    expect(secondResponse.response.status).toBe(201);
    expect(firstResponse.body).toEqual({ path: "/api/first", requestId: expect.any(String) });
    expect(secondResponse.body).toEqual({ path: "/api/second", requestId: expect.any(String) });

    const metadata = JSON.stringify(context.relay.runtime.tunnelRegistry.listFrameMetadata());
    expect(metadata).not.toContain("first payload");
    expect(metadata).not.toContain("second payload");
    expect(metadata).not.toContain("bodyBase64");

    hostSocket.close();
  });

  it("registers a host public key and authenticates the host tunnel with a signed challenge", async () => {
    const context = await startRelay();
    const session = await bootstrapBrowserSession(context);
    const host = context.relay.runtime.store.createHost(session.userId, "Mac Mini");
    const registration = context.relay.runtime.store.rotateHostRegistrationToken(host.id);
    context.relay.runtime.store.createHostGrant(host.id, session.deviceId);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const hostKeyId = "host-key-1";

    const authSocket = await connectAuthenticatedHostSocket({
      context,
      hostId: host.id,
      registrationToken: registration.token,
      hostKeyId,
      publicKeyPem,
      privateKey,
    });

    authSocket.once("message", (data) => {
      const frame = JSON.parse(data.toString()) as {
        requestId?: string;
        payload?: { path?: string };
      };
      if (!frame.requestId) {
        return;
      }
      sendHostHttpResponse(authSocket, host.id, frame.requestId, 200, frame.payload?.path ?? "/");
    });

    const proxied = fetchJson(`${context.baseUrl}/h/${host.id}/api/challenge-ok`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": context.csrfToken,
      },
      body: JSON.stringify({ message: "hello" }),
    });

    const proxiedResponse = await proxied;
    expect(proxiedResponse.response.status).toBe(200);
    expect(proxiedResponse.body.path).toBe("/api/challenge-ok");

    authSocket.close();
  });

  it("lists relay devices and requires step-up before device or host revocation", async () => {
    const context = await startRelay();
    const session = await bootstrapBrowserSession(context);
    context.relay.runtime.store.trustDevice(session.deviceId);

    const secondDevice = context.relay.runtime.store.createDevice(session.userId, "iPad", {
      trustState: "trusted",
    });
    const host = context.relay.runtime.store.createHost(session.userId, "Mac Mini");
    context.relay.runtime.store.createHostGrant(host.id, session.deviceId);

    const listed = await fetchJson(`${context.baseUrl}/api/devices`, {
      headers: {
        cookie: context.cookieJar,
      },
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body.currentDeviceId).toBe(session.deviceId);
    expect(listed.body.devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondDevice.id, status: "active" })]),
    );

    const blockedDeviceRevoke = await fetchJson(
      `${context.baseUrl}/api/devices/${secondDevice.id}/revoke`,
      {
        method: "POST",
        headers: {
          cookie: context.cookieJar,
          "content-type": "application/json",
          "x-relay-csrf": context.csrfToken,
        },
      },
    );
    expect(blockedDeviceRevoke.response.status).toBe(403);

    context.relay.runtime.store.elevateUserSession(session.sessionId, 5 * 60_000);

    const revokedHost = await fetchJson(`${context.baseUrl}/api/hosts/${host.id}/revoke`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(revokedHost.response.status).toBe(200);

    context.relay.runtime.store.elevateUserSession(session.sessionId, 5 * 60_000);

    const revokedDevice = await fetchJson(
      `${context.baseUrl}/api/devices/${secondDevice.id}/revoke`,
      {
        method: "POST",
        headers: {
          cookie: context.cookieJar,
          "content-type": "application/json",
          "x-relay-csrf": context.csrfToken,
        },
      },
    );
    expect(revokedDevice.response.status).toBe(200);
    expect(revokedDevice.body.currentSessionRevoked).toBe(false);
    expect(revokedDevice.body.device.status).toBe("revoked");

    const hostsAfter = await fetchJson(`${context.baseUrl}/api/hosts`, {
      headers: {
        cookie: context.cookieJar,
      },
    });
    expect(hostsAfter.response.status).toBe(200);
    expect(hostsAfter.body.hosts).toEqual([]);
  });

  it("lets a host create and poll a device-code pairing intent without a browser session", async () => {
    const context = await startRelay();

    const created = await fetchJson(`${context.baseUrl}/api/hosts/pairing-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ hostLabel: "Mac Mini" }),
    });
    expect(created.response.status).toBe(200);
    expect(created.body.intent.status).toBe("pending");
    expect(created.body.intent.deviceCode).toMatch(/^\d{4}-\d{4}$/);

    const pendingPoll = await fetchJson(
      `${context.baseUrl}/api/hosts/pairing-intents/${created.body.intent.id}`,
    );
    expect(pendingPoll.response.status).toBe(200);
    expect(pendingPoll.body.intent.status).toBe("pending");
    expect(pendingPoll.body.registrationToken).toBeUndefined();

    await bootstrapBrowserSession(context);
    const approved = await fetchJson(
      `${context.baseUrl}/api/hosts/pairing-intents/${created.body.intent.id}/approve`,
      {
        method: "POST",
        headers: {
          cookie: context.cookieJar,
          "content-type": "application/json",
          "x-relay-csrf": context.csrfToken,
        },
        body: JSON.stringify({ deviceCode: created.body.intent.deviceCode }),
      },
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body.registrationToken.token).toBeTruthy();

    const approvedPoll = await fetchJson(
      `${context.baseUrl}/api/hosts/pairing-intents/${created.body.intent.id}`,
    );
    expect(approvedPoll.response.status).toBe(200);
    expect(approvedPoll.body.intent.status).toBe("approved");
    expect(approvedPoll.body.host.id).toBe(approved.body.host.id);
    expect(approvedPoll.body.registrationToken.token).toBe(approved.body.registrationToken.token);
  });
});

async function startRelay(options?: {
  readonly debugAuthCodes?: boolean;
  readonly emailFrom?: string;
  readonly smtpHost?: string;
  readonly emailSender?: RelayEmailSender | null;
}): Promise<TestContext> {
  const relay = createRelayServer({
    config: {
      publicUrl: new URL("http://127.0.0.1"),
      host: "127.0.0.1",
      port: 0,
      sessionCookieSecret: "relay-test-secret",
      allowedOrigins: ["http://127.0.0.1"],
      debugAuthCodes: options?.debugAuthCodes ?? true,
      ...(options?.emailFrom ? { emailFrom: options.emailFrom } : {}),
      ...(options?.smtpHost ? { smtpHost: options.smtpHost } : {}),
      requestBodyLimitBytes: 1024 * 1024,
      proxyTimeoutMs: 5_000,
    },
    ...(options?.emailSender !== undefined ? { emailSender: options.emailSender } : {}),
  });
  currentRelay = relay;
  const address = await relay.listen(0, "127.0.0.1");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsBaseUrl: `ws://127.0.0.1:${address.port}`,
    cookieJar: "",
    csrfToken: "",
    relay,
  };
}

async function bootstrapBrowserSession(context: TestContext): Promise<{
  userId: string;
  deviceId: string;
  sessionId: string;
}> {
  const csrf = await fetchJson(`${context.baseUrl}/api/auth/csrf`);
  context.cookieJar = mergeCookies(context.cookieJar, setCookieHeader(csrf.response));
  context.csrfToken = csrf.body.csrfToken as string;

  const loginStart = await fetchJson(`${context.baseUrl}/api/auth/login/start`, {
    method: "POST",
    body: JSON.stringify({ email: "owner@example.com", deviceLabel: "iPhone" }),
    headers: {
      "content-type": "application/json",
      cookie: context.cookieJar,
      "x-relay-csrf": context.csrfToken,
    },
  });
  const loginVerify = await fetchJson(`${context.baseUrl}/api/auth/login/verify`, {
    method: "POST",
    body: JSON.stringify({
      challengeId: loginStart.body.challengeId,
      code: loginStart.body.verificationCode,
    }),
    headers: {
      "content-type": "application/json",
      cookie: context.cookieJar,
      "x-relay-csrf": context.csrfToken,
    },
  });
  context.cookieJar = mergeCookies(context.cookieJar, setCookieHeader(loginVerify.response));
  context.csrfToken = loginVerify.body.csrfToken as string;
  return {
    userId: loginVerify.body.user.id as string,
    deviceId: loginVerify.body.device.id as string,
    sessionId: loginVerify.body.session.id as string,
  };
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function connectAuthenticatedHostSocket(input: {
  context: TestContext;
  hostId: string;
  registrationToken: string;
  hostKeyId: string;
  publicKeyPem: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
}): Promise<WebSocket> {
  const registered = await fetchJson(
    `${input.context.baseUrl}/api/hosts/${input.hostId}/public-key`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.registrationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        hostId: input.hostId,
        registrationToken: input.registrationToken,
        hostKeyId: input.hostKeyId,
        publicKeyPem: input.publicKeyPem,
        algorithm: "ed25519",
      }),
    },
  );
  expect(registered.response.status).toBe(200);

  const challenge = await fetchJson(
    `${input.context.baseUrl}/api/hosts/${input.hostId}/tunnel-challenge`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.registrationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        hostId: input.hostId,
        hostKeyId: input.hostKeyId,
      }),
    },
  );
  expect(challenge.response.status).toBe(200);

  const socket = await connectWebSocket(`${input.context.wsBaseUrl}/api/host-tunnel`);
  const authenticated = new Promise<void>((resolve, reject) => {
    socket.once("message", (data) => {
      const body = JSON.parse(data.toString()) as { authenticated?: boolean };
      if (body.authenticated) {
        resolve();
        return;
      }
      reject(new Error("Host tunnel did not authenticate."));
    });
    socket.once("close", () => reject(new Error("Host tunnel closed before authentication.")));
  });
  socket.send(
    JSON.stringify({
      hostId: input.hostId,
      hostKeyId: input.hostKeyId,
      challengeId: challenge.body.challengeId,
      challengeSignature: signPayload(
        null,
        Buffer.from(
          JSON.stringify({
            relayUrl: "http://127.0.0.1",
            hostId: input.hostId,
            hostKeyId: input.hostKeyId,
            challengeId: challenge.body.challengeId,
            nonce: challenge.body.nonce,
          }),
          "utf8",
        ),
        input.privateKey,
      ).toString("base64url"),
    }),
  );
  await authenticated;
  return socket;
}

function waitForWebSocketOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function sendHostHttpResponse(
  socket: WebSocket,
  hostId: string,
  requestId: string,
  statusCode: number,
  path: string,
): void {
  socket.send(
    JSON.stringify({
      version: 1,
      type: "http.response",
      hostId,
      requestId,
      timestamp: new Date().toISOString(),
      payload: {
        statusCode,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        bodyBase64: Buffer.from(JSON.stringify({ path, requestId })).toString("base64"),
        byteCount: Buffer.byteLength(JSON.stringify({ path, requestId }), "utf8"),
      },
    }),
  );
}

function setCookieHeader(response: Response): string[] {
  const rawHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof rawHeaders.getSetCookie === "function") {
    return rawHeaders.getSetCookie();
  }
  const header = response.headers.get("set-cookie");
  if (!header) {
    return [];
  }
  return header.split(/,\s*(?=[^;=]+=[^;]+)/g);
}

function mergeCookies(existing: string, values: readonly string[]): string {
  const cookies = new Map<string, string>();
  for (const entry of existing.split(";")) {
    const part = entry.trim();
    if (!part) {
      continue;
    }
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    cookies.set(part.slice(0, separator), part.slice(separator + 1));
  }
  for (const value of values) {
    const pair = value.split(";")[0]?.trim();
    if (!pair) {
      continue;
    }
    const separator = pair.indexOf("=");
    if (separator < 0) {
      continue;
    }
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}
