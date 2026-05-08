import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface PinnedThreadsStoreState {
  pinnedThreadKeys: string[];
  pinThread: (threadKey: string) => void;
  unpinThread: (threadKey: string) => void;
  togglePinnedThread: (threadKey: string) => void;
  prunePinnedThreads: (threadKeys: readonly string[]) => void;
}

const PINNED_THREADS_STORAGE_KEY = "Wobex:pinned-thread-keys:v1";

function normalizePinnedThreadKeys(threadKeys: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const threadKey of threadKeys) {
    const trimmed = threadKey.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export const usePinnedThreadsStore = create<PinnedThreadsStoreState>()(
  persist(
    (set) => ({
      pinnedThreadKeys: [],
      pinThread: (threadKey) => {
        const trimmed = threadKey.trim();
        if (trimmed.length === 0) return;
        set((state) => {
          if (state.pinnedThreadKeys.includes(trimmed)) {
            return state;
          }
          return {
            pinnedThreadKeys: [trimmed, ...state.pinnedThreadKeys],
          };
        });
      },
      unpinThread: (threadKey) => {
        const trimmed = threadKey.trim();
        if (trimmed.length === 0) return;
        set((state) => {
          if (!state.pinnedThreadKeys.includes(trimmed)) {
            return state;
          }
          return {
            pinnedThreadKeys: state.pinnedThreadKeys.filter((candidate) => candidate !== trimmed),
          };
        });
      },
      togglePinnedThread: (threadKey) => {
        const trimmed = threadKey.trim();
        if (trimmed.length === 0) return;
        set((state) => {
          if (state.pinnedThreadKeys.includes(trimmed)) {
            return {
              pinnedThreadKeys: state.pinnedThreadKeys.filter((candidate) => candidate !== trimmed),
            };
          }
          return {
            pinnedThreadKeys: [trimmed, ...state.pinnedThreadKeys],
          };
        });
      },
      prunePinnedThreads: (threadKeys) => {
        const allowedThreadKeys = new Set(threadKeys);
        set((state) => {
          const nextPinnedThreadKeys = state.pinnedThreadKeys.filter((threadKey) =>
            allowedThreadKeys.has(threadKey),
          );
          return nextPinnedThreadKeys.length === state.pinnedThreadKeys.length
            ? state
            : { pinnedThreadKeys: nextPinnedThreadKeys };
        });
      },
    }),
    {
      name: PINNED_THREADS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        pinnedThreadKeys: normalizePinnedThreadKeys(state.pinnedThreadKeys),
      }),
      merge: (persistedState, currentState) => {
        const candidate =
          (persistedState as Partial<Pick<PinnedThreadsStoreState, "pinnedThreadKeys">> | undefined)
            ?.pinnedThreadKeys ?? [];
        return {
          ...currentState,
          pinnedThreadKeys: normalizePinnedThreadKeys(candidate),
        };
      },
    },
  ),
);
