import * as Crypto from "node:crypto";

import type {
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserPanelBounds,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserTabState,
  BrowserThreadInput,
  ThreadBrowserState,
  ThreadId,
} from "@wobex/contracts";

export const BROWSER_STATE_CHANNEL = "desktop:browser-state";
export const BROWSER_OPEN_CHANNEL = "desktop:browser-open";
export const BROWSER_CLOSE_CHANNEL = "desktop:browser-close";
export const BROWSER_HIDE_CHANNEL = "desktop:browser-hide";
export const BROWSER_GET_STATE_CHANNEL = "desktop:browser-get-state";
export const BROWSER_SET_BOUNDS_CHANNEL = "desktop:browser-set-bounds";
export const BROWSER_NAVIGATE_CHANNEL = "desktop:browser-navigate";
export const BROWSER_RELOAD_CHANNEL = "desktop:browser-reload";
export const BROWSER_GO_BACK_CHANNEL = "desktop:browser-go-back";
export const BROWSER_GO_FORWARD_CHANNEL = "desktop:browser-go-forward";
export const BROWSER_NEW_TAB_CHANNEL = "desktop:browser-new-tab";
export const BROWSER_CLOSE_TAB_CHANNEL = "desktop:browser-close-tab";
export const BROWSER_SELECT_TAB_CHANNEL = "desktop:browser-select-tab";
export const BROWSER_OPEN_DEVTOOLS_CHANNEL = "desktop:browser-open-devtools";

const ABOUT_BLANK_URL = "about:blank";
const SEARCH_URL_PREFIX = "https://www.google.com/search?q=";

export interface BrowserBridgeStateStoreOptions {
  readonly onStateChange?: (state: ThreadBrowserState) => void;
}

export interface BrowserBridgeStateStore {
  readonly open: (input: BrowserOpenInput) => ThreadBrowserState;
  readonly close: (input: BrowserThreadInput) => ThreadBrowserState;
  readonly hide: (input: BrowserThreadInput) => ThreadBrowserState;
  readonly getState: (input: BrowserThreadInput) => ThreadBrowserState;
  readonly setPanelBounds: (input: BrowserSetPanelBoundsInput) => ThreadBrowserState;
  readonly navigate: (input: BrowserNavigateInput) => ThreadBrowserState;
  readonly reload: (input: BrowserTabInput) => ThreadBrowserState;
  readonly goBack: (input: BrowserTabInput) => ThreadBrowserState;
  readonly goForward: (input: BrowserTabInput) => ThreadBrowserState;
  readonly newTab: (input: BrowserNewTabInput) => ThreadBrowserState;
  readonly closeTab: (input: BrowserTabInput) => ThreadBrowserState;
  readonly selectTab: (input: BrowserTabInput) => ThreadBrowserState;
  readonly openDevTools: (_input: BrowserTabInput) => void;
}

function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) {
    return "New tab";
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function normalizeUrlInput(input: string | undefined): string {
  const trimmed = input?.trim() ?? "";
  if (trimmed.length === 0) {
    return ABOUT_BLANK_URL;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "about:"
    ) {
      return parsed.toString();
    }
  } catch {
    // Fall through to search/url heuristics below.
  }

  if (trimmed.includes(" ")) {
    return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`;
  }

  if (
    trimmed.startsWith("localhost") ||
    trimmed.startsWith("127.0.0.1") ||
    trimmed.startsWith("0.0.0.0")
  ) {
    return `http://${trimmed}`;
  }

  if (trimmed.includes(".")) {
    return `https://${trimmed}`;
  }

  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`;
}

function cloneTab(tab: BrowserTabState): BrowserTabState {
  return { ...tab };
}

function cloneState(state: ThreadBrowserState): ThreadBrowserState {
  return {
    ...state,
    tabs: state.tabs.map(cloneTab),
  };
}

function defaultState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (bounds === null) {
    return null;
  }

  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null;
  }

  const width = Math.max(0, Math.floor(bounds.width));
  const height = Math.max(0, Math.floor(bounds.height));
  if (width === 0 || height === 0) {
    return null;
  }

  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  };
}

function ensureActiveTab(state: ThreadBrowserState, tabId?: string) {
  if (state.tabs.length === 0) {
    return null;
  }
  if (tabId !== undefined) {
    return state.tabs.find((tab) => tab.id === tabId) ?? null;
  }
  if (state.activeTabId !== null) {
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
  }
  return state.tabs[0] ?? null;
}

const openDevTools = (_input: BrowserTabInput) => undefined;

export function createBrowserBridgeStateStore(
  options?: BrowserBridgeStateStoreOptions,
): BrowserBridgeStateStore {
  const states = new Map<ThreadId, ThreadBrowserState>();
  const panelBounds = new Map<ThreadId, BrowserPanelBounds | null>();

  const emitState = (state: ThreadBrowserState) => {
    options?.onStateChange?.(cloneState(state));
  };

  const getOrCreateState = (threadId: ThreadId) => {
    const existing = states.get(threadId);
    if (existing) {
      return existing;
    }

    const state = defaultState(threadId);
    states.set(threadId, state);
    return state;
  };

  const updateState = (
    threadId: ThreadId,
    updater: (state: ThreadBrowserState) => ThreadBrowserState,
  ) => {
    const current = cloneState(getOrCreateState(threadId));
    const next = updater(current);
    states.set(threadId, next);
    emitState(next);
    return cloneState(next);
  };

  const getState = (input: BrowserThreadInput) => cloneState(getOrCreateState(input.threadId));

  const open = (input: BrowserOpenInput) =>
    updateState(input.threadId, (state) => {
      state.open = true;
      if (state.tabs.length === 0) {
        const url = normalizeUrlInput(input.initialUrl);
        const tab: BrowserTabState = {
          id: Crypto.randomUUID(),
          url,
          title: defaultTitleForUrl(url),
          status: "suspended",
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          faviconUrl: null,
          lastCommittedUrl: url,
          lastError: null,
        };
        state.tabs = [tab];
        state.activeTabId = tab.id;
      } else if (state.activeTabId === null) {
        state.activeTabId = state.tabs[0]?.id ?? null;
      }
      state.lastError = null;
      return state;
    });

  const close = (input: BrowserThreadInput) =>
    updateState(input.threadId, (state) => {
      state.open = false;
      state.activeTabId = null;
      state.lastError = null;
      return state;
    });

  const hide = (input: BrowserThreadInput) => close(input);

  const setPanelBounds = (input: BrowserSetPanelBoundsInput) => {
    panelBounds.set(input.threadId, normalizeBounds(input.bounds));
    return updateState(input.threadId, (state) => state);
  };

  const navigate = (input: BrowserNavigateInput) =>
    updateState(input.threadId, (state) => {
      const normalizedUrl = normalizeUrlInput(input.url);
      const targetTab = ensureActiveTab(state, input.tabId);
      if (targetTab === null) {
        const tab: BrowserTabState = {
          id: Crypto.randomUUID(),
          url: normalizedUrl,
          title: defaultTitleForUrl(normalizedUrl),
          status: "suspended",
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          faviconUrl: null,
          lastCommittedUrl: normalizedUrl,
          lastError: null,
        };
        state.tabs = [...state.tabs, tab];
        state.activeTabId = tab.id;
        state.open = true;
        return state;
      }

      state.tabs = state.tabs.map((tab) =>
        tab.id === targetTab.id
          ? {
              ...tab,
              url: normalizedUrl,
              title: defaultTitleForUrl(normalizedUrl),
              status: "suspended",
              isLoading: false,
              lastCommittedUrl: normalizedUrl,
              lastError: null,
            }
          : tab,
      );
      state.activeTabId = targetTab.id;
      state.open = true;
      state.lastError = null;
      return state;
    });

  const reload = (input: BrowserTabInput) =>
    updateState(input.threadId, (state) => {
      const targetTab = ensureActiveTab(state, input.tabId);
      if (targetTab === null) {
        return state;
      }

      state.activeTabId = targetTab.id;
      return state;
    });

  const goBack = (input: BrowserTabInput) => updateState(input.threadId, (state) => state);
  const goForward = (input: BrowserTabInput) => updateState(input.threadId, (state) => state);

  const newTab = (input: BrowserNewTabInput) =>
    updateState(input.threadId, (state) => {
      const url = normalizeUrlInput(input.url);
      const tab: BrowserTabState = {
        id: Crypto.randomUUID(),
        url,
        title: defaultTitleForUrl(url),
        status: "suspended",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        faviconUrl: null,
        lastCommittedUrl: url,
        lastError: null,
      };
      state.tabs = [...state.tabs, tab];
      if (input.activate === true || state.activeTabId === null) {
        state.activeTabId = tab.id;
      }
      state.open = true;
      return state;
    });

  const closeTab = (input: BrowserTabInput) =>
    updateState(input.threadId, (state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== input.tabId);
      state.tabs = tabs;
      state.activeTabId =
        state.activeTabId === input.tabId ? (tabs[0]?.id ?? null) : state.activeTabId;
      if (state.activeTabId !== null && !tabs.some((tab) => tab.id === state.activeTabId)) {
        state.activeTabId = tabs[0]?.id ?? null;
      }
      return state;
    });

  const selectTab = (input: BrowserTabInput) =>
    updateState(input.threadId, (state) => {
      if (!state.tabs.some((tab) => tab.id === input.tabId)) {
        return state;
      }
      state.activeTabId = input.tabId;
      return state;
    });

  return {
    open,
    close,
    hide,
    getState,
    setPanelBounds,
    navigate,
    reload,
    goBack,
    goForward,
    newTab,
    closeTab,
    selectTab,
    openDevTools,
  };
}
