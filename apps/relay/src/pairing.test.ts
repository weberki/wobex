import { describe, expect, it } from "vitest";

import { HostRegistrationTokenService } from "./hostRegistration";
import { RelayMetadataStore } from "./metadataStore";
import { HostPairingService } from "./pairing";
import { TestClock } from "./testClock";

describe("HostPairingService", () => {
  it("expires pending host pairing intents", () => {
    const clock = new TestClock();
    const store = new RelayMetadataStore(clock);
    const tokens = new HostRegistrationTokenService(clock);
    const service = new HostPairingService(store, tokens, { pairingTtlMs: 1_000 }, clock);

    const user = store.upsertUserByEmail("owner@example.com");
    const created = service.createIntent({
      userId: user.id,
      hostLabel: "Mac Mini",
    });
    expect(service.getIntentStatus(created.intentId)?.state).toBe("pending");

    clock.advanceMs(1_100);
    expect(service.getIntentStatus(created.intentId)?.state).toBe("expired");
    expect(() =>
      service.approveIntent({
        deviceCode: created.deviceCode,
        approvedByUserId: user.id,
      }),
    ).toThrowError("Pairing intent is missing or expired");
  });
});
