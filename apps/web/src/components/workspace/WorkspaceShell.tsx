import { Columns2Icon, Rows2Icon, XIcon } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { cn } from "../../lib/utils";
import { useStore } from "../../store";
import { createThreadSelectorByRef } from "../../storeSelectors";
import { useWorkspaceDocument, useWorkspaceStore } from "../../workspace/store";
import {
  normalizeWorkspaceSplitSizes,
  type WorkspaceNode,
  type WorkspaceSurfaceInstance,
} from "../../workspace/types";
import ChatView from "../ChatView";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceRouteSync } from "./WorkspaceRouteSync";

const WORKSPACE_MIN_PANE_SIZE_PX = 220;

function WorkspaceEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-lg border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
        <p className="text-xl text-foreground">Pick a thread to continue</p>
        <p className="mt-2 text-sm text-muted-foreground/78">
          Select an existing thread or create a new one to get started.
        </p>
      </div>
    </div>
  );
}

export function WorkspaceShell() {
  const document = useWorkspaceDocument();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <WorkspaceRouteSync />
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {document.rootNodeId ? <WorkspaceLayoutRoot /> : <WorkspaceRouteFallback />}
      </div>
    </SidebarInset>
  );
}

function WorkspaceRouteFallback() {
  return <WorkspaceEmptyState />;
}

function WorkspaceLayoutRoot() {
  const document = useWorkspaceDocument();
  const focusedWindowId = useWorkspaceStore((state) => state.document.focusedWindowId);
  const mobileActiveWindowId = useWorkspaceStore((state) => state.document.mobileActiveWindowId);
  const setMobileActiveWindow = useWorkspaceStore((state) => state.setMobileActiveWindow);
  const windowIds = useMemo(
    () => Object.keys(document.windowsById).filter((windowId) => document.windowsById[windowId]),
    [document.windowsById],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {windowIds.length > 1 ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          {windowIds.map((windowId, index) => {
            const isActive = (mobileActiveWindowId ?? focusedWindowId ?? windowIds[0]) === windowId;
            return (
              <button
                key={windowId}
                type="button"
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  isActive
                    ? "border-border bg-accent text-foreground"
                    : "border-border/60 text-muted-foreground",
                )}
                onClick={() => setMobileActiveWindow(windowId)}
              >
                Pane {index + 1}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden md:flex">
        <div className="hidden h-full min-h-0 min-w-0 flex-1 overflow-hidden md:flex">
          <WorkspaceNodeView nodeId={document.rootNodeId} />
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden md:hidden">
          <MobileWorkspaceWindow
            windowId={mobileActiveWindowId ?? focusedWindowId ?? windowIds[0] ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function MobileWorkspaceWindow(props: { windowId: string | null }) {
  const document = useWorkspaceDocument();
  if (!props.windowId) {
    return <WorkspaceEmptyState />;
  }
  const window = document.windowsById[props.windowId];
  if (!window) {
    return <WorkspaceEmptyState />;
  }
  return <WorkspaceWindowView windowId={window.id} />;
}

function WorkspaceNodeView(props: { nodeId: string | null }) {
  const document = useWorkspaceDocument();
  if (!props.nodeId) {
    return null;
  }

  const node = document.nodesById[props.nodeId];
  if (!node) {
    return null;
  }

  if (node.kind === "window") {
    return <WorkspaceWindowView windowId={node.windowId} />;
  }

  return <WorkspaceSplitNodeView node={node} />;
}

function WorkspaceSplitNodeView(props: { node: Extract<WorkspaceNode, { kind: "split" }> }) {
  const setSplitNodeSizes = useWorkspaceStore((state) => state.setSplitNodeSizes);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{
    handle: HTMLButtonElement;
    handleIndex: number;
    pendingSizes: number[];
    pointerId: number;
    rafId: number | null;
    startCoordinate: number;
    startSizes: number[];
    totalPx: number;
  } | null>(null);
  const sizes = useMemo(
    () => normalizeWorkspaceSplitSizes(props.node.sizes, props.node.childIds.length),
    [props.node.childIds.length, props.node.sizes],
  );

  const stopResize = useCallback(
    (pointerId: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }
      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
        setSplitNodeSizes(props.node.id, resizeState.pendingSizes);
      }
      resizeStateRef.current = null;
      if (resizeState.handle.hasPointerCapture(pointerId)) {
        resizeState.handle.releasePointerCapture(pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [props.node.id, setSplitNodeSizes],
  );

  useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState?.rafId !== null && resizeState?.rafId !== undefined) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  const handleResizePointerDown = useCallback(
    (handleIndex: number, event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const totalPx = props.node.axis === "x" ? rect.width : rect.height;
      if (totalPx <= 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        handle: event.currentTarget,
        handleIndex,
        pendingSizes: sizes,
        pointerId: event.pointerId,
        rafId: null,
        startCoordinate: props.node.axis === "x" ? event.clientX : event.clientY,
        startSizes: sizes,
        totalPx,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = props.node.axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [props.node.axis, sizes],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaPx =
        (props.node.axis === "x" ? event.clientX : event.clientY) - resizeState.startCoordinate;
      const deltaFraction = deltaPx / resizeState.totalPx;
      const pairTotal =
        resizeState.startSizes[resizeState.handleIndex]! +
        resizeState.startSizes[resizeState.handleIndex + 1]!;
      const requestedMinFraction = WORKSPACE_MIN_PANE_SIZE_PX / resizeState.totalPx;
      const minFraction = Math.min(requestedMinFraction, Math.max(pairTotal / 2 - 0.001, 0));

      const nextBefore = Math.min(
        pairTotal - minFraction,
        Math.max(minFraction, resizeState.startSizes[resizeState.handleIndex]! + deltaFraction),
      );
      const nextAfter = pairTotal - nextBefore;
      const nextSizes = [...resizeState.startSizes];
      nextSizes[resizeState.handleIndex] = nextBefore;
      nextSizes[resizeState.handleIndex + 1] = nextAfter;
      resizeState.pendingSizes = nextSizes;
      if (resizeState.rafId !== null) {
        return;
      }

      resizeState.rafId = window.requestAnimationFrame(() => {
        const activeResizeState = resizeStateRef.current;
        if (!activeResizeState) {
          return;
        }
        activeResizeState.rafId = null;
        setSplitNodeSizes(props.node.id, activeResizeState.pendingSizes);
      });
    },
    [props.node.axis, props.node.id, setSplitNodeSizes],
  );

  const endResizeInteraction = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      stopResize(event.pointerId);
    },
    [stopResize],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 overflow-hidden",
        props.node.axis === "x" ? "flex-row" : "flex-col",
      )}
    >
      {props.node.childIds.map((childId, index) => (
        <Fragment key={childId}>
          <div
            className="h-full min-h-0 min-w-0 overflow-hidden"
            style={{
              flexBasis: 0,
              flexGrow: sizes[index] ?? 1,
              flexShrink: 1,
            }}
          >
            <WorkspaceNodeView nodeId={childId} />
          </div>
          {index < props.node.childIds.length - 1 ? (
            <button
              type="button"
              className={cn(
                "relative z-10 shrink-0 bg-border/80 transition hover:bg-foreground/40",
                props.node.axis === "x"
                  ? "h-full w-1 cursor-col-resize touch-none"
                  : "h-1 w-full cursor-row-resize touch-none",
              )}
              aria-label={
                props.node.axis === "x" ? "Resize panes horizontally" : "Resize panes vertically"
              }
              title={props.node.axis === "x" ? "Drag to resize panes" : "Drag to resize panes"}
              onPointerCancel={endResizeInteraction}
              onPointerDown={(event) => handleResizePointerDown(index, event)}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endResizeInteraction}
            >
              <span
                className={cn(
                  "pointer-events-none absolute rounded-full bg-background/90",
                  props.node.axis === "x"
                    ? "top-1/2 left-1/2 h-10 w-px -translate-x-1/2 -translate-y-1/2"
                    : "top-1/2 left-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2",
                )}
              />
            </button>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

const WorkspaceWindowView = memo(function WorkspaceWindowView(props: { windowId: string }) {
  const document = useWorkspaceDocument();
  const focusWindow = useWorkspaceStore((state) => state.focusWindow);
  const focusTab = useWorkspaceStore((state) => state.focusTab);
  const closeSurface = useWorkspaceStore((state) => state.closeSurface);
  const splitWindowSurface = useWorkspaceStore((state) => state.splitWindowSurface);
  const window = document.windowsById[props.windowId];
  const focusedWindowId = document.focusedWindowId;

  if (!window) {
    return null;
  }

  const activeSurface = window.activeTabId ? document.surfacesById[window.activeTabId] : null;
  const isFocused = focusedWindowId === props.windowId;

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border/70 bg-background",
        isFocused ? "ring-1 ring-border/80" : "",
      )}
      onMouseDown={() => focusWindow(props.windowId)}
    >
      <div className="flex min-w-0 items-center gap-1 border-b border-border/70 bg-muted/20 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {window.tabIds.map((surfaceId) => {
            const surface = document.surfacesById[surfaceId];
            if (!surface) {
              return null;
            }
            const isActive = window.activeTabId === surfaceId;
            return (
              <div
                key={surfaceId}
                className={cn(
                  "group flex max-w-[18rem] min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => focusTab(props.windowId, surfaceId)}
                >
                  <WorkspaceSurfaceTitle surface={surface} />
                </button>
                <button
                  type="button"
                  className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-accent hover:text-foreground"
                  onClick={() => closeSurface(surfaceId)}
                  aria-label="Close tab"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-1 md:flex">
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => splitWindowSurface(props.windowId, "x")}
            aria-label="Split active tab right"
            title="Split active tab right"
          >
            <Columns2Icon className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => splitWindowSurface(props.windowId, "y")}
            aria-label="Split active tab down"
            title="Split active tab down"
          >
            <Rows2Icon className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeSurface ? <WorkspaceSurfaceView surface={activeSurface} active={isFocused} /> : null}
      </div>
    </section>
  );
});

function WorkspaceSurfaceView(props: { active: boolean; surface: WorkspaceSurfaceInstance }) {
  if (props.surface.input.scope === "server") {
    return (
      <ChatView
        environmentId={props.surface.input.threadRef.environmentId}
        threadId={props.surface.input.threadRef.threadId}
        routeKind="server"
        workspaceActive={props.active}
      />
    );
  }

  return (
    <ChatView
      draftId={props.surface.input.draftId}
      environmentId={props.surface.input.environmentId}
      threadId={props.surface.input.threadId}
      routeKind="draft"
      workspaceActive={props.active}
    />
  );
}

function WorkspaceSurfaceTitle(props: { surface: WorkspaceSurfaceInstance }) {
  const thread = useStore(
    useMemo(
      () =>
        createThreadSelectorByRef(
          props.surface.input.scope === "server" ? props.surface.input.threadRef : null,
        ),
      [props.surface.input],
    ),
  );
  const draftSession = useComposerDraftStore((store) =>
    props.surface.input.scope === "draft"
      ? store.getDraftSession(props.surface.input.draftId)
      : null,
  );

  if (props.surface.input.scope === "server") {
    return <>{thread?.title ?? props.surface.input.threadRef.threadId}</>;
  }

  return <>{thread?.title ?? (draftSession ? "New thread" : props.surface.input.threadId)}</>;
}
