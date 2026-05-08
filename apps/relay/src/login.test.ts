import { describe, expect, it } from "vitest";

import { PasswordlessLoginService } from "./login";
import { RelayMetadataStore } from "./metadataStore";
import { TestClock } from "./testClock";

describe("PasswordlessLoginService", () => {
  it("issues a challenge and validates a session token", () => {
    const clock = new TestClock();
    const store = new RelayMetadataStore(clock);
    const login = new PasswordlessLoginService(store, {}, clock);

    const started = login.startLogin("Dev@Example.com");
    expect(started.email).toBe("dev@example.com");

    const verified = login.verifyLogin(started.challengeId, started.verificationToken, "iPhone");
    expect(verified.userId).toBe(started.userId);
    expect(verified.sessionToken.length).toBeGreaterThan(10);

    const session = login.validateSession(verified.sessionId, verified.sessionToken);
    expect(session).toEqual({ userId: started.userId });

    login.revokeSession(verified.sessionId);
    const revoked = login.validateSession(verified.sessionId, verified.sessionToken);
    expect(revoked).toBeNull();
  });

  it("rejects expired login challenges", () => {
    const clock = new TestClock();
    const store = new RelayMetadataStore(clock);
    const login = new PasswordlessLoginService(store, { challengeTtlMs: 1_000 }, clock);
    const started = login.startLogin("dev@example.com");
    clock.advanceMs(1_001);

    expect(() => login.verifyLogin(started.challengeId, started.verificationToken)).toThrowError(
      "Invalid or expired login challenge",
    );
  });
});
