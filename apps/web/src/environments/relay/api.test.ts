import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startAuthenticationMock, startRegistrationMock } = vi.hoisted(() => ({
  startAuthenticationMock: vi.fn(),
  startRegistrationMock: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: startAuthenticationMock,
  startRegistration: startRegistrationMock,
}));

import {
  bootstrapRelayHostSession,
  fetchRelayHostStatus,
  listRelayDevices,
  listRelayHosts,
  logoutRelaySession,
  registerRelayPasskey,
  revokeRelayDevice,
  revokeRelayHost,
  restoreRelaySession,
  signInRelayWithPasskey,
  startRelayLogin,
  stepUpRelayPasskey,
  verifyRelayLogin,
} from "./api";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "https://relay.example.com",
      },
    },
  });
  vi.restoreAllMocks();
  startAuthenticationMock.mockReset();
  startRegistrationMock.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("relay api helpers", () => {
  it("drives the email login flow, host queries, and bootstrap with cached csrf", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf-1" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: "challenge-1",
            expiresAt: "2026-05-01T12:00:00.000Z",
            deliveryHint: "Sent to name@example.com",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1",
              email: "name@example.com",
            },
            device: {
              id: "device-1",
              label: "Name",
              trustState: "recovery",
            },
            session: {
              id: "session-1",
              authMethod: "email-recovery",
              expiresAt: "2026-05-01T12:10:00.000Z",
            },
            csrfToken: "csrf-2",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1",
              email: "name@example.com",
            },
            device: {
              id: "device-1",
              label: "Name",
              trustState: "trusted",
            },
            session: {
              id: "session-1",
              authMethod: "passkey",
              expiresAt: "2026-05-01T12:15:00.000Z",
              stepUpExpiresAt: "2026-05-01T12:20:00.000Z",
            },
            csrfToken: "csrf-3",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hosts: [
              {
                id: "host-1",
                environmentId: "environment-1",
                label: "Laptop",
                status: "replaying",
                statusReason: "sequence-gap",
                lastSeenAt: "2026-05-01T12:00:00.000Z",
                hostStatusUpdatedAt: "2026-05-01T12:01:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hostId: "host-1",
            environmentId: "environment-1",
            label: "Laptop",
            status: "recovered",
            statusReason: null,
            lastSeenAt: "2026-05-01T12:02:00.000Z",
            hostStatusUpdatedAt: "2026-05-01T12:03:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            currentDeviceId: "device-1",
            devices: [
              {
                id: "device-1",
                label: "iPhone",
                status: "active",
                trustState: "trusted",
                createdAt: "2026-05-01T11:00:00.000Z",
                lastSeenAt: "2026-05-01T12:04:00.000Z",
                trustedAt: "2026-05-01T11:05:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device: {
              id: "device-1",
            },
            currentSessionRevoked: true,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            sessionToken: "host-session-token",
            session: {
              sessionId: "session-1",
              subject: "relay:user-1:device-1",
              role: "client",
              capabilities: ["chat:read", "chat:write"],
              expiresAt: "2026-05-01T12:20:00.000Z",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      startRelayLogin({
        relayBaseUrl: "https://relay.example.com/",
        email: "name@example.com",
      }),
    ).resolves.toMatchObject({
      challengeId: "challenge-1",
      deliveryHint: "Sent to name@example.com",
    });

    await expect(
      verifyRelayLogin({
        relayBaseUrl: "https://relay.example.com/",
        email: "name@example.com",
        code: "123456",
        challengeId: "challenge-1",
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      authMethod: "email-recovery",
      deviceTrustState: "recovery",
      user: {
        email: "name@example.com",
      },
    });

    await expect(
      restoreRelaySession({ relayBaseUrl: "https://relay.example.com/" }),
    ).resolves.toMatchObject({
      authenticated: true,
      authMethod: "passkey",
      deviceTrustState: "trusted",
      stepUpExpiresAt: "2026-05-01T12:20:00.000Z",
    });

    await expect(listRelayHosts({ relayBaseUrl: "https://relay.example.com/" })).resolves.toEqual([
      expect.objectContaining({
        hostId: "host-1",
        status: "replaying",
      }),
    ]);

    await expect(
      fetchRelayHostStatus({
        relayBaseUrl: "https://relay.example.com/",
        hostId: "host-1",
      }),
    ).resolves.toMatchObject({
      hostId: "host-1",
      status: "recovered",
    });

    await expect(listRelayDevices({ relayBaseUrl: "https://relay.example.com/" })).resolves.toEqual(
      [
        expect.objectContaining({
          deviceId: "device-1",
          isCurrent: true,
          trustState: "trusted",
        }),
      ],
    );

    await expect(
      revokeRelayDevice({
        relayBaseUrl: "https://relay.example.com/",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      deviceId: "device-1",
      currentSessionRevoked: true,
    });

    await expect(
      revokeRelayHost({
        relayBaseUrl: "https://relay.example.com/",
        hostId: "host-1",
      }),
    ).resolves.toBeUndefined();

    await expect(
      bootstrapRelayHostSession({
        relayBaseUrl: "https://relay.example.com/",
        hostId: "host-1",
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      sessionToken: "host-session-token",
    });

    await expect(logoutRelaySession({ relayBaseUrl: "https://relay.example.com/" })).resolves.toBe(
      undefined,
    );

    expect(fetchMock.mock.calls).toEqual([
      [
        "https://relay.example.com/api/auth/csrf",
        {
          method: "GET",
          headers: {},
          credentials: "include",
        },
      ],
      [
        "https://relay.example.com/api/auth/login/start",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-relay-csrf": "csrf-1",
          }),
          body: JSON.stringify({ email: "name@example.com" }),
        }),
      ],
      [
        "https://relay.example.com/api/auth/login/verify",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-relay-csrf": "csrf-1",
          }),
        }),
      ],
      [
        "https://relay.example.com/api/me",
        {
          method: "GET",
          headers: {},
          credentials: "include",
        },
      ],
      [
        "https://relay.example.com/api/hosts",
        expect.objectContaining({
          method: "GET",
        }),
      ],
      [
        "https://relay.example.com/api/hosts/host-1/status",
        {
          method: "GET",
          headers: {},
          credentials: "include",
        },
      ],
      [
        "https://relay.example.com/api/devices",
        expect.objectContaining({
          method: "GET",
        }),
      ],
      [
        "https://relay.example.com/api/devices/device-1/revoke",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-relay-csrf": "csrf-3",
          }),
        }),
      ],
      [
        "https://relay.example.com/api/hosts/host-1/revoke",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-relay-csrf": "csrf-3",
          }),
        }),
      ],
      [
        "https://relay.example.com/api/hosts/host-1/bootstrap",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-relay-csrf": "csrf-3",
          }),
          body: JSON.stringify({ scope: "read" }),
        }),
      ],
      [
        "https://relay.example.com/api/auth/logout",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-relay-csrf": "csrf-3",
          }),
        }),
      ],
    ]);
  });

  it("supports passkey registration, passkey login, and write step-up", async () => {
    startRegistrationMock.mockResolvedValue({
      id: "credential-register",
      rawId: "credential-register",
      response: {},
      type: "public-key",
    });
    startAuthenticationMock
      .mockResolvedValueOnce({
        id: "credential-login",
        rawId: "credential-login",
        response: {},
        type: "public-key",
      })
      .mockResolvedValueOnce({
        id: "credential-step-up",
        rawId: "credential-step-up",
        response: {},
        type: "public-key",
      });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf-1" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: "register-1",
            options: { challenge: "register-challenge" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: "login-1",
            options: { challenge: "login-challenge" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1",
              email: "name@example.com",
            },
            device: {
              id: "device-1",
              label: "iPhone",
              trustState: "trusted",
            },
            session: {
              id: "session-1",
              authMethod: "passkey",
              expiresAt: "2026-05-01T12:10:00.000Z",
            },
            csrfToken: "csrf-2",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: "step-up-1",
            options: { challenge: "step-up-challenge" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1",
              email: "name@example.com",
            },
            device: {
              id: "device-1",
              label: "iPhone",
              trustState: "trusted",
            },
            session: {
              id: "session-1",
              authMethod: "passkey",
              expiresAt: "2026-05-01T12:10:00.000Z",
              stepUpExpiresAt: "2026-05-01T12:20:00.000Z",
            },
            csrfToken: "csrf-3",
          }),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      registerRelayPasskey({ relayBaseUrl: "https://relay.example.com/" }),
    ).resolves.toBeUndefined();

    await expect(
      signInRelayWithPasskey({
        relayBaseUrl: "https://relay.example.com/",
        email: "name@example.com",
      }),
    ).resolves.toMatchObject({
      authenticated: true,
      authMethod: "passkey",
      deviceTrustState: "trusted",
    });

    await expect(
      stepUpRelayPasskey({ relayBaseUrl: "https://relay.example.com/" }),
    ).resolves.toMatchObject({
      authenticated: true,
      stepUpExpiresAt: "2026-05-01T12:20:00.000Z",
    });

    expect(startRegistrationMock).toHaveBeenCalledWith({
      optionsJSON: { challenge: "register-challenge" },
    });
    expect(startAuthenticationMock).toHaveBeenNthCalledWith(1, {
      optionsJSON: { challenge: "login-challenge" },
    });
    expect(startAuthenticationMock).toHaveBeenNthCalledWith(2, {
      optionsJSON: { challenge: "step-up-challenge" },
    });
  });

  it("treats an unauthenticated restore as a clean signed-out state", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      ) as typeof fetch;

    await expect(
      restoreRelaySession({ relayBaseUrl: "https://relay.example.com/" }),
    ).resolves.toEqual({
      authenticated: false,
      user: null,
      expiresAt: null,
      role: null,
      authMethod: null,
      deviceTrustState: null,
      stepUpExpiresAt: null,
    });
  });
});
