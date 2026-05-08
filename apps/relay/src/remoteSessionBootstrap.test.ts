import { afterEach, describe, expect, it } from "vitest";

import { createRelayServer, type RelayServerHandle } from "./server";

interface TestContext {
  baseUrl: string;
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

describe("relay remote session bootstrap", () => {
  it("requires a fresh write elevation before issuing write-scoped host bootstrap sessions", async () => {
    const context = await startRelay();
    const session = await bootstrapBrowserSession(context);
    const host = context.relay.runtime.store.createHost(session.userId, "Mac Mini");
    context.relay.runtime.store.createHostGrant(host.id, session.deviceId);

    const denied = await fetchJson(`${context.baseUrl}/api/hosts/${host.id}/bootstrap`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": context.csrfToken,
      },
      body: JSON.stringify({ scope: "write" }),
    });

    expect(denied.response.status).toBe(403);
  });
});

async function startRelay(): Promise<TestContext> {
  const relay = createRelayServer({
    config: {
      publicUrl: new URL("http://127.0.0.1"),
      host: "127.0.0.1",
      port: 0,
      sessionCookieSecret: "relay-test-secret",
      allowedOrigins: ["http://127.0.0.1"],
      debugAuthCodes: true,
      requestBodyLimitBytes: 1024 * 1024,
      proxyTimeoutMs: 5_000,
    },
  });
  currentRelay = relay;
  const address = await relay.listen(0, "127.0.0.1");
  return {
    baseUrl: `http://${address.host}:${address.port}`,
    cookieJar: "",
    csrfToken: "",
    relay,
  };
}

async function bootstrapBrowserSession(context: TestContext) {
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
  };
}

async function fetchJson(
  input: string,
  init?: Parameters<typeof fetch>[1],
): Promise<{ response: Response; body: any }> {
  const response = await fetch(input, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

function setCookieHeader(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

function mergeCookies(current: string, nextHeader: string): string {
  const jar = new Map<string, string>();
  for (const source of [current, nextHeader]) {
    for (const part of source.split(/,(?=[^;]+?=)|; /)) {
      const match = /^([^=,\s]+)=([^;]+)/.exec(part.trim());
      if (!match) {
        continue;
      }
      jar.set(match[1]!, match[2]!);
    }
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}
