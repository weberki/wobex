import { type EnvironmentId, type ScopedThreadRef, type ThreadId } from "@wobex/contracts";
import { scopeProjectRef, scopeThreadRef } from "@wobex/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  GitBranchIcon,
  LoaderIcon,
  PanelRightIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquareSplitHorizontalIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildTerminalPaneLayoutFromPreset,
  type TerminalPaneLayoutNode,
} from "../terminalPaneLayout";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { DEFAULT_THREAD_TERMINAL_ID, type Project, type Thread } from "../types";
import {
  DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID,
  ensureWorkspaceTerminalIdsForPreset,
  normalizeWorkspaceTerminalLayoutPresetId,
  type WorkspaceTerminalLayoutPresetId,
} from "../workspaceTerminalLayoutPresets";
import { useGitStatus } from "../lib/gitStatusState";
import { randomUUID } from "../lib/utils";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useServerAvailableEditors } from "../rpc/serverState";
import { buildThreadRouteParams } from "../threadRoutes";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { useStore } from "../store";
import { ThreadWorktreeHandoffDialog } from "./ThreadWorktreeHandoffDialog";
import { TerminalViewport } from "./ThreadTerminalDrawer";
import {
  WorkspaceWindow,
  WorkspaceWindowTabSchema,
  workspaceTabStorageKey,
} from "./WorkspaceWindow";
import { WorkspaceSettingsSheet } from "./WorkspaceSettingsSheet";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";

function terminalLabel(terminalIds: readonly string[], terminalId: string): string {
  const index = terminalIds.indexOf(terminalId);
  return terminalId === DEFAULT_THREAD_TERMINAL_ID
    ? "Terminal 1"
    : `Terminal ${index >= 0 ? index + 1 : terminalIds.length + 1}`;
}

function terminalMatchesQuery(terminalId: string, label: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return true;
  return (
    terminalId.toLowerCase().includes(normalizedQuery) ||
    label.toLowerCase().includes(normalizedQuery)
  );
}

function useWindowResizeEpoch() {
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 720 : window.innerHeight,
  );

  useEffect(() => {
    const onResize = () => {
      setViewportHeight(window.innerHeight);
      setResizeEpoch((current) => current + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { resizeEpoch, viewportHeight };
}

export function WorkspaceView({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const thread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const projectRef = thread ? scopeProjectRef(environmentId, thread.projectId) : null;
  const project = useStore(useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]));

  if (!thread) {
    return (
      <Empty className="min-h-screen">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TerminalSquareIcon className="size-5" />
          </EmptyMedia>
          <EmptyTitle>Workspace thread not found</EmptyTitle>
          <EmptyDescription>
            The workspace route is additive, so the main chat route remains unchanged.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <WorkspaceThreadView threadRef={threadRef} thread={thread} project={project ?? null} />;
}

function WorkspaceThreadView({
  threadRef,
  thread,
  project,
}: {
  threadRef: ScopedThreadRef;
  thread: Thread;
  project: Project | null;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const { resolvedTheme } = useTheme();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const availableEditors = useServerAvailableEditors();
  const workspaceRoot = thread.worktreePath ?? project?.cwd ?? undefined;
  const gitCwd = workspaceRoot ?? null;
  const gitStatus = useGitStatus({ environmentId: thread.environmentId, cwd: gitCwd });
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadKey, threadRef),
  );
  const ensureTerminal = useTerminalStateStore((state) => state.ensureTerminal);
  const setActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const splitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const closeTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const setTerminalOpen = useTerminalStateStore((state) => state.setTerminalOpen);
  const setWorkspaceLayoutPreset = useTerminalStateStore((state) => state.setWorkspaceLayoutPreset);
  const [workspaceWindowOpen, setWorkspaceWindowOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [terminalQuery, setTerminalQuery] = useState("");
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const { resizeEpoch, viewportHeight } = useWindowResizeEpoch();
  const [workspaceWindowTab, setWorkspaceWindowTab] = useLocalStorage(
    workspaceTabStorageKey(thread.environmentId),
    "explorer",
    WorkspaceWindowTabSchema,
  );
  const selectedPresetId = normalizeWorkspaceTerminalLayoutPresetId(
    terminalState.workspaceLayoutPresetId ?? DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID,
  );

  useEffect(() => {
    setTerminalOpen(threadRef, true);
    const requiredTerminalIds = ensureWorkspaceTerminalIdsForPreset(
      terminalState.terminalIds,
      selectedPresetId,
      () => `workspace-${randomUUID()}`,
    );
    for (const terminalId of requiredTerminalIds) {
      if (terminalState.terminalIds.includes(terminalId)) {
        continue;
      }
      ensureTerminal(threadRef, terminalId, { open: true, active: false });
    }
  }, [ensureTerminal, selectedPresetId, setTerminalOpen, terminalState.terminalIds, threadRef]);

  const runtimeEnv = useMemo(
    () => (thread.worktreePath ? { WOBEX_WORKTREE_PATH: thread.worktreePath } : undefined),
    [thread.worktreePath],
  );
  const visibleTerminalIds = useMemo(
    () =>
      terminalState.terminalIds.filter((terminalId) =>
        terminalMatchesQuery(
          terminalId,
          terminalLabel(terminalState.terminalIds, terminalId),
          terminalQuery,
        ),
      ),
    [terminalQuery, terminalState.terminalIds],
  );
  const layout = useMemo(
    () =>
      buildTerminalPaneLayoutFromPreset({
        presetId: selectedPresetId,
        terminalIds: visibleTerminalIds.length > 0 ? visibleTerminalIds : terminalState.terminalIds,
        activeTerminalId: terminalState.activeTerminalId,
      }),
    [
      selectedPresetId,
      terminalState.activeTerminalId,
      terminalState.terminalIds,
      visibleTerminalIds,
    ],
  );
  const focusTerminal = useCallback(
    (terminalId: string) => {
      setActiveTerminal(threadRef, terminalId);
      setFocusRequestId((current) => current + 1);
    },
    [setActiveTerminal, threadRef],
  );
  const addTerminal = useCallback(() => {
    const terminalId = `workspace-${randomUUID()}`;
    ensureTerminal(threadRef, terminalId, { open: true, active: true });
    setFocusRequestId((current) => current + 1);
  }, [ensureTerminal, threadRef]);
  const splitActiveTerminal = useCallback(() => {
    splitTerminal(threadRef, terminalState.activeTerminalId);
    setFocusRequestId((current) => current + 1);
  }, [splitTerminal, terminalState.activeTerminalId, threadRef]);
  const goBackToChat = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  }, [navigate, threadRef]);
  const selectPreset = useCallback(
    (presetId: WorkspaceTerminalLayoutPresetId) => {
      setWorkspaceLayoutPreset(threadRef, presetId);
    },
    [setWorkspaceLayoutPreset, threadRef],
  );

  if (!workspaceRoot) {
    return (
      <Empty className="min-h-screen">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TerminalSquareIcon className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No workspace path</EmptyTitle>
          <EmptyDescription>
            The workspace view becomes available once this thread has a project cwd or worktree.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-b border-border/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                onClick={goBackToChat}
                aria-label="Back to chat"
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-base font-semibold">{thread.title}</h1>
                  {project ? <Badge variant="outline">{project.name}</Badge> : null}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {workspaceRoot}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {gitStatus.isPending ? (
                <Badge variant="outline" className="gap-1.5">
                  <LoaderIcon className="size-3 animate-spin" />
                  Git
                </Badge>
              ) : gitStatus.data?.branch ? (
                <Badge variant="outline" className="gap-1.5">
                  <GitBranchIcon className="size-3" />
                  {gitStatus.data.branch}
                </Badge>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHandoffOpen(true)}
                disabled={!project?.cwd}
              >
                <GitBranchIcon className="size-3.5" />
                Handoff
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="size-3.5" />
                Layout
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant={workspaceWindowOpen ? "default" : "outline"}
                onClick={() => setWorkspaceWindowOpen((open) => !open)}
                aria-label="Toggle workspace side panel"
              >
                <PanelRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="relative min-w-56 max-w-sm flex-1">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
                <Input
                  value={terminalQuery}
                  onChange={(event) => setTerminalQuery(event.currentTarget.value)}
                  className="h-8 pl-8"
                  placeholder="Find terminal"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
                {terminalState.terminalIds.map((terminalId) => {
                  const active = terminalId === terminalState.activeTerminalId;
                  const running = terminalState.runningTerminalIds.includes(terminalId);
                  return (
                    <Button
                      key={terminalId}
                      type="button"
                      size="xs"
                      variant={active ? "default" : "outline"}
                      className="gap-1.5"
                      onClick={() => focusTerminal(terminalId)}
                    >
                      <span
                        className={
                          running
                            ? "size-1.5 rounded-full bg-emerald-400"
                            : "size-1.5 rounded-full bg-muted-foreground/30"
                        }
                      />
                      {terminalLabel(terminalState.terminalIds, terminalId)}
                    </Button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={splitActiveTerminal}
                  aria-label="Split terminal horizontally"
                >
                  <SquareSplitHorizontalIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={addTerminal}
                  aria-label="Add terminal"
                >
                  <PlusIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={() => closeTerminal(threadRef, terminalState.activeTerminalId)}
                  disabled={terminalState.terminalIds.length <= 1}
                  aria-label="Close active terminal"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 p-2">
              {visibleTerminalIds.length === 0 ? (
                <Empty className="min-h-full">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SearchIcon className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>No terminal matches</EmptyTitle>
                    <EmptyDescription>
                      Clear the terminal search to restore the layout.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <WorkspaceTerminalLayout
                  node={layout}
                  threadRef={threadRef}
                  thread={thread}
                  terminalIds={terminalState.terminalIds}
                  runningTerminalIds={terminalState.runningTerminalIds}
                  activeTerminalId={terminalState.activeTerminalId}
                  cwd={workspaceRoot}
                  runtimeEnv={runtimeEnv}
                  focusRequestId={focusRequestId}
                  resizeEpoch={resizeEpoch}
                  drawerHeight={Math.max(320, viewportHeight - 160)}
                  onFocusTerminal={focusTerminal}
                  onCloseTerminal={(terminalId) => closeTerminal(threadRef, terminalId)}
                />
              )}
            </div>
          </section>

          <WorkspaceWindow
            environmentId={thread.environmentId}
            open={workspaceWindowOpen}
            activeTab={workspaceWindowTab}
            onTabChange={setWorkspaceWindowTab}
            onClose={() => setWorkspaceWindowOpen(false)}
            workspaceRoot={workspaceRoot}
            markdownCwd={gitCwd ?? undefined}
            timestampFormat={settings.timestampFormat}
            activePlan={null}
            activeProposedPlan={null}
            workLogEntries={[]}
            activeThread={thread}
            activeProjectName={project?.name}
            gitCwd={gitCwd}
            resolvedTheme={resolvedTheme}
            availableEditors={availableEditors}
            canOpenInEditor={Boolean(
              primaryEnvironmentId && thread.environmentId === primaryEnvironmentId,
            )}
            selectedPreviewPath={selectedPreviewPath}
            onSelectPreviewPath={setSelectedPreviewPath}
          />
        </div>
      </main>

      <WorkspaceSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        workspaceTitle={project?.name ?? thread.title}
        selectedPresetId={selectedPresetId}
        onSelectPreset={selectPreset}
        terminalIds={terminalState.terminalIds}
        activeTerminalId={terminalState.activeTerminalId}
      />
      <ThreadWorktreeHandoffDialog
        open={handoffOpen}
        environmentId={thread.environmentId}
        thread={thread}
        projectCwd={project?.cwd ?? null}
        currentGitBranch={gitStatus.data?.branch ?? thread.branch}
        onOpenChange={setHandoffOpen}
      />
    </div>
  );
}

function WorkspaceTerminalLayout({
  node,
  threadRef,
  thread,
  terminalIds,
  runningTerminalIds,
  activeTerminalId,
  cwd,
  runtimeEnv,
  focusRequestId,
  resizeEpoch,
  drawerHeight,
  onFocusTerminal,
  onCloseTerminal,
}: {
  node: TerminalPaneLayoutNode;
  threadRef: ScopedThreadRef;
  thread: Thread;
  terminalIds: readonly string[];
  runningTerminalIds: readonly string[];
  activeTerminalId: string;
  cwd: string;
  runtimeEnv: Record<string, string> | undefined;
  focusRequestId: number;
  resizeEpoch: number;
  drawerHeight: number;
  onFocusTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
}) {
  if (node.type === "split") {
    return (
      <div
        className={
          node.direction === "horizontal"
            ? "flex h-full min-h-0 min-w-0 gap-2"
            : "flex h-full min-h-0 min-w-0 flex-col gap-2"
        }
      >
        {node.children.map((child) => (
          <div
            key={child.type === "terminal" ? child.paneId : child.id}
            className="min-h-0 min-w-0 flex-1"
          >
            <WorkspaceTerminalLayout
              node={child}
              threadRef={threadRef}
              thread={thread}
              terminalIds={terminalIds}
              runningTerminalIds={runningTerminalIds}
              activeTerminalId={activeTerminalId}
              cwd={cwd}
              runtimeEnv={runtimeEnv}
              focusRequestId={focusRequestId}
              resizeEpoch={resizeEpoch}
              drawerHeight={drawerHeight}
              onFocusTerminal={onFocusTerminal}
              onCloseTerminal={onCloseTerminal}
            />
          </div>
        ))}
      </div>
    );
  }

  const paneActiveTerminalId = node.terminalIds.includes(activeTerminalId)
    ? activeTerminalId
    : node.activeTerminalId;
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/45">
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {node.terminalIds.map((terminalId) => {
            const running = runningTerminalIds.includes(terminalId);
            const active = terminalId === paneActiveTerminalId;
            return (
              <button
                key={terminalId}
                type="button"
                className={
                  active
                    ? "inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
                    : "inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                }
                onClick={() => onFocusTerminal(terminalId)}
              >
                <span
                  className={
                    running
                      ? "size-1.5 rounded-full bg-emerald-400"
                      : "size-1.5 rounded-full bg-muted-foreground/30"
                  }
                />
                {terminalLabel(terminalIds, terminalId)}
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={terminalIds.length <= 1}
          onClick={() => onCloseTerminal(paneActiveTerminalId)}
          aria-label="Close terminal pane"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 p-1">
        <TerminalViewport
          key={paneActiveTerminalId}
          threadRef={threadRef}
          threadId={thread.id}
          terminalId={paneActiveTerminalId}
          terminalLabel={terminalLabel(terminalIds, paneActiveTerminalId)}
          cwd={cwd}
          worktreePath={thread.worktreePath}
          {...(runtimeEnv ? { runtimeEnv } : {})}
          onSessionExited={() => onCloseTerminal(paneActiveTerminalId)}
          onAddTerminalContext={() => undefined}
          focusRequestId={focusRequestId}
          autoFocus={paneActiveTerminalId === activeTerminalId}
          resizeEpoch={resizeEpoch}
          drawerHeight={drawerHeight}
        />
      </div>
    </section>
  );
}
