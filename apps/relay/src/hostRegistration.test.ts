import { describe, expect, it } from "vitest";

import { HostRegistrationTokenService } from "./hostRegistration";
import { TestClock } from "./testClock";

describe("HostRegistrationTokenService", () => {
  it("rotates host tokens and invalidates previous token", () => {
    const clock = new TestClock();
    const service = new HostRegistrationTokenService(clock);

    const issued = service.issue("host-1");
    expect(service.validate("host-1", issued.token)).toEqual({
      tokenId: issued.tokenId,
    });

    const rotated = service.rotate("host-1");
    expect(rotated.previousTokenId).toBe(issued.tokenId);
    expect(service.validate("host-1", issued.token)).toBeNull();
    expect(service.validate("host-1", rotated.token)).toEqual({
      tokenId: rotated.tokenId,
    });
  });

  it("revokes host token by host id", () => {
    const clock = new TestClock();
    const service = new HostRegistrationTokenService(clock);

    const issued = service.issue("host-2");
    expect(service.validate("host-2", issued.token)).toEqual({
      tokenId: issued.tokenId,
    });

    service.revokeByHost("host-2");
    expect(service.validate("host-2", issued.token)).toBeNull();
  });
});
