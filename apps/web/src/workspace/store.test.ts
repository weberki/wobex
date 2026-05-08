import { scopeThreadRef } from "@wobex/client-runtime";
import { EnvironmentId, ThreadId } from "@wobex/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function stubBrowserStorage() {
  const localStorage = createLocalStorageStub();
  vi.stubGlobal("window", {
    localStorage,
    setTimeout,
    clearTimeout,
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workspace store", () => {
  it("opens existing threads in tabs and explicit split panes", async () => {
    stubBrowserStorage();
    const { serverThreadSurfaceInput } = await import("./types");
    const { useWorkspaceStore } = await import("./store");
    const threadA = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-a"));
    const threadB = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-b"));

    useWorkspaceStore.getState().openThreadSurface(serverThreadSurfaceInput(threadA));
    useWorkspaceStore.getState().openThreadInSplit(serverThreadSurfaceInput(threadB), "x");

    let document = useWorkspaceStore.getState().document;
    expect(Object.keys(document.windowsById)).toHaveLength(2);
    expect(Object.keys(document.surfacesById)).toHaveLength(2);
    expect(document.rootNodeId).not.toBeNull();
    const rootNode = document.nodesById[document.rootNodeId!];
    expect(rootNode?.kind).toBe("split");
    expect(rootNode?.kind === "split" ? rootNode.axis : null).toBe("x");

    useWorkspaceStore.getState().openThreadSurface(serverThreadSurfaceInput(threadA));
    document = useWorkspaceStore.getState().document;
    expect(Object.keys(document.windowsById)).toHaveLength(2);
    expect(Object.keys(document.surfacesById)).toHaveLength(2);
  });

  it("collapses a split when the last surface in a pane closes", async () => {
    stubBrowserStorage();
    const { serverThreadSurfaceInput } = await import("./types");
    const { useWorkspaceStore } = await import("./store");
    const threadA = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-a"));
    const threadB = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-b"));

    useWorkspaceStore.getState().openThreadSurface(serverThreadSurfaceInput(threadA));
    useWorkspaceStore.getState().openThreadInSplit(serverThreadSurfaceInput(threadB), "x");

    let document = useWorkspaceStore.getState().document;
    const focusedWindow = document.windowsById[document.focusedWindowId!];
    expect(focusedWindow?.activeTabId).toBeTruthy();
    useWorkspaceStore.getState().closeSurface(focusedWindow!.activeTabId!);

    document = useWorkspaceStore.getState().document;
    expect(Object.keys(document.windowsById)).toHaveLength(1);
    expect(Object.keys(document.surfacesById)).toHaveLength(1);
    expect(document.rootNodeId).not.toBeNull();
    expect(document.nodesById[document.rootNodeId!]?.kind).toBe("window");
  });
});
