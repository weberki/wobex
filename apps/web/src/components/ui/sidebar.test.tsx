import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Sidebar,
  SidebarHeaderTrigger,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
} from "./sidebar";

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses a pointer cursor for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for menu actions", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuAction aria-label="Create thread">
        <span>+</span>
      </SidebarMenuAction>,
    );

    expect(html).toContain('data-slot="sidebar-menu-action"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("applies custom sidebar gap and inner surface classes", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar gapClassName="custom-gap" innerClassName="custom-inner" transparentSurface>
          content
        </Sidebar>
      </SidebarProvider>,
    );

    expect(html).toContain("custom-gap");
    expect(html).toContain("custom-inner");
    expect(html).toContain("bg-transparent");
  });

  it("renders a compact header trigger", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarHeaderTrigger aria-label="Toggle sidebar" />
      </SidebarProvider>,
    );

    expect(html).toContain('data-slot="sidebar-trigger"');
    expect(html).toContain("sidebar-icon-button");
    expect(html).toContain("size-6");
  });
});
