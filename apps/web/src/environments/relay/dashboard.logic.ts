import type { EnvironmentId } from "@wobex/contracts";

import type { EnvironmentHostConnectionState } from "../runtime";
import {
  resolveMobileHostStatus,
  type MobileHostStatusSummary,
} from "../../components/MobileHostControlDashboard.logic";
import { resolveRelayEnvironmentTarget } from "./target";
import type { RelayHostListItem } from "./api";

export interface RelayHostPickerEntry {
  readonly environmentId: EnvironmentId;
  readonly hostId: string;
  readonly label: string;
  readonly targetHttpBaseUrl: string;
  readonly targetWsBaseUrl: string;
  readonly status: MobileHostStatusSummary;
}

function resolveRelayConnectionState(input: {
  readonly host: RelayHostListItem;
  readonly hostConnectionState: EnvironmentHostConnectionState | null;
}): EnvironmentHostConnectionState {
  return (
    input.hostConnectionState ?? {
      status: input.host.status,
      reason: input.host.statusReason,
      updatedAt:
        input.host.hostStatusUpdatedAt ?? input.host.lastSeenAt ?? new Date().toISOString(),
    }
  );
}

export function resolveRelayHostPickerEntry(input: {
  readonly host: RelayHostListItem;
  readonly hostConnectionState: EnvironmentHostConnectionState | null;
  readonly relayBaseUrl?: string;
  readonly sessionAuthenticated: boolean;
}): RelayHostPickerEntry {
  const relayTarget = resolveRelayEnvironmentTarget({
    hostId: input.host.hostId,
    relayBaseUrl: input.relayBaseUrl,
  });
  const connectionState = resolveRelayConnectionState({
    host: input.host,
    hostConnectionState: input.hostConnectionState,
  });
  const status = resolveMobileHostStatus({
    environmentId: input.host.environmentId,
    hostConnectionState: connectionState,
    wsUiState: input.sessionAuthenticated ? "connected" : "offline",
  });

  return {
    hostId: input.host.hostId,
    environmentId: input.host.environmentId,
    label: input.host.label,
    targetHttpBaseUrl: relayTarget.httpBaseUrl,
    targetWsBaseUrl: relayTarget.wsBaseUrl,
    status,
  };
}
