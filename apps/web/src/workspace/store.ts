import { useMemo } from "react";
import { create } from "zustand";

import {
  readBrowserWorkspaceDocument,
  writeBrowserWorkspaceDocument,
} from "../clientPersistenceStorage";
import { randomUUID } from "../lib/utils";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  createEmptyWorkspaceDocument,
  isWorkspaceDocument,
  normalizeWorkspaceSplitSizes,
  routeTargetForSurface,
  sameThreadSurfaceInput,
  type ThreadSurfaceInput,
  type WorkspaceAxis,
  type WorkspaceDocument,
  type WorkspaceNode,
  type WorkspaceSurfaceInstance,
  type WorkspaceWindow,
} from "./types";

type OpenThreadDisposition = "focus-or-tab" | "new-tab" | "split-right" | "split-down";

const WORKSPACE_PERSIST_DEBOUNCE_MS = 150;

let persistTimer: number | null = null;

function scheduleWorkspacePersistence(document: WorkspaceDocument): void {
  if (typeof window === "undefined") {
    return;
  }

  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }

  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    writeBrowserWorkspaceDocument(document);
  }, WORKSPACE_PERSIST_DEBOUNCE_MS);
}

function nextWorkspaceId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function equalSplitSizes(childCount: number): number[] {
  return normalizeWorkspaceSplitSizes(undefined, childCount);
}

function createThreadSurface(input: ThreadSurfaceInput): WorkspaceSurfaceInstance {
  return {
    id: nextWorkspaceId("surface"),
    kind: "thread",
    input,
  };
}

function duplicateSurface(surface: WorkspaceSurfaceInstance): WorkspaceSurfaceInstance {
  return createThreadSurface(surface.input);
}

function cloneWindow(window: WorkspaceWindow): WorkspaceWindow {
  return {
    ...window,
    tabIds: [...window.tabIds],
  };
}

function firstWindowId(document: WorkspaceDocument): string | null {
  if (document.focusedWindowId && document.windowsById[document.focusedWindowId]) {
    return document.focusedWindowId;
  }

  return Object.keys(document.windowsById)[0] ?? null;
}

function getFocusedSurface(document: WorkspaceDocument): WorkspaceSurfaceInstance | null {
  const windowId = firstWindowId(document);
  if (!windowId) {
    return null;
  }
  const window = document.windowsById[windowId];
  const surfaceId = window?.activeTabId ?? null;
  return surfaceId ? (document.surfacesById[surfaceId] ?? null) : null;
}

function getWindowBySurfaceId(
  document: WorkspaceDocument,
  surfaceId: string,
): { windowId: string; window: WorkspaceWindow } | null {
  for (const [windowId, window] of Object.entries(document.windowsById)) {
    if (window.tabIds.includes(surfaceId)) {
      return { windowId, window };
    }
  }

  return null;
}

function getWindowNodeByWindowId(
  document: WorkspaceDocument,
  windowId: string,
): { nodeId: string; node: Extract<WorkspaceNode, { kind: "window" }> } | null {
  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    if (node.kind === "window" && node.windowId === windowId) {
      return { nodeId, node };
    }
  }

  return null;
}

function findParentNode(
  document: WorkspaceDocument,
  childNodeId: string,
): { parentId: string; parent: Extract<WorkspaceNode, { kind: "split" }>; index: number } | null {
  for (const [parentId, node] of Object.entries(document.nodesById)) {
    if (node.kind !== "split") {
      continue;
    }

    const index = node.childIds.indexOf(childNodeId);
    if (index >= 0) {
      return { parentId, parent: node, index };
    }
  }

  return null;
}

function setFocusedWindow(document: WorkspaceDocument, windowId: string | null): WorkspaceDocument {
  if (document.focusedWindowId === windowId && document.mobileActiveWindowId === windowId) {
    return document;
  }

  return {
    ...document,
    focusedWindowId: windowId,
    mobileActiveWindowId: windowId,
  };
}

function focusSurfaceById(document: WorkspaceDocument, surfaceId: string): WorkspaceDocument {
  const located = getWindowBySurfaceId(document, surfaceId);
  if (!located) {
    return document;
  }

  const nextWindow = cloneWindow(located.window);
  nextWindow.activeTabId = surfaceId;

  return {
    ...document,
    windowsById: {
      ...document.windowsById,
      [located.windowId]: nextWindow,
    },
    focusedWindowId: located.windowId,
    mobileActiveWindowId: located.windowId,
  };
}

function insertSurfaceIntoWindow(
  document: WorkspaceDocument,
  windowId: string | null,
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocument {
  if (!windowId || !document.windowsById[windowId]) {
    const nextWindowId = nextWorkspaceId("window");
    const nextNodeId = nextWorkspaceId("node");
    return {
      ...document,
      rootNodeId: nextNodeId,
      nodesById: {
        [nextNodeId]: {
          id: nextNodeId,
          kind: "window",
          windowId: nextWindowId,
        },
      },
      windowsById: {
        [nextWindowId]: {
          id: nextWindowId,
          tabIds: [surface.id],
          activeTabId: surface.id,
        },
      },
      surfacesById: {
        ...document.surfacesById,
        [surface.id]: surface,
      },
      focusedWindowId: nextWindowId,
      mobileActiveWindowId: nextWindowId,
    };
  }

  const currentWindow = document.windowsById[windowId];
  const nextWindow = cloneWindow(currentWindow);
  nextWindow.tabIds = [...nextWindow.tabIds, surface.id];
  nextWindow.activeTabId = surface.id;

  return {
    ...document,
    windowsById: {
      ...document.windowsById,
      [windowId]: nextWindow,
    },
    surfacesById: {
      ...document.surfacesById,
      [surface.id]: surface,
    },
    focusedWindowId: windowId,
    mobileActiveWindowId: windowId,
  };
}

function splitWindowWithSurface(
  document: WorkspaceDocument,
  sourceWindowId: string | null,
  axis: WorkspaceAxis,
  surface: WorkspaceSurfaceInstance,
): WorkspaceDocument {
  if (!sourceWindowId || !document.windowsById[sourceWindowId]) {
    return insertSurfaceIntoWindow(document, null, surface);
  }

  const sourceNode = getWindowNodeByWindowId(document, sourceWindowId);
  if (!sourceNode) {
    return insertSurfaceIntoWindow(document, null, surface);
  }

  const parent = findParentNode(document, sourceNode.nodeId);
  const nextWindowId = nextWorkspaceId("window");
  const nextWindowNodeId = nextWorkspaceId("node");
  const nextNodesById: Record<string, WorkspaceNode> = {
    ...document.nodesById,
    [nextWindowNodeId]: {
      id: nextWindowNodeId,
      kind: "window",
      windowId: nextWindowId,
    },
  };

  if (parent && parent.parent.axis === axis && parent.parent.sizingMode === "auto") {
    const nextChildIds = [
      ...parent.parent.childIds.slice(0, parent.index + 1),
      nextWindowNodeId,
      ...parent.parent.childIds.slice(parent.index + 1),
    ];
    nextNodesById[parent.parentId] = {
      ...parent.parent,
      childIds: nextChildIds,
      sizes: equalSplitSizes(nextChildIds.length),
      sizingMode: "auto",
    };

    return {
      ...document,
      nodesById: nextNodesById,
      windowsById: {
        ...document.windowsById,
        [nextWindowId]: {
          id: nextWindowId,
          tabIds: [surface.id],
          activeTabId: surface.id,
        },
      },
      surfacesById: {
        ...document.surfacesById,
        [surface.id]: surface,
      },
      focusedWindowId: nextWindowId,
      mobileActiveWindowId: nextWindowId,
    };
  }

  const nextSplitNodeId = nextWorkspaceId("node");
  nextNodesById[nextSplitNodeId] = {
    id: nextSplitNodeId,
    kind: "split",
    axis,
    childIds: [sourceNode.nodeId, nextWindowNodeId],
    sizes: equalSplitSizes(2),
    sizingMode: "auto",
  };

  let nextRootNodeId = document.rootNodeId;
  if (!parent) {
    nextRootNodeId = nextSplitNodeId;
  } else {
    nextNodesById[parent.parentId] = {
      ...parent.parent,
      childIds: parent.parent.childIds.map((childId, index) =>
        index === parent.index ? nextSplitNodeId : childId,
      ),
    };
  }

  return {
    ...document,
    rootNodeId: nextRootNodeId,
    nodesById: nextNodesById,
    windowsById: {
      ...document.windowsById,
      [nextWindowId]: {
        id: nextWindowId,
        tabIds: [surface.id],
        activeTabId: surface.id,
      },
    },
    surfacesById: {
      ...document.surfacesById,
      [surface.id]: surface,
    },
    focusedWindowId: nextWindowId,
    mobileActiveWindowId: nextWindowId,
  };
}

function setWorkspaceSplitNodeSizes(
  document: WorkspaceDocument,
  nodeId: string,
  sizes: number[],
): WorkspaceDocument {
  const node = document.nodesById[nodeId];
  if (!node || node.kind !== "split") {
    return document;
  }

  return {
    ...document,
    nodesById: {
      ...document.nodesById,
      [nodeId]: {
        ...node,
        sizes: normalizeWorkspaceSplitSizes(sizes, node.childIds.length),
        sizingMode: "manual",
      },
    },
  };
}

function removeChildFromSplitNode(
  node: Extract<WorkspaceNode, { kind: "split" }>,
  removeIndex: number,
): Extract<WorkspaceNode, { kind: "split" }> {
  const nextChildIds = node.childIds.filter((_, index) => index !== removeIndex);
  return {
    ...node,
    childIds: nextChildIds,
    sizes:
      node.sizingMode === "manual"
        ? normalizeWorkspaceSplitSizes(
            node.sizes.filter((_, index) => index !== removeIndex),
            nextChildIds.length,
          )
        : equalSplitSizes(nextChildIds.length),
  };
}

function replaceChildNode(
  node: Extract<WorkspaceNode, { kind: "split" }>,
  childId: string,
  replacementId: string,
): Extract<WorkspaceNode, { kind: "split" }> {
  return {
    ...node,
    childIds: node.childIds.map((currentChildId) =>
      currentChildId === childId ? replacementId : currentChildId,
    ),
  };
}

function removeWindowNodeFromTree(
  document: WorkspaceDocument,
  windowId: string,
): Pick<WorkspaceDocument, "rootNodeId" | "nodesById"> {
  const windowNode = getWindowNodeByWindowId(document, windowId);
  if (!windowNode) {
    return {
      rootNodeId: document.rootNodeId,
      nodesById: document.nodesById,
    };
  }

  let nextRootNodeId = document.rootNodeId;
  let nextNodesById = { ...document.nodesById };
  delete nextNodesById[windowNode.nodeId];

  let currentNodeId = windowNode.nodeId;
  while (true) {
    const workingDocument = {
      ...document,
      rootNodeId: nextRootNodeId,
      nodesById: nextNodesById,
    };
    const parent = findParentNode(workingDocument, currentNodeId);
    if (!parent) {
      if (nextRootNodeId === currentNodeId) {
        nextRootNodeId = null;
      }
      break;
    }

    const nextParent = removeChildFromSplitNode(parent.parent, parent.index);
    if (nextParent.childIds.length > 1) {
      nextNodesById[parent.parentId] = nextParent;
      break;
    }

    delete nextNodesById[parent.parentId];
    const replacementNodeId = nextParent.childIds[0] ?? null;
    if (!replacementNodeId) {
      if (nextRootNodeId === parent.parentId) {
        nextRootNodeId = null;
      }
      currentNodeId = parent.parentId;
      continue;
    }

    if (nextRootNodeId === parent.parentId) {
      nextRootNodeId = replacementNodeId;
    } else {
      const grandparent = findParentNode(
        {
          ...document,
          rootNodeId: nextRootNodeId,
          nodesById: nextNodesById,
        },
        parent.parentId,
      );
      if (grandparent) {
        nextNodesById[grandparent.parentId] = replaceChildNode(
          grandparent.parent,
          parent.parentId,
          replacementNodeId,
        );
      }
    }
    currentNodeId = parent.parentId;
  }

  return {
    rootNodeId: nextRootNodeId,
    nodesById: nextNodesById,
  };
}

function closeSurfaceById(document: WorkspaceDocument, surfaceId: string): WorkspaceDocument {
  const located = getWindowBySurfaceId(document, surfaceId);
  if (!located) {
    return document;
  }

  const nextSurfacesById = { ...document.surfacesById };
  delete nextSurfacesById[surfaceId];

  const nextWindow = cloneWindow(located.window);
  const closedIndex = nextWindow.tabIds.indexOf(surfaceId);
  nextWindow.tabIds = nextWindow.tabIds.filter((tabId) => tabId !== surfaceId);
  if (nextWindow.activeTabId === surfaceId) {
    nextWindow.activeTabId =
      nextWindow.tabIds[Math.min(closedIndex, nextWindow.tabIds.length - 1)] ??
      nextWindow.tabIds[0] ??
      null;
  }

  if (nextWindow.tabIds.length > 0) {
    return {
      ...document,
      windowsById: {
        ...document.windowsById,
        [located.windowId]: nextWindow,
      },
      surfacesById: nextSurfacesById,
      focusedWindowId: located.windowId,
      mobileActiveWindowId: located.windowId,
    };
  }

  const nextWindowsById = { ...document.windowsById };
  delete nextWindowsById[located.windowId];
  const nextTree = removeWindowNodeFromTree(document, located.windowId);
  const fallbackWindowId = Object.keys(nextWindowsById)[0] ?? null;

  return {
    ...document,
    rootNodeId: nextTree.rootNodeId,
    nodesById: nextTree.nodesById,
    windowsById: nextWindowsById,
    surfacesById: nextSurfacesById,
    focusedWindowId: fallbackWindowId,
    mobileActiveWindowId: fallbackWindowId,
  };
}

function findMatchingThreadSurfaceId(
  document: WorkspaceDocument,
  input: ThreadSurfaceInput,
): string | null {
  for (const surface of Object.values(document.surfacesById)) {
    if (sameThreadSurfaceInput(surface.input, input)) {
      return surface.id;
    }
  }

  return null;
}

function normalizePersistedWorkspaceDocument(document: WorkspaceDocument): WorkspaceDocument {
  if (!document.rootNodeId || !document.nodesById[document.rootNodeId]) {
    return createEmptyWorkspaceDocument();
  }

  const nodesById = Object.fromEntries(
    Object.entries(document.nodesById).map(([nodeId, node]) => [
      nodeId,
      node.kind === "split"
        ? {
            ...node,
            sizes: normalizeWorkspaceSplitSizes(node.sizes, node.childIds.length),
            sizingMode: node.sizingMode === "manual" ? "manual" : "auto",
          }
        : node,
    ]),
  ) as Record<string, WorkspaceNode>;

  return {
    ...document,
    nodesById,
  };
}

function readInitialWorkspaceDocument(): WorkspaceDocument {
  const persisted = readBrowserWorkspaceDocument<WorkspaceDocument>();
  if (!persisted || !isWorkspaceDocument(persisted)) {
    return createEmptyWorkspaceDocument();
  }
  return normalizePersistedWorkspaceDocument(persisted);
}

export interface WorkspaceStoreState {
  document: WorkspaceDocument;
  openRouteTarget: (target: ThreadRouteTarget) => void;
  openThreadSurface: (input: ThreadSurfaceInput, disposition?: OpenThreadDisposition) => void;
  openThreadInNewTab: (input: ThreadSurfaceInput) => void;
  openThreadInSplit: (input: ThreadSurfaceInput, axis: WorkspaceAxis) => void;
  splitWindowSurface: (windowId: string, axis: WorkspaceAxis) => void;
  setSplitNodeSizes: (nodeId: string, sizes: number[]) => void;
  closeSurface: (surfaceId: string) => void;
  focusWindow: (windowId: string) => void;
  focusTab: (windowId: string, surfaceId: string) => void;
  setMobileActiveWindow: (windowId: string) => void;
  resetWorkspace: () => void;
}

function setDocumentState(nextDocument: WorkspaceDocument): Partial<WorkspaceStoreState> {
  scheduleWorkspacePersistence(nextDocument);
  return { document: nextDocument };
}

export const useWorkspaceStore = create<WorkspaceStoreState>()((set, get) => ({
  document: readInitialWorkspaceDocument(),
  openRouteTarget: (target) => {
    if (target.kind === "server") {
      get().openThreadSurface({ scope: "server", threadRef: target.threadRef }, "focus-or-tab");
    }
  },
  openThreadSurface: (input, disposition = "focus-or-tab") => {
    const current = get().document;
    const existingSurfaceId =
      disposition === "focus-or-tab" ? findMatchingThreadSurfaceId(current, input) : null;
    if (existingSurfaceId) {
      set(setDocumentState(focusSurfaceById(current, existingSurfaceId)));
      return;
    }

    const nextSurface = createThreadSurface(input);
    const nextDocument =
      disposition === "split-right"
        ? splitWindowWithSurface(current, firstWindowId(current), "x", nextSurface)
        : disposition === "split-down"
          ? splitWindowWithSurface(current, firstWindowId(current), "y", nextSurface)
          : insertSurfaceIntoWindow(current, firstWindowId(current), nextSurface);
    set(setDocumentState(nextDocument));
  },
  openThreadInNewTab: (input) => {
    const current = get().document;
    set(
      setDocumentState(
        insertSurfaceIntoWindow(current, firstWindowId(current), createThreadSurface(input)),
      ),
    );
  },
  openThreadInSplit: (input, axis) => {
    const current = get().document;
    set(
      setDocumentState(
        splitWindowWithSurface(current, firstWindowId(current), axis, createThreadSurface(input)),
      ),
    );
  },
  splitWindowSurface: (windowId, axis) => {
    const current = get().document;
    const window = current.windowsById[windowId];
    const activeSurface = window?.activeTabId ? current.surfacesById[window.activeTabId] : null;
    if (!window || !activeSurface) {
      return;
    }

    set(
      setDocumentState(
        splitWindowWithSurface(current, windowId, axis, duplicateSurface(activeSurface)),
      ),
    );
  },
  setSplitNodeSizes: (nodeId, sizes) => {
    const current = get().document;
    const nextDocument = setWorkspaceSplitNodeSizes(current, nodeId, sizes);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },
  closeSurface: (surfaceId) => {
    const current = get().document;
    const nextDocument = closeSurfaceById(current, surfaceId);
    if (nextDocument === current) {
      return;
    }
    set(setDocumentState(nextDocument));
  },
  focusWindow: (windowId) => {
    const current = get().document;
    if (!current.windowsById[windowId]) {
      return;
    }
    set(setDocumentState(setFocusedWindow(current, windowId)));
  },
  focusTab: (windowId, surfaceId) => {
    const current = get().document;
    const window = current.windowsById[windowId];
    if (!window || !window.tabIds.includes(surfaceId)) {
      return;
    }
    set(
      setDocumentState({
        ...current,
        windowsById: {
          ...current.windowsById,
          [windowId]: {
            ...window,
            activeTabId: surfaceId,
          },
        },
        focusedWindowId: windowId,
        mobileActiveWindowId: windowId,
      }),
    );
  },
  setMobileActiveWindow: (windowId) => {
    const current = get().document;
    if (!current.windowsById[windowId]) {
      return;
    }
    set(setDocumentState(setFocusedWindow(current, windowId)));
  },
  resetWorkspace: () => {
    set(setDocumentState(createEmptyWorkspaceDocument()));
  },
}));

export function useWorkspaceDocument(): WorkspaceDocument {
  return useWorkspaceStore((state) => state.document);
}

export function useFocusedWorkspaceSurface(): WorkspaceSurfaceInstance | null {
  const document = useWorkspaceDocument();
  return useMemo(() => getFocusedSurface(document), [document]);
}

export function useFocusedWorkspaceRouteTarget(): ThreadRouteTarget | null {
  const document = useWorkspaceDocument();
  return useMemo(() => routeTargetForSurface(getFocusedSurface(document)), [document]);
}
