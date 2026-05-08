import { EnvironmentId } from "@wobex/contracts";
import { describe, expect, it } from "vitest";

import { resolveMobileHostStatus } from "./MobileHostControlDashboard.logic";

describe("resolveMobileHostStatus", () => {
  const environmentId = EnvironmentId.make("env-1");

  it("prioritizes websocket reconnect state before host recovery state", () => {
    expect(
      resolveMobileHostStatus({
        environmentId,
        wsUiState: "reconnecting",
        hostConnectionState: {
          status: "replaying",
          reason: "resubscribe",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      }),
    ).toMatchObject({ label: "Reconnecting", isReachable: false });
  });

  it("shows replay recovery while the websocket is connected", () => {
    expect(
      resolveMobileHostStatus({
        environmentId,
        wsUiState: "connected",
        hostConnectionState: {
          status: "replaying",
          reason: "sequence-gap",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      }),
    ).toEqual({
      label: "Replaying",
      detail: "Catching up missed host events",
      isReachable: true,
    });
  });

  it("shows recovered and offline host states when the host projection changes", () => {
    expect(
      resolveMobileHostStatus({
        environmentId,
        wsUiState: "connected",
        hostConnectionState: {
          status: "recovered",
          reason: null,
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      }),
    ).toEqual({
      label: "Recovered",
      detail: "Host state caught up",
      isReachable: true,
    });

    expect(
      resolveMobileHostStatus({
        environmentId,
        wsUiState: "connected",
        hostConnectionState: {
          status: "offline",
          reason: "host tunnel closed",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      }),
    ).toEqual({
      label: "Offline",
      detail: "host tunnel closed",
      isReachable: false,
    });
  });

  it("shows a reconnecting banner for a reconnecting websocket before host state", () => {
    expect(
      resolveMobileHostStatus({
        environmentId,
        wsUiState: "connecting",
        hostConnectionState: {
          status: "replaying",
          reason: "resubscribe",
          updatedAt: "2026-04-13T00:00:00.000Z",
        },
      }),
    ).toEqual({
      label: "Connecting",
      detail: "env-1",
      isReachable: false,
    });
  });

  it("falls back to online for connected hosts without a runtime projection", () => {
    expect(
      resolveMobileHostStatus({
        environmentId,
        wsUiState: "connected",
        hostConnectionState: null,
      }),
    ).toEqual({
      label: "Online",
      detail: "env-1",
      isReachable: true,
    });
  });
});
