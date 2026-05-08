import type { EnvironmentId } from "@wobex/contracts";
import { create } from "zustand";

export type EnvironmentHostConnectionStatus =
  | "offline"
  | "online"
  | "reconnecting"
  | "recovered"
  | "replaying";

export interface EnvironmentHostConnectionState {
  readonly status: EnvironmentHostConnectionStatus;
  readonly reason: string | null;
  readonly updatedAt: string;
}

interface EnvironmentHostConnectionStatusStoreState {
  readonly byId: Record<string, EnvironmentHostConnectionState>;
  readonly patch: (
    environmentId: EnvironmentId,
    status: EnvironmentHostConnectionStatus,
    reason?: string | null,
  ) => void;
  readonly clear: (environmentId: EnvironmentId) => void;
  readonly reset: () => void;
}

function isoNow(): string {
  return new Date().toISOString();
}

export const useEnvironmentHostConnectionStatusStore =
  create<EnvironmentHostConnectionStatusStoreState>((set) => ({
    byId: {},
    patch: (environmentId, status, reason = null) => {
      set((state) => ({
        byId: {
          ...state.byId,
          [environmentId]: {
            status,
            reason,
            updatedAt: isoNow(),
          },
        },
      }));
    },
    clear: (environmentId) => {
      set((state) => {
        const { [environmentId]: _, ...nextById } = state.byId;
        return { byId: nextById };
      });
    },
    reset: () => {
      set({ byId: {} });
    },
  }));

export function selectEnvironmentHostConnectionState(
  environmentId: EnvironmentId | null | undefined,
): EnvironmentHostConnectionState | null {
  if (!environmentId) {
    return null;
  }
  return useEnvironmentHostConnectionStatusStore.getState().byId[environmentId] ?? null;
}
