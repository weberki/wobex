import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RelayHostListItem,
  RelayHostPairingPollResult,
  RelayHostPublicKeyRegistrationInput,
  RelayHostPublicKeyRegistrationResult,
  RelayHostTunnelChallengeInput,
  RelayHostTunnelChallengeResult,
  RelayHostTunnelAuthInput,
  RelayHostTunnelAuthResult,
  RelayApproveHostPairingIntentResult,
  RelayAuditEvent,
  RelayBootstrapHostSessionInput,
  RelayListDevicesResult,
  RelayPasskeyAuthenticationFinishInput,
  RelayPasskeyAuthenticationStartInput,
  RelayPasskeyAuthenticationStartResult,
  RelayPasskeyRegistrationFinishInput,
  RelayPasskeyRegistrationStartResult,
  RelayRevokeDeviceInput,
  RelayRevokeDeviceResult,
  RelayHostTunnelFrame,
  RelayRemoteSessionBootstrapResult,
  RelayRemoteSessionClaim,
  RelaySignedRemoteSessionClaim,
} from "./relay";

const decodeTunnelFrame = Schema.decodeUnknownSync(RelayHostTunnelFrame);
const decodeAuditEvent = Schema.decodeUnknownSync(RelayAuditEvent);
const decodeApproveResult = Schema.decodeUnknownSync(RelayApproveHostPairingIntentResult);
const decodeHostTunnelAuthInput = Schema.decodeUnknownSync(RelayHostTunnelAuthInput);
const decodeHostTunnelAuthResult = Schema.decodeUnknownSync(RelayHostTunnelAuthResult);
const decodeRemoteSessionClaim = Schema.decodeUnknownSync(RelayRemoteSessionClaim);
const decodeSignedRemoteSessionClaim = Schema.decodeUnknownSync(RelaySignedRemoteSessionClaim);
const decodeRemoteSessionBootstrapResult = Schema.decodeUnknownSync(
  RelayRemoteSessionBootstrapResult,
);
const decodeHostPairingPollResult = Schema.decodeUnknownSync(RelayHostPairingPollResult);
const decodeHostListItem = Schema.decodeUnknownSync(RelayHostListItem);
const decodeHostKeyRegistrationInput = Schema.decodeUnknownSync(
  RelayHostPublicKeyRegistrationInput,
);
const decodeHostKeyRegistrationResult = Schema.decodeUnknownSync(
  RelayHostPublicKeyRegistrationResult,
);
const decodeHostTunnelChallengeInput = Schema.decodeUnknownSync(RelayHostTunnelChallengeInput);
const decodeHostTunnelChallengeResult = Schema.decodeUnknownSync(RelayHostTunnelChallengeResult);
const decodeBootstrapHostSessionInput = Schema.decodeUnknownSync(RelayBootstrapHostSessionInput);
const decodePasskeyAuthStartInput = Schema.decodeUnknownSync(RelayPasskeyAuthenticationStartInput);
const decodePasskeyAuthStartResult = Schema.decodeUnknownSync(
  RelayPasskeyAuthenticationStartResult,
);
const decodePasskeyAuthFinishInput = Schema.decodeUnknownSync(
  RelayPasskeyAuthenticationFinishInput,
);
const decodePasskeyRegistrationStartResult = Schema.decodeUnknownSync(
  RelayPasskeyRegistrationStartResult,
);
const decodePasskeyRegistrationFinishInput = Schema.decodeUnknownSync(
  RelayPasskeyRegistrationFinishInput,
);
const decodeListDevicesResult = Schema.decodeUnknownSync(RelayListDevicesResult);
const decodeRevokeDeviceInput = Schema.decodeUnknownSync(RelayRevokeDeviceInput);
const decodeRevokeDeviceResult = Schema.decodeUnknownSync(RelayRevokeDeviceResult);

describe("Relay contracts", () => {
  it("decodes HTTP tunnel request frames without requiring payload persistence fields", () => {
    const parsed = decodeTunnelFrame({
      version: 1,
      type: "http.request",
      hostId: "host-1",
      deviceId: "device-1",
      requestId: "request-1",
      timestamp: "2026-04-15T10:00:00.000Z",
      payload: {
        method: "POST",
        path: "/api/auth/bootstrap/bearer",
        headers: {
          "content-type": "application/json",
        },
        bodyBase64: "e30=",
        timeoutMs: 5000,
      },
    });

    expect(parsed.type).toBe("http.request");
    if (parsed.type !== "http.request") {
      throw new Error("expected http.request");
    }
    expect(parsed.payload.path).toBe("/api/auth/bootstrap/bearer");
  });

  it("decodes host recovery states for mobile dashboards", () => {
    const parsed = decodeTunnelFrame({
      version: 1,
      type: "host.status",
      hostId: "host-1",
      timestamp: "2026-04-15T10:00:00.000Z",
      payload: {
        status: "replaying",
        detail: "snapshot loaded, replaying event log",
      },
    });

    expect(parsed.type).toBe("host.status");
    if (parsed.type !== "host.status") {
      throw new Error("expected host.status");
    }
    expect(parsed.payload.status).toBe("replaying");
  });

  it("rejects invalid WebSocket tunnel frame directions", () => {
    expect(() =>
      decodeTunnelFrame({
        version: 1,
        type: "ws.message",
        hostId: "host-1",
        streamId: "stream-1",
        timestamp: "2026-04-15T10:00:00.000Z",
        payload: {
          direction: "relay-to-database",
          isBinary: false,
          data: "{}",
        },
      }),
    ).toThrow();
  });

  it("keeps audit events metadata-only at the schema boundary", () => {
    const parsed = decodeAuditEvent({
      id: "audit-1",
      action: "host.tunnel.connected",
      userId: "user-1",
      deviceId: "device-1",
      hostId: "host-1",
      createdAt: "2026-04-15T10:00:00.000Z",
      metadata: {
        requestId: "request-1",
        statusCode: 101,
        byteCount: 0,
      },
    });

    expect(parsed.metadata).toEqual({
      requestId: "request-1",
      statusCode: 101,
      byteCount: 0,
    });
  });

  it("models Agent-control grants on host registration approval", () => {
    const parsed = decodeApproveResult({
      host: {
        id: "host-1",
        ownerUserId: "user-1",
        label: "Mac Mini",
        status: "online",
        lastSeenAt: "2026-04-15T10:00:00.000Z",
        createdAt: "2026-04-15T10:00:00.000Z",
        updatedAt: "2026-04-15T10:00:00.000Z",
      },
      registrationToken: {
        tokenId: "token-1",
        token: "relay_host_token",
        expiresAt: "2026-04-15T10:15:00.000Z",
      },
    });

    expect(parsed.host.label).toBe("Mac Mini");
    expect(parsed.registrationToken.tokenId).toBe("token-1");
  });

  it("decodes relay host tunnel auth and host list item metadata", () => {
    const host = decodeHostListItem({
      id: "host-1",
      ownerUserId: "user-1",
      label: "Mac Mini",
      status: "online",
      lastSeenAt: "2026-04-15T10:00:00.000Z",
      createdAt: "2026-04-15T10:00:00.000Z",
      updatedAt: "2026-04-15T10:00:00.000Z",
      activeGrantCount: 2,
    });

    const input = decodeHostTunnelAuthInput({
      hostId: "host-1",
      hostKeyId: "host-key-1",
      challengeId: "challenge-1",
      challengeSignature: "signed-challenge",
      relayUrl: "https://code.example.com",
      reconnectAttempt: 1,
    });

    const result = decodeHostTunnelAuthResult({
      authenticated: true,
      host,
      connectedAt: "2026-04-15T10:00:00.000Z",
    });

    expect(input.hostId).toBe("host-1");
    expect(result.authenticated).toBe(true);
    expect(result.host.activeGrantCount).toBe(2);
  });

  it("decodes relay remote session claim and bootstrap result", () => {
    const claim = decodeRemoteSessionClaim({
      version: 1,
      hostId: "host-1",
      userId: "user-1",
      deviceId: "device-1",
      grantId: "grant-1",
      subject: "relay:user-1:device-1",
      role: "client",
      capabilities: ["chat:read", "chat:write", "approvals:respond"],
      issuedAt: "2026-04-15T10:00:00.000Z",
      expiresAt: "2026-04-15T10:15:00.000Z",
    });

    const bootstrap = decodeRemoteSessionBootstrapResult({
      authenticated: true,
      sessionToken: "relay-session-token",
      session: {
        sessionId: "session-1",
        subject: claim.subject,
        hostId: claim.hostId,
        userId: claim.userId,
        deviceId: claim.deviceId,
        grantId: claim.grantId,
        role: claim.role,
        capabilities: claim.capabilities,
        issuedAt: claim.issuedAt,
        expiresAt: claim.expiresAt,
      },
    });

    expect(bootstrap.session.sessionId).toBe("session-1");
    expect(bootstrap.session.subject).toBe("relay:user-1:device-1");
  });

  it("decodes signed relay remote session claims and scoped host bootstrap input", () => {
    const signedClaim = decodeSignedRemoteSessionClaim({
      keyId: "relay-key-1",
      signature: "signature-1",
      claim: {
        version: 1,
        hostId: "host-1",
        userId: "user-1",
        deviceId: "device-1",
        grantId: "grant-1",
        subject: "relay:user-1:device-1",
        role: "client",
        capabilities: ["chat:read", "chat:write"],
        issuedAt: "2026-04-15T10:00:00.000Z",
        expiresAt: "2026-04-15T10:05:00.000Z",
      },
    });

    const bootstrap = decodeBootstrapHostSessionInput({
      scope: "write",
    });

    expect(signedClaim.keyId).toBe("relay-key-1");
    expect(bootstrap.scope).toBe("write");
  });

  it("decodes host public-key registration and tunnel challenges", () => {
    const registration = decodeHostKeyRegistrationInput({
      hostId: "host-1",
      registrationToken: "relay-token-1",
      hostKeyId: "host-key-1",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----",
      algorithm: "ed25519",
    });

    const result = decodeHostKeyRegistrationResult({
      hostId: "host-1",
      hostKeyId: "host-key-1",
      trustedRelaySigningKeyId: "relay-key-1",
      trustedRelaySigningKey: "relay-signing-secret",
    });

    const challengeInput = decodeHostTunnelChallengeInput({
      hostId: "host-1",
      hostKeyId: "host-key-1",
    });

    const challengeResult = decodeHostTunnelChallengeResult({
      challengeId: "challenge-1",
      nonce: "nonce-1",
      expiresAt: "2026-04-15T10:05:00.000Z",
    });

    expect(registration.algorithm).toBe("ed25519");
    expect(result.hostKeyId).toBe("host-key-1");
    expect(challengeInput.hostId).toBe("host-1");
    expect(challengeResult.challengeId).toBe("challenge-1");
  });

  it("decodes passkey login and registration ceremony payloads", () => {
    const authStart = decodePasskeyAuthStartInput({
      email: "name@example.com",
      purpose: "login",
    });

    const authStartResult = decodePasskeyAuthStartResult({
      challengeId: "challenge-1",
      purpose: "login",
      options: {
        challenge: "base64-challenge",
      },
    });

    const authFinish = decodePasskeyAuthFinishInput({
      challengeId: "challenge-1",
      purpose: "step-up",
      response: {
        id: "credential-1",
      },
    });

    const registerStart = decodePasskeyRegistrationStartResult({
      challengeId: "challenge-2",
      options: {
        challenge: "base64-register-challenge",
      },
    });

    const registerFinish = decodePasskeyRegistrationFinishInput({
      challengeId: "challenge-2",
      response: {
        id: "credential-1",
      },
    });

    expect(authStart.purpose).toBe("login");
    expect(authStartResult.purpose).toBe("login");
    expect(authFinish.purpose).toBe("step-up");
    expect(registerStart.challengeId).toBe("challenge-2");
    expect(registerFinish.challengeId).toBe("challenge-2");
  });

  it("decodes relay device listing and revocation payloads", () => {
    const list = decodeListDevicesResult({
      currentDeviceId: "device-1",
      devices: [
        {
          id: "device-1",
          userId: "user-1",
          label: "iPhone",
          status: "active",
          trustState: "trusted",
          createdAt: "2026-04-15T10:00:00.000Z",
          lastSeenAt: "2026-04-15T10:05:00.000Z",
          trustedAt: "2026-04-15T10:01:00.000Z",
        },
      ],
    });

    const revokeInput = decodeRevokeDeviceInput({
      deviceId: "device-1",
    });

    const revokeResult = decodeRevokeDeviceResult({
      currentSessionRevoked: true,
      device: {
        id: "device-1",
        userId: "user-1",
        label: "iPhone",
        status: "revoked",
        trustState: "revoked",
        createdAt: "2026-04-15T10:00:00.000Z",
        lastSeenAt: "2026-04-15T10:05:00.000Z",
        trustedAt: "2026-04-15T10:01:00.000Z",
      },
    });

    expect(list.currentDeviceId).toBe("device-1");
    expect(revokeInput.deviceId).toBe("device-1");
    expect(revokeResult.currentSessionRevoked).toBe(true);
    expect(revokeResult.device.status).toBe("revoked");
  });

  it("decodes host pairing poll results with approved metadata", () => {
    const parsed = decodeHostPairingPollResult({
      intent: {
        id: "pair-1",
        requestedByUserId: "user-1",
        hostId: "host-1",
        deviceCode: "ABCD-EFGH",
        status: "approved",
        createdAt: "2026-04-15T10:00:00.000Z",
        expiresAt: "2026-04-15T10:15:00.000Z",
        approvedAt: "2026-04-15T10:05:00.000Z",
        approvedByUserId: "user-1",
      },
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
      registrationToken: {
        tokenId: "token-1",
        token: "relay_host_token",
        expiresAt: "2026-04-15T10:15:00.000Z",
      },
    });

    expect(parsed.intent.status).toBe("approved");
    expect(parsed.registrationToken?.tokenId).toBe("token-1");
  });
});
