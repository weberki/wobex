import { describe, expect, it } from "vitest";

import { assertMetadataOnly, RelayMetadataStore } from "./metadataStore";
import type { Clock } from "./time";

const fixedClock = (iso: string): Clock => ({
  now: () => new Date(iso),
});

describe("RelayMetadataStore", () => {
  it("verifies passwordless login challenges and stores only hashed session tokens", () => {
    const store = new RelayMetadataStore(fixedClock("2026-04-15T10:00:00.000Z"));

    const login = store.startLogin("USER@example.com", "iPhone");
    const verified = store.verifyLogin(login.challenge.id, login.code);

    expect(verified.user.email).toBe("user@example.com");
    expect(verified.device.label).toBe("iPhone");
    expect(verified.session.tokenHash).not.toBe(verified.sessionToken);
    expect(store.verifyUserSession(verified.session.id, verified.sessionToken)?.id).toBe(
      verified.session.id,
    );
    expect(store.verifyUserSession(verified.session.id, "wrong-token")).toBeUndefined();
  });

  it("creates and approves host pairing intents with rotatable host tokens", () => {
    const store = new RelayMetadataStore(fixedClock("2026-04-15T10:00:00.000Z"));
    const user = store.upsertUserByEmail("owner@example.com");
    const intent = store.createHostPairingIntent(user.id, "Mac Mini");

    const approved = store.approveHostPairingIntent(intent.intent.id, intent.deviceCode, user.id);

    expect(approved.host.label).toBe("Mac Mini");
    expect(approved.registrationToken.tokenHash).not.toBe(approved.token);
    expect(store.verifyHostRegistrationToken(approved.host.id, approved.token)?.id).toBe(
      approved.registrationToken.id,
    );

    const rotated = store.rotateHostRegistrationToken(approved.host.id);
    expect(store.verifyHostRegistrationToken(approved.host.id, approved.token)).toBeUndefined();
    expect(store.verifyHostRegistrationToken(approved.host.id, rotated.token)?.id).toBe(
      rotated.registrationToken.id,
    );
  });

  it("revokes device sessions and host tokens", () => {
    const store = new RelayMetadataStore(fixedClock("2026-04-15T10:00:00.000Z"));
    const login = store.startLogin("user@example.com", "Phone");
    const verified = store.verifyLogin(login.challenge.id, login.code);
    const host = store.createHost(verified.user.id, "MacBook");
    const token = store.rotateHostRegistrationToken(host.id);

    expect(store.verifyUserSession(verified.session.id, verified.sessionToken)).toBeDefined();
    expect(store.verifyHostRegistrationToken(host.id, token.token)).toBeDefined();

    store.revokeDevice(verified.device.id);
    store.revokeHost(host.id);

    expect(store.verifyUserSession(verified.session.id, verified.sessionToken)).toBeUndefined();
    expect(store.verifyHostRegistrationToken(host.id, token.token)).toBeUndefined();
  });

  it("hydrates a complete metadata snapshot", () => {
    const source = new RelayMetadataStore(fixedClock("2026-04-15T10:00:00.000Z"));
    const login = source.startLogin("user@example.com", "Phone");
    const verified = source.verifyLogin(login.challenge.id, login.code);
    const host = source.createHost(verified.user.id, "Mac Mini");
    const grant = source.createHostGrant(host.id, verified.device.id);
    source.setHostStatus(host.id, "online", "connection-1");

    const restored = new RelayMetadataStore(fixedClock("2026-04-15T10:05:00.000Z"));
    restored.hydrate(source.snapshot());

    expect(restored.getUserById(verified.user.id)?.email).toBe("user@example.com");
    expect(restored.getDeviceById(verified.device.id)?.label).toBe("Phone");
    expect(restored.getHostById(host.id)?.label).toBe("Mac Mini");
    expect(restored.getHostStatus(host.id)?.connectionId).toBe("connection-1");
    expect(restored.listHostGrantsForDevice(verified.device.id)[0]?.id).toBe(grant.id);
  });

  it("rejects audit metadata keys that can contain proxied content", () => {
    expect(() => assertMetadataOnly({ requestId: "request-1", byteCount: 12 })).not.toThrow();
    expect(() => assertMetadataOnly({ prompt: "do not store this" })).toThrow(
      /may contain content/,
    );
    expect(() => assertMetadataOnly({ nested: { status: "bad" } })).toThrow(/must be scalar/);
  });
});
