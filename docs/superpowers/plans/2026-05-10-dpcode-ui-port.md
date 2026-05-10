# DPCode UI Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Wobex's main desktop/web UI so it matches the DPCode interaction model and visual placement patterns for sidebar, pinned threads, workspace, browser, chat transcript, composer, header menus, and secondary panels while preserving Wobex branding and runtime architecture.

**Architecture:** Treat DPCode as an MIT-licensed reference, not as a direct upstream merge. Port UI patterns manually into Wobex's existing React/TanStack/Zustand/Electron structure, keeping provider orchestration, environment scoping, browser bridge, terminal state, and settings contracts under Wobex ownership. Split the work into safe vertical slices so every stage remains runnable.

**Tech Stack:** Bun monorepo, React 19, Vite 8, TanStack Router/Query, Zustand, Tailwind CSS v4, Base UI/shadcn-style primitives, Lucide icons, Electron desktop browser bridge, Vitest/browser tests.

---

## Scope

This plan covers the app UI visible in the supplied DPCode screenshot:

- left app sidebar with DPCode-style density, top navigation, `Threads`/`Workspace` segmented switch, global actions, pinned section, project-thread groups, hover actions, and footer actions
- chat header with compact title/actions row and menu actions such as open editor, terminal, browser visibility, split chat, and add action
- chat transcript typography, event/file/diff rendering density, scroll behavior, and bottom composer placement
- bottom composer with compact model/effort/runtime controls, circular send/stop button, attachments, pending approval/user-input panels, and inline action menus
- right-side browser/diff/workspace placement with persisted widths and mobile fallback
- split-chat/workspace interaction so thread panes, workspace panes, browser, terminal, and diff do not fight each other
- DPCode-like light/dark theme token bridge with Wobex branding

Out of scope:

- copying DPCode branding, marketing copy, app name, screenshots, release process, or public URLs
- replacing Wobex provider adapters or server orchestration with DPCode internals
- pushing, deploying, or production testing
- keeping an `upstream` remote to DPCode or T3 Code

## Reference Inputs

- DPCode repo: <https://github.com/Emanuele-web04/dpcode>
- DPCode license: <https://github.com/Emanuele-web04/dpcode/blob/main/LICENSE>
- DPCode README: <https://github.com/Emanuele-web04/dpcode/blob/main/README.md>
- DPCode app shell: <https://github.com/Emanuele-web04/dpcode/blob/main/apps/web/src/routes/_chat.tsx>
- DPCode sidebar: <https://github.com/Emanuele-web04/dpcode/blob/main/apps/web/src/components/Sidebar.tsx>
- DPCode chat view: <https://github.com/Emanuele-web04/dpcode/blob/main/apps/web/src/components/ChatView.tsx>
- DPCode browser panel: <https://github.com/Emanuele-web04/dpcode/blob/main/apps/web/src/components/BrowserPanel.tsx>
- DPCode theme tokens: <https://github.com/Emanuele-web04/dpcode/blob/main/apps/web/src/index.css>

## Ground Rules

- Keep Wobex package imports as `@wobex/*`; do not import or preserve `@t3tools/*` names.
- Preserve Wobex's environment-aware references: `EnvironmentId`, `ScopedProjectRef`, `ScopedThreadRef`, `scopeThreadRef`, and `scopedThreadKey`.
- Preserve Wobex's Windows-first behavior and avoid macOS-only assumptions from DPCode.
- Preserve Wobex's existing dirty user change in `bun.lock`; do not stage or modify it unless a later implementation task genuinely requires dependency changes.
- Preserve MIT attribution if substantial DPCode/T3Code code is copied or closely adapted. Prefer manual implementation from observed behavior and small adapted snippets only where needed.
- Follow the repo completion gate after code changes: `bun fmt`, `bun lint`, `bun typecheck`, and targeted `bun run test` commands. Never run `bun test`.

## Current Wobex File Map

Primary local files to modify:

- `apps/web/src/index.css`: global theme tokens, typography, component helper classes, markdown/image styling
- `apps/web/src/routes/__root.tsx`: authenticated app wrapper, bootstrap, `AppSidebarLayout`
- `apps/web/src/routes/_chat.tsx`: chat route shell and global shortcuts
- `apps/web/src/components/AppSidebarLayout.tsx`: current app-level sidebar wrapper
- `apps/web/src/components/Sidebar.tsx`: main Wobex project/thread sidebar
- `apps/web/src/components/Sidebar.logic.ts`: sidebar sorting/status/helper behavior
- `apps/web/src/components/SidebarSearchPalette.tsx`: search/new/import palette
- `apps/web/src/components/ui/sidebar.tsx`: shared sidebar primitive, inset, rail, resizable behavior
- `apps/web/src/components/workspace/WorkspaceShell.tsx`: current split workspace shell
- `apps/web/src/workspace/store.ts`: workspace tab/split persistence
- `apps/web/src/workspace/types.ts`: workspace document shape
- `apps/web/src/components/ChatView.tsx`: chat surface state wiring and layout composition
- `apps/web/src/components/chat/ChatHeader.tsx`: top compact action strip
- `apps/web/src/components/chat/MessagesTimeline.tsx`: transcript/event rendering
- `apps/web/src/components/chat/ChatComposer.tsx`: bottom composer and controls
- `apps/web/src/components/chat/ProviderModelPicker.tsx`: model/provider controls
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`: compact footer controls
- `apps/web/src/components/ThreadTerminalDrawer.tsx`: terminal drawer/workspace presentation
- `apps/web/src/components/WorkspaceWindow.tsx`: existing right-side plan/explorer/preview/git/browser/graph window
- `apps/web/src/components/BrowserPanel.tsx`: browser panel if retained or reintroduced as a dedicated dock
- `apps/web/src/browserStateStore.ts`: browser state cache/history
- `apps/desktop/src/browserBridge.ts`: Electron browser bridge state store
- `apps/desktop/src/browserManager.ts`: native browser/webview behavior, only if new browser placement needs bridge changes
- `packages/contracts/src/ipc.ts`: browser IPC contract, only if screenshot/composer attachment APIs need contract changes

Primary tests to update or add:

- `apps/web/src/components/Sidebar.logic.test.ts`
- `apps/web/src/components/ui/sidebar.test.tsx`
- `apps/web/src/workspace/store.test.ts`
- `apps/web/src/components/ChatView.logic.test.ts`
- `apps/web/src/components/chat/MessagesTimeline.test.tsx`
- `apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
- `apps/web/src/components/chat/CompactComposerControlsMenu.browser.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.test.ts`
- `apps/web/src/components/ThreadTerminalDrawer.browser.tsx`
- `apps/web/src/components/BrowserPanel.logic.test.ts`
- `apps/web/src/components/BrowserPanel.browser.tsx` if created
- `apps/desktop/src/browserBridge.test.ts`

## Design Decisions

1. Port DPCode UI as a Wobex theme/layout system, not as a wholesale source replacement.
2. Keep Wobex's current `WorkspaceShell` route-first model, but make it visually behave like DPCode's thread/workspace placements.
3. Use Wobex's existing Lucide icon dependency first. Add `react-icons` or Tabler only if a DPCode glyph has no acceptable Lucide equivalent and the design review explicitly requires it.
4. Keep letter spacing at `0` even where DPCode uses `-0.015em`.
5. Keep cards at `8px` radius or less except composer/popover/dialog shells that already use larger rounded shapes for touch targets.
6. Make the UI dense and utilitarian. Avoid marketing-style empty states or decorative backgrounds.
7. Preserve desktop browser behavior behind the existing Electron bridge. Browser panel UI can change; browser execution/automation contracts should remain stable unless a specific feature requires expansion.

---

### Task 1: Create UI Token Bridge

**Files:**

- Modify: `apps/web/src/index.css`
- Modify: `apps/web/src/lib/appTypography.ts`
- Modify: `apps/web/src/hooks/useAppTypography.ts`
- Test: `apps/web/src/lib/appTypography.test.ts`

- [ ] **Step 1: Add failing token/typography tests**

Add assertions to `apps/web/src/lib/appTypography.test.ts` that lock the DPCode-like Wobex scale:

```ts
it("keeps UI and chat typography dense without negative tracking", () => {
  const scale = getAppTypographyScale(12);
  expect(scale).toMatchObject({
    basePx: 12,
    uiPx: 12,
    uiLgPx: 13,
    uiSmPx: 11,
    uiXsPx: 10,
    ui2XsPx: 9,
    chatPx: 12,
    chatCodePx: 11,
  });
});
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
bun run --cwd apps/web test src/lib/appTypography.test.ts
```

Expected: PASS before and after implementation, confirming the existing Wobex typography helper already supports the required scale.

- [ ] **Step 3: Add DPCode-like Wobex CSS tokens**

In `apps/web/src/index.css`, align the default palette with DPCode's visual structure while keeping Wobex naming:

```css
:root {
  --font-ui-letter-spacing: 0;
  --background: #fcfcfc;
  --app-chrome-background: #fcfcfc;
  --app-sidebar-surface: color-mix(in srgb, #f4f4f5 86%, white);
  --app-sidebar-shadow: none;
  --composer-surface: color-mix(in srgb, var(--background) 98%, white 2%);
  --color-background-surface: #fcfcfc;
  --color-background-surface-under: color-mix(in srgb, #f4f4f5 68%, white);
  --color-background-elevated-primary-opaque: #ffffff;
  --color-background-elevated-secondary: color-mix(in srgb, #000 4%, transparent);
  --color-background-button-secondary: color-mix(in srgb, #000 4%, transparent);
  --color-background-button-secondary-hover: color-mix(in srgb, #000 7%, transparent);
  --color-background-control-opaque: #ffffff;
  --color-text-foreground: var(--foreground);
  --color-text-foreground-secondary: color-mix(in srgb, var(--color-neutral-500) 88%, black);
  --color-text-foreground-tertiary: color-mix(in srgb, var(--color-neutral-500) 72%, transparent);
  --color-text-accent: #526fff;
  --color-border-light: color-mix(in srgb, #000 5%, transparent);
  --color-border-focus: #526fff;
  --color-token-list-hover-background: color-mix(in srgb, #000 4%, transparent);
  --color-token-text-link-foreground: #526fff;
  --color-token-text-link-active-foreground: #2f54ff;
}

:root.dark {
  --background: #0e0e0e;
  --app-chrome-background: #0e0e0e;
  --app-sidebar-surface: color-mix(in srgb, #111 94%, white);
  --composer-surface: color-mix(in srgb, var(--background) 96%, white);
  --color-background-surface: #0e0e0e;
  --color-background-surface-under: color-mix(in srgb, #18181b 82%, black);
  --color-background-elevated-primary-opaque: #171717;
  --color-background-elevated-secondary: color-mix(in srgb, #fff 6%, transparent);
  --color-background-button-secondary: color-mix(in srgb, #fff 6%, transparent);
  --color-background-button-secondary-hover: color-mix(in srgb, #fff 9%, transparent);
  --color-background-control-opaque: #171717;
  --color-text-accent: #6073cc;
  --color-border-light: color-mix(in srgb, #fff 4%, transparent);
  --color-border-focus: #6073cc;
  --color-token-list-hover-background: color-mix(in srgb, #fff 6%, transparent);
  --color-token-text-link-foreground: #6073cc;
  --color-token-text-link-active-foreground: #8fa0ff;
}
```

- [ ] **Step 4: Add shared helper classes**

Add component helpers in the existing `@layer components` block:

```css
.sidebar-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  padding: 0.125rem;
  color: color-mix(in srgb, var(--muted-foreground) 72%, transparent);
  background: transparent;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.sidebar-icon-button:hover {
  color: color-mix(in srgb, var(--foreground) 82%, transparent);
  background: var(--color-background-button-secondary-hover);
}

.app-sidebar-surface {
  background: var(--app-sidebar-surface, var(--card));
  box-shadow: var(--app-sidebar-shadow, none);
  backdrop-filter: var(--app-sidebar-backdrop-filter, none);
  -webkit-backdrop-filter: var(--app-sidebar-backdrop-filter, none);
}

.font-system-ui {
  font-family: var(--font-ui-family);
  letter-spacing: 0;
}
```

- [ ] **Step 5: Verify tokens**

Run:

```powershell
bun run --cwd apps/web test src/lib/appTypography.test.ts
bun run lint
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/index.css apps/web/src/lib/appTypography.test.ts
git commit -m "style: add dpcode-like ui tokens"
```

---

### Task 2: Upgrade Shared Sidebar Primitive

**Files:**

- Modify: `apps/web/src/components/ui/sidebar.tsx`
- Test: `apps/web/src/components/ui/sidebar.test.tsx`

- [ ] **Step 1: Add tests for transparent/resizable sidebar chrome**

Extend `apps/web/src/components/ui/sidebar.test.tsx` to assert support for:

- `transparentSurface`
- `gapClassName`
- `innerClassName`
- `SidebarHeaderTrigger`
- persisted resize storage key behavior

Expected test shape:

```tsx
it("applies custom sidebar gap and inner surface classes", () => {
  const html = renderToStaticMarkup(
    <SidebarProvider>
      <Sidebar
        gapClassName="custom-gap"
        innerClassName="custom-inner"
        transparentSurface
      >
        content
      </Sidebar>
    </SidebarProvider>,
  );

  expect(html).toContain("custom-gap");
  expect(html).toContain("custom-inner");
  expect(html).toContain("bg-transparent");
});
```

- [ ] **Step 2: Run focused sidebar tests**

Run:

```powershell
bun run --cwd apps/web test src/components/ui/sidebar.test.tsx
```

Expected: FAIL until primitive props are added.

- [ ] **Step 3: Add primitive props**

Update `Sidebar` in `apps/web/src/components/ui/sidebar.tsx`:

```ts
type SidebarProps = React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
  gapClassName?: string;
  innerClassName?: string;
  transparentSurface?: boolean;
  resizable?: {
    minWidth: number;
    maxWidth?: number;
    storageKey?: string;
    shouldAcceptWidth?: (input: { nextWidth: number; wrapper: HTMLElement }) => boolean;
  };
};
```

Wire these props into the existing gap/container/inner elements without changing the public exports that current Wobex callers use.

- [ ] **Step 4: Add `SidebarHeaderTrigger`**

Add a compact top-bar trigger modeled on DPCode's small sidebar affordance:

```tsx
function SidebarHeaderTrigger({
  className,
  ...props
}: React.ComponentProps<typeof SidebarTrigger>) {
  return (
    <SidebarTrigger
      className={cn("sidebar-icon-button size-6", className)}
      {...props}
    />
  );
}
```

Export it from the bottom export list.

- [ ] **Step 5: Verify primitive compatibility**

Run:

```powershell
bun run --cwd apps/web test src/components/ui/sidebar.test.tsx
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components/ui/sidebar.tsx apps/web/src/components/ui/sidebar.test.tsx
git commit -m "feat: support dpcode-style sidebar chrome"
```

---

### Task 3: Replace App Shell Placement With DPCode-Style Sidebar Inset

**Files:**

- Modify: `apps/web/src/components/AppSidebarLayout.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/routes/_chat.tsx`
- Modify: `apps/web/src/hooks/useSettings.ts`
- Modify: `packages/contracts/src/settings.ts`
- Test: existing settings tests and route smoke tests

- [ ] **Step 1: Add settings schema support for sidebar side**

In `packages/contracts/src/settings.ts`, add a defaulted setting:

```ts
sidebarSide: Schema.optionalWith(Schema.Literal("left", "right"), {
  default: () => "left" as const,
}),
```

Use the exact local schema style already present in that file.

- [ ] **Step 2: Add or update settings normalization test**

In the relevant settings test file, assert:

```ts
expect(normalizeStoredAppSettings(AppSettingsSchema.makeUnsafe({})).sidebarSide).toBe("left");
```

- [ ] **Step 3: Move chat layout responsibility into `_chat.tsx`**

In `apps/web/src/routes/_chat.tsx`, mount:

- `SidebarProvider`
- `Sidebar`
- `ThreadSidebar`
- `SidebarRail`
- `WorkspaceShell`
- `Outlet`

Use DPCode-like constants:

```ts
const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "wobex_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
```

Use side-aware classes:

```ts
const SIDEBAR_GAP_CLASS = {
  left: "overflow-hidden after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-[color:var(--color-border-light)]",
  right: "overflow-hidden after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-[color:var(--color-border-light)]",
} as const;

const SIDEBAR_INNER_CLASS = {
  left: "app-sidebar-surface border-r border-[color:var(--color-border-light)]",
  right: "app-sidebar-surface border-l border-[color:var(--color-border-light)]",
} as const;
```

- [ ] **Step 4: Simplify `AppSidebarLayout`**

Keep `AppSidebarLayout` as the authenticated wrapper for non-chat routes, but do not double-mount the thread sidebar for `_chat` routes. The route should render:

```tsx
if (pathname.startsWith("/settings")) {
  return <SettingsSidebarLayout>{children}</SettingsSidebarLayout>;
}
if (pathname === "/pair") {
  return <>{children}</>;
}
return <>{children}</>;
```

Retain any Wobex-specific websocket, auth, and bootstrap wrappers in `__root.tsx`.

- [ ] **Step 5: Verify route rendering**

Run:

```powershell
bun run --cwd apps/web test src/appSettings.test.ts
bun run --cwd apps/web test src/threadRoutes.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts/src/settings.ts apps/web/src/hooks/useSettings.ts apps/web/src/components/AppSidebarLayout.tsx apps/web/src/routes/__root.tsx apps/web/src/routes/_chat.tsx apps/web/src/appSettings.test.ts apps/web/src/threadRoutes.test.ts
git commit -m "feat: align app shell with dpcode layout"
```

---

### Task 4: Rebuild Sidebar Content And Pinned Thread Layout

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/Sidebar.logic.ts`
- Modify: `apps/web/src/components/ThreadPinToggleButton.tsx`
- Modify: `apps/web/src/pinnedThreadsStore.ts`
- Test: `apps/web/src/components/Sidebar.logic.test.ts`
- Browser test: add `apps/web/src/components/Sidebar.browser.tsx` if coverage is missing

- [ ] **Step 1: Lock pinned ordering behavior**

Add tests in `Sidebar.logic.test.ts` for:

- pinned threads render before normal project threads
- pinned section dedupes threads already visible in project groups
- project collapse still shows pinned and active thread preview rows
- archived threads do not appear in pinned section

Example:

```ts
it("orders pinned thread keys before regular project rows", () => {
  const result = orderItemsByPreferredIds({
    items: [
      { id: "thread-a", title: "A" },
      { id: "thread-b", title: "B" },
    ],
    preferredIds: ["thread-b"],
    getId: (item) => item.id,
  });

  expect(result.map((item) => item.id)).toEqual(["thread-b", "thread-a"]);
});
```

- [ ] **Step 2: Run focused sidebar logic tests**

Run:

```powershell
bun run --cwd apps/web test src/components/Sidebar.logic.test.ts
```

Expected: failing tests for any new helper not yet implemented.

- [ ] **Step 3: Implement DPCode-like sidebar regions**

Refactor `Sidebar.tsx` into named internal components without changing exported `Sidebar`:

- `SidebarChromeHeader`
- `SidebarModeTabs`
- `SidebarGlobalActions`
- `SidebarPinnedSection`
- `SidebarProjectSection`
- `SidebarThreadRow`
- `SidebarFooterActions`

Target visible order:

```txt
Wobex
[Threads] [Workspace]

New thread
Search

Pinned
  pinned thread rows

Threads
  project row
    thread rows
    Show more

Chats
Settings
```

- [ ] **Step 4: Add top segmented switch**

Implement `Threads`/`Workspace` switch in the sidebar header:

- `Threads` navigates to the active or first thread route
- `Workspace` navigates to the focused workspace route or opens the current thread in workspace
- active state follows current pathname and workspace document focus

Use Wobex route helpers from `apps/web/src/threadRoutes.ts` and `apps/web/src/workspace/store.ts`.

- [ ] **Step 5: Implement DPCode-style row anatomy**

Each thread row should contain:

- pin glyph or pin hover action
- provider glyph
- thread title
- optional meta chip stack for handoff/fork/sidechat/worktree/terminal
- short project/environment label when helpful
- relative age label
- hover action for split/open actions

Keep row height stable at `28px` to `32px`, no text overlap, and no layout shift on hover.

- [ ] **Step 6: Add compact footer**

Footer rows:

- `Chats` collapsible section if Wobex retains chat-only/global chats
- `Settings`
- optional update button, same Wobex update logic as current app

- [ ] **Step 7: Verify sidebar**

Run:

```powershell
bun run --cwd apps/web test src/components/Sidebar.logic.test.ts
bun run --cwd apps/web test src/pinnedThreadsStore.test.ts
bun run --cwd apps/web test src/components/ui/sidebar.test.tsx
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/components/Sidebar.tsx apps/web/src/components/Sidebar.logic.ts apps/web/src/components/ThreadPinToggleButton.tsx apps/web/src/pinnedThreadsStore.ts apps/web/src/components/Sidebar.logic.test.ts apps/web/src/pinnedThreadsStore.test.ts
git commit -m "feat: rebuild sidebar with dpcode placements"
```

---

### Task 5: Rebuild Chat Header Action Strip

**Files:**

- Modify: `apps/web/src/components/chat/ChatHeader.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/components/GitActionsControl.tsx`
- Modify: `apps/web/src/components/AppNavigationButtons.tsx`
- Test: `apps/web/src/components/chat/ChatHeader.test.ts`
- Browser test: `apps/web/src/components/ChatView.browser.tsx`

- [ ] **Step 1: Add header action presentation tests**

In `ChatHeader.test.ts`, assert that the header exposes actions for:

- open in editor
- terminal show/hide
- browser show/hide
- split chat
- add action
- git commit/push control when git data is available

- [ ] **Step 2: Run header tests**

Run:

```powershell
bun run --cwd apps/web test src/components/chat/ChatHeader.test.ts
```

Expected: FAIL until the new action inventory is wired.

- [ ] **Step 3: Implement `ChatHeaderActionMenu`**

Add a local component in `ChatHeader.tsx`:

```tsx
function ChatHeaderActionMenu(props: {
  canOpenInEditor: boolean;
  terminalOpen: boolean;
  browserOpen: boolean;
  diffOpen: boolean;
  workspaceActive: boolean;
  onOpenInEditor: () => void;
  onToggleTerminal: () => void;
  onToggleBrowser: () => void;
  onToggleDiff: () => void;
  onSplitChat: () => void;
  onAddAction: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<button type="button" className="sidebar-icon-button size-7" />} />
      <MenuPopup align="end" side="bottom">
        {/* Open in editor, Show terminal, Hide browser, Split chat, Add action */}
      </MenuPopup>
    </Menu>
  );
}
```

Use Wobex icons and labels, not DPCode branding.

- [ ] **Step 4: Recompose header layout**

Make header match the screenshot structure:

```txt
[Thread title]        [Hand off] [action menu] [Commit & push] [+/- diff stats] [toggle icons]
```

For wide screens, keep one row. For narrow screens, allow action groups to collapse into the menu.

- [ ] **Step 5: Wire actions from `ChatView`**

Pass existing Wobex handlers into `ChatHeader`:

- editor open from available editors/server config
- terminal toggle from `toggleTerminalVisibility`
- diff toggle from `onToggleDiff`
- browser toggle from `WorkspaceWindow` or `BrowserPanel` state
- split chat from `useWorkspaceStore().openThreadInSplit`
- handoff action from existing handoff logic

- [ ] **Step 6: Verify header**

Run:

```powershell
bun run --cwd apps/web test src/components/chat/ChatHeader.test.ts
bun run --cwd apps/web test src/components/ChatView.logic.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/components/chat/ChatHeader.tsx apps/web/src/components/ChatView.tsx apps/web/src/components/GitActionsControl.tsx apps/web/src/components/AppNavigationButtons.tsx apps/web/src/components/chat/ChatHeader.test.ts
git commit -m "feat: add dpcode-style chat header actions"
```

---

### Task 6: Rebuild Transcript And Message Rendering Density

**Files:**

- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- Modify: `apps/web/src/components/chat/ChangedFilesTree.tsx`
- Modify: `apps/web/src/components/chat/ProposedPlanCard.tsx`
- Modify: `apps/web/src/components/chat/ActiveTaskListCard.tsx`
- Modify: `apps/web/src/components/ChatMarkdown.tsx`
- Modify: `apps/web/src/index.css`
- Test: `apps/web/src/components/chat/MessagesTimeline.test.tsx`
- Test: `apps/web/src/components/chat/MessagesTimeline.logic.test.ts`

- [ ] **Step 1: Add timeline rendering expectations**

Update `MessagesTimeline.test.tsx` to assert:

- assistant text uses the `chat-markdown` class
- changed file cards render compact filenames, additions, deletions
- proposed plans render inline cards, not modal-only UI
- active tasks render in transcript flow
- user/assistant messages keep a stable readable max width

- [ ] **Step 2: Run timeline tests**

Run:

```powershell
bun run --cwd apps/web test src/components/chat/MessagesTimeline.test.tsx
bun run --cwd apps/web test src/components/chat/MessagesTimeline.logic.test.ts
```

Expected: existing tests pass, new layout class assertions fail until implementation.

- [ ] **Step 3: Apply DPCode-like transcript classes**

Use:

- max transcript width around `48rem`
- top/bottom spacing from screenshot
- muted metadata using `--app-font-size-chat-meta`
- inline code and code blocks using `--font-chat-code-family`
- file/diff cards with subtle border, no heavy nested card look

- [ ] **Step 4: Add generated image styling if absent**

If Wobex lacks DPCode-style inline generated image controls, add the CSS classes:

- `.chat-generated-image`
- `.chat-generated-image__frame`
- `.chat-generated-image__overlay`
- `.chat-generated-image__overlay-pill`
- `.chat-generated-image--error`

Keep download/expand actions code-native.

- [ ] **Step 5: Verify transcript**

Run:

```powershell
bun run --cwd apps/web test src/components/chat/MessagesTimeline.test.tsx
bun run --cwd apps/web test src/components/chat/MessagesTimeline.logic.test.ts
bun run --cwd apps/web test src/markdown-links.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components/chat/MessagesTimeline.tsx apps/web/src/components/chat/MessagesTimeline.logic.ts apps/web/src/components/chat/ChangedFilesTree.tsx apps/web/src/components/chat/ProposedPlanCard.tsx apps/web/src/components/chat/ActiveTaskListCard.tsx apps/web/src/components/ChatMarkdown.tsx apps/web/src/index.css apps/web/src/components/chat/MessagesTimeline.test.tsx apps/web/src/components/chat/MessagesTimeline.logic.test.ts
git commit -m "style: align transcript with dpcode display"
```

---

### Task 7: Rebuild Bottom Composer And Compact Controls

**Files:**

- Modify: `apps/web/src/components/chat/ChatComposer.tsx`
- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`
- Modify: `apps/web/src/components/chat/ProviderModelPicker.tsx`
- Modify: `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`
- Modify: `apps/web/src/components/chat/ComposerExtrasMenu.tsx`
- Modify: `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- Modify: `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`
- Modify: `apps/web/src/components/chat/ComposerPendingTerminalContexts.tsx`
- Test: `apps/web/src/composer-logic.test.ts`
- Test: `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
- Test: `apps/web/src/components/chat/CompactComposerControlsMenu.browser.tsx`

- [ ] **Step 1: Add composer layout browser checks**

In browser tests, assert:

- composer surface is bottom anchored
- model picker, effort picker, runtime/env mode, voice/mic, plus/attachments, and send button are visible
- send button stays circular and does not resize with text
- pending approvals/user inputs render inside composer flow

- [ ] **Step 2: Run composer tests**

Run:

```powershell
bun run --cwd apps/web test src/composer-logic.test.ts
bun run --cwd apps/web test:browser src/components/chat/ProviderModelPicker.browser.tsx
bun run --cwd apps/web test:browser src/components/chat/CompactComposerControlsMenu.browser.tsx
```

Expected: browser assertions fail until UI is adjusted.

- [ ] **Step 3: Apply composer surface**

Use this surface anatomy:

```txt
rounded composer shell
  prompt editor
  reference/attachment chips
  pending approval/user-input panels
  footer:
    plus/menu
    provider model picker
    effort picker
    runtime mode
    terminal/context indicators
    spacer
    voice/mic
    circular send/stop button
```

Keep `ChatComposer` state and send behavior unchanged.

- [ ] **Step 4: Keep controls code-native**

Do not hide controls behind a screenshot-like static UI. Buttons, menus, pickers, approvals, user inputs, and attachments must remain keyboard/focus accessible.

- [ ] **Step 5: Verify composer**

Run:

```powershell
bun run --cwd apps/web test src/composer-logic.test.ts
bun run --cwd apps/web test src/components/composerFooterLayout.test.ts
bun run --cwd apps/web test src/components/chat/ComposerPendingTerminalContexts.test.tsx
bun run --cwd apps/web test:browser src/components/chat/ProviderModelPicker.browser.tsx
bun run --cwd apps/web test:browser src/components/chat/CompactComposerControlsMenu.browser.tsx
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components/chat/ChatComposer.tsx apps/web/src/components/ComposerPromptEditor.tsx apps/web/src/components/chat/ProviderModelPicker.tsx apps/web/src/components/chat/CompactComposerControlsMenu.tsx apps/web/src/components/chat/ComposerExtrasMenu.tsx apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx apps/web/src/components/chat/ComposerPendingTerminalContexts.tsx apps/web/src/components/chat/ProviderModelPicker.browser.tsx apps/web/src/components/chat/CompactComposerControlsMenu.browser.tsx
git commit -m "feat: rebuild composer controls like dpcode"
```

---

### Task 8: Rebuild Browser, Diff, And Workspace Dock Placement

**Files:**

- Modify: `apps/web/src/components/WorkspaceWindow.tsx`
- Modify: `apps/web/src/components/BrowserPanel.tsx`
- Modify: `apps/web/src/components/BrowserPanel.logic.ts`
- Modify: `apps/web/src/browserStateStore.ts`
- Modify: `apps/web/src/components/DiffPanel.tsx`
- Modify: `apps/web/src/diffRouteSearch.ts`
- Modify: `apps/desktop/src/browserBridge.ts`
- Modify: `apps/desktop/src/browserManager.ts` only if native placement or screenshot behavior needs expansion
- Test: `apps/web/src/components/BrowserPanel.logic.test.ts`
- Test: `apps/web/src/browserStateStore.test.ts`
- Test: `apps/web/src/diffRouteSearch.test.ts`
- Test: `apps/desktop/src/browserBridge.test.ts`

- [ ] **Step 1: Add dock state tests**

Add tests for:

- browser panel can be visible, hidden, or closed per thread
- panel width persists per thread or globally with a migration-safe storage key
- diff and browser can coexist without reducing chat below minimum width
- web fallback iframe does not expose desktop-only screenshot controls

- [ ] **Step 2: Run focused tests**

Run:

```powershell
bun run --cwd apps/web test src/components/BrowserPanel.logic.test.ts
bun run --cwd apps/web test src/browserStateStore.test.ts
bun run --cwd apps/web test src/diffRouteSearch.test.ts
bun run --cwd apps/desktop test src/browserBridge.test.ts
```

Expected: new tests fail until dock state is implemented.

- [ ] **Step 3: Choose one dock owner**

Use `WorkspaceWindow` as the single right-dock owner if it already covers plan/explorer/preview/git/browser/graph in Wobex. If `BrowserPanel` has newer DPCode browser chrome that Wobex lacks, move its visual chrome into a `WorkspaceWindow` browser tab instead of running two independent dock systems.

- [ ] **Step 4: Implement right dock anatomy**

Target:

```txt
chat main column | right dock
right dock header:
  tabs or compact icon strip
  browser controls when browser tab active
  close/hide button
right dock body:
  browser webview/iframe
  diff panel
  plan/explorer/preview/git views
```

Persist width with a new key such as `wobex_right_dock_width`.

- [ ] **Step 5: Add browser screenshot-to-composer workflow**

If the desktop bridge already exposes screenshot capture, wire:

- capture screenshot
- copy screenshot
- attach screenshot to composer

Keep this behind feature detection:

```ts
const canCaptureBrowserScreenshot =
  isElectron && typeof window.desktopBridge?.browser?.captureScreenshot === "function";
```

Do not expose capture buttons in web fallback mode.

- [ ] **Step 6: Verify dock/browser behavior**

Run:

```powershell
bun run --cwd apps/web test src/components/BrowserPanel.logic.test.ts
bun run --cwd apps/web test src/browserStateStore.test.ts
bun run --cwd apps/web test src/diffRouteSearch.test.ts
bun run --cwd apps/desktop test src/browserBridge.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/components/WorkspaceWindow.tsx apps/web/src/components/BrowserPanel.tsx apps/web/src/components/BrowserPanel.logic.ts apps/web/src/browserStateStore.ts apps/web/src/components/DiffPanel.tsx apps/web/src/diffRouteSearch.ts apps/desktop/src/browserBridge.ts apps/desktop/src/browserManager.ts apps/web/src/components/BrowserPanel.logic.test.ts apps/web/src/browserStateStore.test.ts apps/web/src/diffRouteSearch.test.ts apps/desktop/src/browserBridge.test.ts
git commit -m "feat: add dpcode-style browser dock"
```

---

### Task 9: Reconcile Workspace And Split Chat Behavior

**Files:**

- Modify: `apps/web/src/components/workspace/WorkspaceShell.tsx`
- Modify: `apps/web/src/components/workspace/WorkspaceRouteSync.tsx`
- Modify: `apps/web/src/workspace/store.ts`
- Modify: `apps/web/src/workspace/types.ts`
- Modify: `apps/web/src/routes/_chat.workspace.$environmentId.$threadId.tsx`
- Modify: `apps/web/src/threadRoutes.ts`
- Test: `apps/web/src/workspace/store.test.ts`
- Test: `apps/web/src/threadRoutes.test.ts`

- [ ] **Step 1: Add workspace behavior tests**

In `workspace/store.test.ts`, assert:

- opening a thread focuses existing surface if already open
- splitting right/down creates stable two-pane layout
- closing active surface focuses a sibling deterministically
- mobile active pane survives route sync
- pinned/sidebar split action opens the target thread in workspace

- [ ] **Step 2: Run workspace tests**

Run:

```powershell
bun run --cwd apps/web test src/workspace/store.test.ts
bun run --cwd apps/web test src/threadRoutes.test.ts
```

Expected: new tests fail where current workspace behavior differs.

- [ ] **Step 3: Make workspace visually match DPCode**

Update `WorkspaceShell.tsx`:

- remove heavy framed card appearance from empty state
- use thin split handles
- use compact tab strip with close/split buttons
- keep pane chrome smaller than chat content
- make focus ring subtle
- keep panes stable under hover and active changes

- [ ] **Step 4: Add sidebar `Workspace` tab integration**

The sidebar `Workspace` tab should:

- open current thread in workspace when a thread is active
- otherwise open the first existing workspace surface
- otherwise show a compact empty workspace state

- [ ] **Step 5: Verify workspace**

Run:

```powershell
bun run --cwd apps/web test src/workspace/store.test.ts
bun run --cwd apps/web test src/threadRoutes.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components/workspace/WorkspaceShell.tsx apps/web/src/components/workspace/WorkspaceRouteSync.tsx apps/web/src/workspace/store.ts apps/web/src/workspace/types.ts apps/web/src/routes/_chat.workspace.$environmentId.$threadId.tsx apps/web/src/threadRoutes.ts apps/web/src/workspace/store.test.ts apps/web/src/threadRoutes.test.ts
git commit -m "feat: refine workspace split chat layout"
```

---

### Task 10: Visual QA And Accessibility Pass

**Files:**

- Modify: files touched in Tasks 1-9 only as needed
- Create: `apps/web/src/components/__screenshots__/README.md` only if the team wants checked-in visual QA notes; otherwise keep screenshots out of git

- [ ] **Step 1: Run app locally**

Run:

```powershell
bun run dev
```

Open the local Vite URL printed by the command.

- [ ] **Step 2: Verify desktop layout**

Check at `1989x1233` or similar wide desktop size:

- sidebar width and density matches the supplied DPCode screenshot
- `Threads`/`Workspace` segmented switch is visible
- pinned section appears above normal thread groups
- chat header action menu placement matches screenshot
- browser/diff dock appears on the right and can hide/show
- composer sits at the bottom and matches DPCode control density
- no text overlaps or clipped labels

- [ ] **Step 3: Verify Windows and Linux visual assumptions**

On Windows, verify:

- titlebar drag regions do not block buttons
- scrollbars are thin and usable
- sidebar resize does not block native window resizing
- terminal fonts fall back correctly if JetBrainsMono NFM is absent

- [ ] **Step 4: Verify mobile/narrow layout**

Use browser dev tools or Playwright to check:

- sidebar becomes offcanvas
- right dock becomes sheet or hidden panel
- composer controls collapse into compact menus
- header title truncates without pushing actions off screen

- [ ] **Step 5: Run browser tests**

Run:

```powershell
bun run --cwd apps/web test:browser
```

Expected: all browser tests pass. If browser dependencies are missing, run:

```powershell
bun run --cwd apps/web test:browser:install
bun run --cwd apps/web test:browser
```

- [ ] **Step 6: Final full gate**

Run:

```powershell
bun fmt
bun lint
bun typecheck
bun run test
```

Expected: all commands pass.

- [ ] **Step 7: Final commit**

```powershell
git status --short
git add apps/web apps/desktop packages/contracts packages/shared
git commit -m "feat: port dpcode ui placements"
```

Do not stage unrelated `bun.lock` changes unless dependency changes were intentionally made by this implementation.

---

## Implementation Order

Recommended order:

1. Task 1: tokens
2. Task 2: sidebar primitive
3. Task 3: app shell
4. Task 4: sidebar content
5. Task 5: chat header
6. Task 7: composer
7. Task 6: transcript
8. Task 8: browser/diff dock
9. Task 9: workspace/split chat
10. Task 10: visual QA

Reason: the token and shell work creates the visual foundation; sidebar and header then establish the screenshot skeleton; composer/transcript fill the chat surface; browser/workspace/diff become safer once the shell width and focus rules are stable.

## Suggested Parallelization

Use sub-agents once Tasks 1-3 are complete:

- Worker A: Task 4 sidebar content and tests
- Worker B: Task 5 chat header and tests
- Worker C: Task 7 composer and tests
- Worker D: Task 8 browser/diff dock, after Worker B exposes header actions

Do not run two workers on `ChatView.tsx` at the same time unless they have explicit non-overlapping hunks. `ChatView.tsx`, `Sidebar.tsx`, and `index.css` are merge-conflict hotspots.

## Risk Register

- **High:** `Sidebar.tsx` and `ChatView.tsx` are large mixed state/UI components. Mitigation: extract local subcomponents before changing behavior.
- **High:** Workspace route sync can fight manual pane focus. Mitigation: add focused store tests before visual changes.
- **High:** Browser panel behavior differs between Electron and web fallback. Mitigation: feature-detect desktop bridge and keep fallback inert where native APIs are missing.
- **Medium:** DPCode uses some dependencies Wobex does not have, including `react-icons`, `katex`, and several xterm addons. Mitigation: do not add dependencies for visual parity unless the specific UI requires them.
- **Medium:** Local storage keys may preserve old widths/layouts and make QA misleading. Mitigation: use new `wobex_*` storage keys or migration-safe normalization.
- **Medium:** DPCode theme tokens include negative letter spacing. Mitigation: keep Wobex tracking at `0`.
- **Low:** MIT attribution may be missed if code is copied too directly. Mitigation: preserve notices in copied/adapted files and mention source in commit messages.

## Acceptance Criteria

- First viewport visually matches the supplied DPCode screenshot in structure: left sidebar, central chat, right browser/dock, compact top header, bottom composer.
- Wobex branding remains visible and no DPCode product names appear in app chrome.
- Pinned threads, project threads, search, new thread, settings, workspace tab, and split chat are usable.
- Browser panel can show/hide and does not break web fallback.
- Terminal drawer/workspace mode still works.
- Diff panel still opens from routes and header controls.
- Composer sends, interrupts, handles approvals, handles user input, handles attachments, and preserves provider/model/runtime controls.
- No text overlaps at desktop or mobile widths.
- Relevant focused tests pass after every task.
- Final gate passes: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`.
- No push, deploy, or production test is performed.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-dpcode-ui-port.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended choice: Subagent-Driven, because the sidebar, chat header, composer, browser dock, and workspace changes are parallelizable after the token/shell foundation is done.
