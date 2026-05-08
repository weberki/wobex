import { afterEach, describe, expect, it } from "vitest";

import { createRelayServer, type RelayServerHandle } from "./server";
import type { RelayPasskeyProvider } from "./passkeys";

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

describe("relay passkeys", () => {
  it("registers a passkey and marks the current device trusted", async () => {
    const relay = createRelayServer({
      config: {
        publicUrl: "https://code.example.com",
        allowedOrigins: ["https://code.example.com"],
        sessionCookieSecret: "relay-test-secret",
        signingKey: "relay-signing-secret",
      },
      passkeyProvider: makeFakePasskeyProvider(),
    });
    currentRelay = relay;
    const address = await relay.listen(0, "127.0.0.1");
    const context: TestContext = {
      baseUrl: `http://${address.host}:${address.port}`,
      cookieJar: "",
      csrfToken: "",
      relay,
    };

    await bootstrapBrowserSession(context);

    const start = await fetchJson(`${context.baseUrl}/api/auth/passkeys/register/start`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "x-relay-csrf": context.csrfToken,
      },
    });
    expect(start.response.status).toBe(200);
    expect(start.body.challengeId).toBeTruthy();

    const finish = await fetchJson(`${context.baseUrl}/api/auth/passkeys/register/finish`, {
      method: "POST",
      headers: {
        cookie: context.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": context.csrfToken,
      },
      body: JSON.stringify({
        challengeId: start.body.challengeId,
        response: {
          id: "credential-1",
        },
      }),
    });
    expect(finish.response.status).toBe(200);
    expect(finish.body.device.trustState).toBe("trusted");
    expect(finish.body.credential.credentialId).toBe("credential-1");

    const credentials = context.relay.runtime.store.listPasskeyCredentialsForUser(
      finish.body.device.userId,
    );
    expect(credentials).toHaveLength(1);
  });

  it("authenticates with a registered passkey and can elevate the session", async () => {
    const relay = createRelayServer({
      config: {
        publicUrl: "https://code.example.com",
        allowedOrigins: ["https://code.example.com"],
        sessionCookieSecret: "relay-test-secret",
        signingKey: "relay-signing-secret",
      },
      passkeyProvider: makeFakePasskeyProvider(),
    });
    currentRelay = relay;
    const address = await relay.listen(0, "127.0.0.1");
    const context: TestContext = {
      baseUrl: `http://${address.host}:${address.port}`,
      cookieJar: "",
      csrfToken: "",
      relay,
    };

    const bootstrap = await bootstrapBrowserSession(context);
    context.relay.runtime.store.addPasskeyCredential({
      userId: bootstrap.userId,
      deviceId: bootstrap.deviceId,
      webauthnUserId: bootstrap.userId,
      credentialId: "credential-1",
      publicKey: "public-key-1",
      counter: 0,
      transports: ["internal"],
      backedUp: true,
    });

    const anonymous = await bootstrapAnonymousCsrf(context.baseUrl);
    const authStart = await fetchJson(`${context.baseUrl}/api/auth/passkeys/auth/start`, {
      method: "POST",
      headers: {
        cookie: anonymous.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": anonymous.csrfToken,
      },
      body: JSON.stringify({
        email: "owner@example.com",
      }),
    });
    expect(authStart.response.status).toBe(200);
    expect(authStart.body.options.challenge).toBe("auth-challenge");

    const authFinish = await fetchJson(`${context.baseUrl}/api/auth/passkeys/auth/finish`, {
      method: "POST",
      headers: {
        cookie: anonymous.cookieJar,
        "content-type": "application/json",
        "x-relay-csrf": anonymous.csrfToken,
      },
      body: JSON.stringify({
        challengeId: authStart.body.challengeId,
        purpose: "login",
        response: {
          id: "credential-1",
        },
      }),
    });
    expect(authFinish.response.status).toBe(200);
    expect(authFinish.body.session.authMethod).toBe("passkey");

    const authenticatedCookieJar = mergeCookies(
      anonymous.cookieJar,
      setCookieHeader(authFinish.response),
    );
    const stepUpStart = await fetchJson(`${context.baseUrl}/api/auth/passkeys/step-up/start`, {
      method: "POST",
      headers: {
        cookie: authenticatedCookieJar,
        "x-relay-csrf": authFinish.body.csrfToken,
      },
    });
    expect(stepUpStart.response.status).toBe(200);

    const stepUpFinish = await fetchJson(`${context.baseUrl}/api/auth/passkeys/step-up/finish`, {
      method: "POST",
      headers: {
        cookie: authenticatedCookieJar,
        "content-type": "application/json",
        "x-relay-csrf": authFinish.body.csrfToken,
      },
      body: JSON.stringify({
        challengeId: stepUpStart.body.challengeId,
        purpose: "step-up",
        response: {
          id: "credential-1",
        },
      }),
    });
    expect(stepUpFinish.response.status).toBe(200);
    expect(stepUpFinish.body.session.stepUpExpiresAt).toBeTruthy();
  });
});

function makeFakePasskeyProvider(): RelayPasskeyProvider {
  return {
    async beginRegistration() {
      return {
        challenge: "register-challenge",
        options: {
          challenge: "register-challenge",
          rp: {
            name: "Wobex Relay",
            id: "code.example.com",
          },
        },
      };
    },
    async verifyRegistration(input) {
      return {
        credentialId: String((input.response as { id: string }).id),
        publicKey: "public-key-1",
        counter: 0,
        transports: ["internal"],
        backedUp: true,
      };
    },
    async beginAuthentication(input) {
      return {
        challenge: "auth-challenge",
        options: {
          challenge: "auth-challenge",
          allowCredentials: input.allowCredentialIds.map((id) => ({ id })),
        },
      };
    },
    async verifyAuthentication(input) {
      return {
        credentialId: String((input.response as { id: string }).id),
        newCounter: 1,
        backedUp: true,
      };
    },
  };
}

async function bootstrapBrowserSession(context: TestContext) {
  const anonymous = await bootstrapAnonymousCsrf(context.baseUrl);
  context.cookieJar = anonymous.cookieJar;
  context.csrfToken = anonymous.csrfToken;

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

async function bootstrapAnonymousCsrf(baseUrl: string) {
  const csrf = await fetchJson(`${baseUrl}/api/auth/csrf`);
  return {
    cookieJar: mergeCookies("", setCookieHeader(csrf.response)),
    csrfToken: csrf.body.csrfToken as string,
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
