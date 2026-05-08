import { describe, expect, it } from "vitest";

import { isRelayEnvironmentTarget, resolveRelayEnvironmentTarget } from "./target";

describe("resolveRelayEnvironmentTarget", () => {
  it("derives relay host http and websocket targets from a host id", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          origin: "https://relay.example.com",
        },
      },
    });

    expect(
      resolveRelayEnvironmentTarget({
        hostId: "host-1",
        relayBaseUrl: undefined,
      }),
    ).toEqual({
      hostId: "host-1",
      relayBaseUrl: "https://relay.example.com/",
      httpBaseUrl: "https://relay.example.com/h/host-1/",
      wsBaseUrl: "wss://relay.example.com/h/host-1/ws",
    });
  });

  it("detects relay host targets from saved environment urls", () => {
    expect(
      isRelayEnvironmentTarget({
        httpBaseUrl: "https://relay.example.com/h/host-1/",
        wsBaseUrl: "wss://relay.example.com/h/host-1/ws",
      }),
    ).toBe(true);

    expect(
      isRelayEnvironmentTarget({
        httpBaseUrl: "https://remote.example.com/",
        wsBaseUrl: "wss://remote.example.com/",
      }),
    ).toBe(false);
  });
});
