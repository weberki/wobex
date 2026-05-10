import { scopeProjectRef } from "@wobex/client-runtime";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  ensurePrimaryEnvironmentReady,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { WorkspaceShell } from "~/components/workspace/WorkspaceShell";
import ThreadSidebar from "~/components/Sidebar";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "wobex_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

const SIDEBAR_GAP_CLASS = {
  left: "overflow-hidden after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-[color:var(--color-border-light)]",
  right:
    "overflow-hidden after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-[color:var(--color-border-light)]",
} as const;

const SIDEBAR_INNER_CLASS = {
  left: "app-sidebar-surface border-r border-[color:var(--color-border-light)]",
  right: "app-sidebar-surface border-l border-[color:var(--color-border-light)]",
} as const;

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const appSettings = useSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const projectRef = activeThread
        ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
        : activeDraftThread && routeThreadRef
          ? scopeProjectRef(routeThreadRef.environmentId, activeDraftThread.projectId)
          : defaultProjectRef;
      if (!projectRef) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectRef, {
          envMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectRef, {
          branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
          worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
          envMode:
            activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
        });
        return;
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    routeThreadRef,
    selectedThreadKeysSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
  ]);

  return null;
}

function ChatRouteLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isLegacyWorkspaceRoute = pathname.startsWith("/workspace/");
  const sidebarSide = useSettings((settings) => settings.sidebarSide);
  const sidebarElement = (
    <Sidebar
      side={sidebarSide}
      collapsible="offcanvas"
      className="text-foreground"
      gapClassName={SIDEBAR_GAP_CLASS[sidebarSide]}
      innerClassName={SIDEBAR_INNER_CLASS[sidebarSide]}
      transparentSurface
      resizable={{
        minWidth: THREAD_SIDEBAR_MIN_WIDTH,
        shouldAcceptWidth: ({ nextWidth, wrapper }) =>
          wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
        storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
      }}
    >
      <ThreadSidebar />
      <SidebarRail />
    </Sidebar>
  );

  return (
    <SidebarProvider defaultOpen>
      <ChatRouteGlobalShortcuts />
      {sidebarSide === "left" ? sidebarElement : null}
      {isLegacyWorkspaceRoute ? (
        <Outlet />
      ) : (
        <>
          <WorkspaceShell />
          <Outlet />
        </>
      )}
      {sidebarSide === "right" ? sidebarElement : null}
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async () => {
    const [, authGateState] = await Promise.all([
      ensurePrimaryEnvironmentReady(),
      resolveInitialServerAuthGateState(),
    ]);
    if (authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
