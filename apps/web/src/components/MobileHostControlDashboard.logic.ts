import type { EnvironmentId } from "@wobex/contracts";

import type { EnvironmentHostConnectionState } from "../environments/runtime";
import type { WsConnectionUiState } from "../rpc/wsConnectionState";

export interface MobileHostStatusSummary {
  readonly label: string;
  readonly detail: string;
  readonly isReachable: boolean;
}

export function resolveMobileHostStatus(input: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly hostConnectionState: EnvironmentHostConnectionState | null;
  readonly wsUiState: WsConnectionUiState;
}): MobileHostStatusSummary {
  const environmentLabel = input.environmentId ?? "No environment yet";

  if (input.wsUiState !== "connected") {
    switch (input.wsUiState) {
      case "connecting":
        return { label: "Connecting", detail: environmentLabel, isReachable: false };
      case "reconnecting":
        return { label: "Reconnecting", detail: environmentLabel, isReachable: false };
      case "offline":
        return { label: "Offline", detail: environmentLabel, isReachable: false };
      case "error":
        return { label: "Needs reconnect", detail: environmentLabel, isReachable: false };
    }
  }

  switch (input.hostConnectionState?.status) {
    case "reconnecting":
      return { label: "Reconnecting", detail: "Reopening host connection", isReachable: false };
    case "replaying":
      return { label: "Replaying", detail: "Catching up missed host events", isReachable: true };
    case "recovered":
      return { label: "Recovered", detail: "Host state caught up", isReachable: true };
    case "offline":
      return {
        label: "Offline",
        detail: input.hostConnectionState.reason ?? environmentLabel,
        isReachable: false,
      };
    case "online":
    case undefined:
      return { label: "Online", detail: environmentLabel, isReachable: true };
  }
}
