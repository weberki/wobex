import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { useSettings } from "~/hooks/useSettings";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "wobex_settings_sidebar_width";
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

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const sidebarSide = useSettings((settings) => settings.sidebarSide);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  if (!pathname.startsWith("/settings")) {
    return <>{children}</>;
  }

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
      {sidebarSide === "left" ? sidebarElement : null}
      {children}
      {sidebarSide === "right" ? sidebarElement : null}
    </SidebarProvider>
  );
}
