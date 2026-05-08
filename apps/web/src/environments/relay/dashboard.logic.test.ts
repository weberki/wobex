import { EnvironmentId } from "@wobex/contracts";
import { describe, expect, it } from "vitest";

import { resolveRelayHostPickerEntry } from "./dashboard.logic";

describe("resolveRelayHostPickerEntry", () => {
  const environmentId = EnvironmentId.make("environment-1");

  it("builds relay host targets and status summaries", () => {
    expect(
      resolveRelayHostPickerEntry({
        sessionAuthenticated: true,
        relayBaseUrl: "https://relay.example.com/",
        host: {
          hostId: "host-1",
          environmentId,
          label: "Laptop",
          status: "replaying",
          statusReason: "sequence-gap",
          lastSeenAt: "2026-05-01T12:00:00.000Z",
          hostStatusUpdatedAt: "2026-05-01T12:01:00.000Z",
        },
        hostConnectionState: null,
      }),
    ).toMatchObject({
      hostId: "host-1",
      environmentId,
      label: "Laptop",
      targetHttpBaseUrl: "https://relay.example.com/h/host-1/",
      targetWsBaseUrl: "wss://relay.example.com/h/host-1/ws",
      status: {
        label: "Replaying",
        detail: "Catching up missed host events",
        isReachable: true,
      },
    });
  });

  it("lets runtime host state override the snapshot status", () => {
    expect(
      resolveRelayHostPickerEntry({
        sessionAuthenticated: true,
        relayBaseUrl: "https://relay.example.com/",
        host: {
          hostId: "host-1",
          environmentId,
          label: "Laptop",
          status: "online",
          statusReason: null,
          lastSeenAt: "2026-05-01T12:00:00.000Z",
          hostStatusUpdatedAt: "2026-05-01T12:01:00.000Z",
        },
        hostConnectionState: {
          status: "offline",
          reason: "host tunnel closed",
          updatedAt: "2026-05-01T12:02:00.000Z",
        },
      }),
    ).toMatchObject({
      status: {
        label: "Offline",
        detail: "host tunnel closed",
        isReachable: false,
      },
    });
  });
});
