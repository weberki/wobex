import {
  type EditorId,
  type EnvironmentId,
  type ProjectReadFileResult,
  type BrowserTabState,
  type ThreadBrowserState,
  TurnId,
  type TimestampFormat,
} from "@wobex/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AudioLinesIcon,
  BookOpenIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  FileIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GlobeIcon,
  ImageIcon,
  Link2Icon,
  LoaderIcon,
  PanelRightCloseIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  WaypointsIcon,
} from "lucide-react";
import { Schema } from "effect";
import {
  type FormEvent,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { gitBranchSearchInfiniteQueryOptions } from "~/lib/gitReactQuery";
import {
  projectListTreeQueryOptions,
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import { openInPreferredEditor } from "~/editorPreferences";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import type { ActivePlanState, LatestProposedPlanState, WorkLogEntry } from "../session-logic";
import type { Thread, TurnDiffFileChange } from "../types";
import { basenameOfPath } from "../vscode-icons";
import { ActivitySummaryPanel } from "./ActivitySummaryPanel";
import ChatMarkdown from "./ChatMarkdown";
import { ChangedFilesTree } from "./chat/ChangedFilesTree";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { deriveActivitySummaryModel } from "./activitySummary.logic";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

export const WorkspaceWindowTabSchema = Schema.Literals([
  "plan",
  "explorer",
  "preview",
  "git",
  "browser",
  "graph",
]);
export type WorkspaceWindowTab = typeof WorkspaceWindowTabSchema.Type;

const WORKSPACE_WINDOW_WIDTH_KEY = "wobex:workspace-window-width";
const WORKSPACE_WINDOW_MIN_WIDTH = 320;
const WORKSPACE_WINDOW_MAX_WIDTH = 760;
const WORKSPACE_BROWSER_EMPTY_URL = "about:blank";
const WORKSPACE_FILE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const WORKSPACE_GIT_TREE_TURN_ID = TurnId.make("workspace-git-status");
const WORKSPACE_WINDOW_TABS = [
  { value: "plan", label: "Plan", Icon: BookOpenIcon },
  { value: "explorer", label: "Explorer", Icon: FolderTreeIcon },
  { value: "preview", label: "Preview", Icon: FileCode2Icon },
  { value: "git", label: "Git", Icon: GitBranchIcon },
  { value: "browser", label: "Browser", Icon: GlobeIcon },
  { value: "graph", label: "Graph", Icon: WaypointsIcon },
] as const satisfies ReadonlyArray<{
  value: WorkspaceWindowTab;
  label: string;
  Icon: typeof BookOpenIcon;
}>;

export function workspaceTabStorageKey(environmentId: EnvironmentId) {
  return `wobex:workspace-window-tab:${environmentId}`;
}

function workspaceBrowserUrlStorageKey(environmentId: EnvironmentId) {
  return `wobex:workspace-browser-url:${environmentId}`;
}

function clampWorkspaceWindowWidth(width: number): number {
  return Math.min(
    WORKSPACE_WINDOW_MAX_WIDTH,
    Math.max(WORKSPACE_WINDOW_MIN_WIDTH, Math.round(width)),
  );
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return WORKSPACE_BROWSER_EMPTY_URL;
  }
  if (trimmed === WORKSPACE_BROWSER_EMPTY_URL) {
    return WORKSPACE_BROWSER_EMPTY_URL;
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+:\d+)(\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function isMarkdownPreview(relativePath: string, mimeType: string): boolean {
  return (
    mimeType.includes("markdown") ||
    relativePath.endsWith(".md") ||
    relativePath.endsWith(".mdx") ||
    relativePath.endsWith(".markdown")
  );
}

function isRenderableBinaryPreview(result: {
  kind: "binary";
  mimeType: string;
  truncated: boolean;
  bytesBase64: string;
}) {
  if (result.truncated) {
    return false;
  }
  return (
    result.mimeType.startsWith("image/") ||
    result.mimeType.startsWith("audio/") ||
    result.mimeType.startsWith("video/") ||
    result.mimeType === "application/pdf"
  );
}

export const WorkspaceWindow = memo(function WorkspaceWindow(props: {
  environmentId: EnvironmentId;
  open: boolean;
  activeTab: WorkspaceWindowTab;
  onTabChange: (tab: WorkspaceWindowTab) => void;
  onClose: () => void;
  workspaceRoot: string | undefined;
  markdownCwd: string | undefined;
  timestampFormat: TimestampFormat;
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  activeThread: Thread;
  activeProjectName: string | undefined;
  gitCwd: string | null;
  resolvedTheme: "light" | "dark";
  availableEditors: ReadonlyArray<EditorId>;
  canOpenInEditor: boolean;
  selectedPreviewPath: string | null;
  onSelectPreviewPath: (relativePath: string | null) => void;
}) {
  const [storedWidth, setStoredWidth] = useLocalStorage(
    WORKSPACE_WINDOW_WIDTH_KEY,
    400,
    Schema.Finite,
  );
  const width = clampWorkspaceWindowWidth(storedWidth);
  const resizeRef = useRef<{ startWidth: number; startX: number } | null>(null);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const resizeState = resizeRef.current;
      if (!resizeState) {
        return;
      }
      const nextWidth = clampWorkspaceWindowWidth(
        resizeState.startWidth - (event.clientX - resizeState.startX),
      );
      setStoredWidth(nextWidth);
    },
    [setStoredWidth],
  );

  const handlePointerUp = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
  }, [handlePointerMove]);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      resizeRef.current = {
        startWidth: width,
        startX: event.clientX,
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [handlePointerMove, handlePointerUp, width],
  );

  useEffect(() => () => handlePointerUp(), [handlePointerUp]);

  if (!props.open) {
    return null;
  }

  const activeTabDefinition =
    WORKSPACE_WINDOW_TABS.find((tab) => tab.value === props.activeTab) ?? WORKSPACE_WINDOW_TABS[0];

  return (
    <aside
      className="relative flex min-h-0 shrink-0 border-l border-[color:var(--color-border-light,var(--border))] bg-background font-system-ui"
      style={{ width }}
    >
      <button
        type="button"
        aria-label="Resize workspace window"
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize bg-transparent hover:bg-[var(--color-border-light,var(--border))]"
        onPointerDown={beginResize}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-12 items-center justify-between border-b border-[color:var(--color-border-light,var(--border))] px-3 py-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <activeTabDefinition.Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="truncate text-sm font-medium">{activeTabDefinition.label}</span>
            </div>
            {props.workspaceRoot ? (
              <p className="truncate pt-0.5 font-mono text-[10px] text-muted-foreground/65">
                {props.workspaceRoot}
              </p>
            ) : null}
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={props.onClose}
            aria-label="Close workspace window"
            className="text-muted-foreground/60 hover:text-foreground/80"
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </div>
        <div className="border-b border-[color:var(--color-border-light,var(--border))] px-2 py-2">
          <ToggleGroup
            aria-label="Workspace tabs"
            className="flex w-full flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            orientation="horizontal"
            value={[props.activeTab]}
          >
            {WORKSPACE_WINDOW_TABS.map(({ value, label, Icon }) => (
              <Toggle
                key={value}
                pressed={props.activeTab === value}
                size="sm"
                variant="default"
                className="h-7 min-w-max justify-start gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-muted-foreground/72 shadow-none before:hidden hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground data-pressed:bg-[var(--color-background-button-secondary)] data-pressed:text-foreground"
                onPressedChange={() => props.onTabChange(value)}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
        <div className="min-h-0 flex-1">
          {props.activeTab === "plan" ? (
            <WorkspacePlanPanel
              activePlan={props.activePlan}
              activeProposedPlan={props.activeProposedPlan}
              workLogEntries={props.workLogEntries}
              environmentId={props.environmentId}
              gitCwd={props.gitCwd}
              markdownCwd={props.markdownCwd}
              workspaceRoot={props.workspaceRoot}
              timestampFormat={props.timestampFormat}
            />
          ) : null}
          {props.activeTab === "explorer" ? (
            <WorkspaceExplorerPanel
              environmentId={props.environmentId}
              workspaceRoot={props.workspaceRoot}
              resolvedTheme={props.resolvedTheme}
              selectedPreviewPath={props.selectedPreviewPath}
              onSelectPreviewPath={props.onSelectPreviewPath}
            />
          ) : null}
          {props.activeTab === "preview" ? (
            <WorkspacePreviewPanel
              environmentId={props.environmentId}
              workspaceRoot={props.workspaceRoot}
              markdownCwd={props.markdownCwd}
              selectedPreviewPath={props.selectedPreviewPath}
              availableEditors={props.availableEditors}
              canOpenInEditor={props.canOpenInEditor}
            />
          ) : null}
          {props.activeTab === "git" ? (
            <WorkspaceGitPanel
              environmentId={props.environmentId}
              gitCwd={props.gitCwd}
              resolvedTheme={props.resolvedTheme}
              onSelectPreviewPath={props.onSelectPreviewPath}
            />
          ) : null}
          {props.activeTab === "browser" ? (
            <WorkspaceBrowserPanel
              environmentId={props.environmentId}
              threadId={props.activeThread.id}
            />
          ) : null}
          {props.activeTab === "graph" ? (
            <WorkspaceGraphPanel
              activeProjectName={props.activeProjectName}
              activeThread={props.activeThread}
              selectedPreviewPath={props.selectedPreviewPath}
              environmentId={props.environmentId}
              gitCwd={props.gitCwd}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
});

const WorkspacePlanPanel = memo(function WorkspacePlanPanel(props: {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  environmentId: EnvironmentId;
  gitCwd: string | null;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
}) {
  const gitStatus = useGitStatus({ environmentId: props.environmentId, cwd: props.gitCwd });
  const summaryModel = useMemo(
    () =>
      deriveActivitySummaryModel({
        activePlan: props.activePlan,
        activeProposedPlan: props.activeProposedPlan,
        workLogEntries: props.workLogEntries,
        gitStatus: gitStatus.data,
        gitStatusPending: gitStatus.isPending,
      }),
    [
      gitStatus.data,
      gitStatus.isPending,
      props.activePlan,
      props.activeProposedPlan,
      props.workLogEntries,
    ],
  );

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        <ActivitySummaryPanel model={summaryModel} />
        {props.activePlan?.explanation ? (
          <p className="mx-auto max-w-[340px] text-[13px] leading-relaxed text-muted-foreground/80">
            {props.activePlan.explanation}
          </p>
        ) : null}
        {props.activeProposedPlan?.planMarkdown ? (
          <div className="mx-auto max-w-[340px] rounded-lg border border-[color:var(--color-border-light,var(--border))] bg-background/50 p-3">
            <ChatMarkdown
              text={props.activeProposedPlan.planMarkdown}
              cwd={props.markdownCwd}
              isStreaming={false}
            />
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
});

const WorkspaceExplorerPanel = memo(function WorkspaceExplorerPanel(props: {
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
  selectedPreviewPath: string | null;
  onSelectPreviewPath: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const deferredQuery = useDeferredValue(query.trim());
  const rootQuery = useQuery(
    projectListTreeQueryOptions({
      environmentId: props.environmentId,
      cwd: props.workspaceRoot ?? null,
      enabled: deferredQuery.length === 0,
    }),
  );
  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: props.environmentId,
      cwd: props.workspaceRoot ?? null,
      query: deferredQuery,
      enabled: deferredQuery.length > 0,
      limit: 120,
    }),
  );
  const workspaceRoot = props.workspaceRoot;

  const toggleDirectory = useCallback((relativePath: string) => {
    setExpandedDirectories((current) => ({
      ...current,
      [relativePath]: !current[relativePath],
    }));
  }, []);

  if (!workspaceRoot) {
    return (
      <Empty className="min-h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderTreeIcon className="size-4.5" />
          </EmptyMedia>
          <EmptyTitle>No workspace</EmptyTitle>
          <EmptyDescription>
            Explorer becomes available once the active thread has a project or worktree path.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 p-3">
        <div className="mb-3 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <VscodeEntryIcon
              pathValue={workspaceRoot}
              kind="directory"
              theme={props.resolvedTheme}
              expanded
              root
              className="size-4"
            />
            <span className="truncate text-sm font-medium">{basenameOfPath(workspaceRoot)}</span>
            <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
              cwd
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
            {workspaceRoot}
          </p>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files and folders"
            className="pl-8"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {deferredQuery.length > 0 ? (
            searchQuery.error ? (
              <Empty className="min-h-80 py-8">
                <EmptyHeader>
                  <EmptyTitle>Search failed</EmptyTitle>
                  <EmptyDescription>
                    {searchQuery.error instanceof Error
                      ? searchQuery.error.message
                      : "Workspace search could not be loaded."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : searchQuery.data?.entries.length ? (
              searchQuery.data.entries.map((entry) => (
                <WorkspaceEntryButton
                  key={entry.path}
                  relativePath={entry.path}
                  kind={entry.kind}
                  theme={props.resolvedTheme}
                  depth={entry.path.split("/").length - 1}
                  selected={props.selectedPreviewPath === entry.path}
                  onClick={() => {
                    if (entry.kind === "directory") {
                      toggleDirectory(entry.path);
                      return;
                    }
                    props.onSelectPreviewPath(entry.path);
                  }}
                />
              ))
            ) : searchQuery.isPending ? (
              <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground/70">
                <LoaderIcon className="size-3.5 animate-spin" />
                Searching workspace…
              </div>
            ) : (
              <Empty className="min-h-80 py-8">
                <EmptyHeader>
                  <EmptyTitle>No matches</EmptyTitle>
                  <EmptyDescription>
                    Try a shorter filename fragment or clear the search to browse the tree.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : rootQuery.error ? (
            <Empty className="min-h-80 py-8">
              <EmptyHeader>
                <EmptyTitle>Tree failed to load</EmptyTitle>
                <EmptyDescription>
                  {rootQuery.error instanceof Error
                    ? rootQuery.error.message
                    : "Workspace tree could not be loaded."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : rootQuery.data?.entries.length ? (
            rootQuery.data.entries.map((entry) => (
              <WorkspaceTreeNode
                key={entry.path}
                environmentId={props.environmentId}
                workspaceRoot={workspaceRoot}
                entry={entry}
                depth={0}
                resolvedTheme={props.resolvedTheme}
                expandedDirectories={expandedDirectories}
                selectedPreviewPath={props.selectedPreviewPath}
                onToggleDirectory={toggleDirectory}
                onSelectPreviewPath={props.onSelectPreviewPath}
              />
            ))
          ) : rootQuery.isPending ? (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground/70">
              <LoaderIcon className="size-3.5 animate-spin" />
              Loading workspace tree…
            </div>
          ) : (
            <div className="px-2 py-3">
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2">
                <VscodeEntryIcon
                  pathValue={workspaceRoot}
                  kind="directory"
                  theme={props.resolvedTheme}
                  expanded
                  root
                />
                <span className="truncate font-mono text-[12px]">
                  {basenameOfPath(workspaceRoot)}
                </span>
              </div>
              <Empty className="min-h-64 py-8">
                <EmptyHeader>
                  <EmptyTitle>Directory is empty</EmptyTitle>
                  <EmptyDescription>
                    This `cwd` resolved correctly, but there are no readable files or folders at the
                    top level yet.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

const WorkspaceTreeNode = memo(function WorkspaceTreeNode(props: {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  entry: { path: string; kind: "file" | "directory" };
  depth: number;
  resolvedTheme: "light" | "dark";
  expandedDirectories: Record<string, boolean>;
  selectedPreviewPath: string | null;
  onToggleDirectory: (relativePath: string) => void;
  onSelectPreviewPath: (relativePath: string) => void;
}) {
  const isExpanded = props.expandedDirectories[props.entry.path] ?? false;
  const childrenQuery = useQuery(
    projectListTreeQueryOptions({
      environmentId: props.environmentId,
      cwd: props.workspaceRoot,
      relativePath: props.entry.kind === "directory" && isExpanded ? props.entry.path : null,
      enabled: props.entry.kind === "directory" && isExpanded,
    }),
  );

  return (
    <div>
      <WorkspaceEntryButton
        relativePath={props.entry.path}
        kind={props.entry.kind}
        theme={props.resolvedTheme}
        depth={props.depth}
        selected={props.selectedPreviewPath === props.entry.path}
        {...(props.entry.kind === "directory" ? { expanded: isExpanded } : {})}
        onClick={() => {
          if (props.entry.kind === "directory") {
            props.onToggleDirectory(props.entry.path);
            return;
          }
          props.onSelectPreviewPath(props.entry.path);
        }}
      />
      {props.entry.kind === "directory" && isExpanded ? (
        <div className="space-y-0.5">
          {childrenQuery.data?.entries.map((entry) => (
            <WorkspaceTreeNode
              key={entry.path}
              environmentId={props.environmentId}
              workspaceRoot={props.workspaceRoot}
              entry={entry}
              depth={props.depth + 1}
              resolvedTheme={props.resolvedTheme}
              expandedDirectories={props.expandedDirectories}
              selectedPreviewPath={props.selectedPreviewPath}
              onToggleDirectory={props.onToggleDirectory}
              onSelectPreviewPath={props.onSelectPreviewPath}
            />
          ))}
          {childrenQuery.isPending ? (
            <div
              className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground/70"
              style={{ paddingLeft: `${16 + (props.depth + 1) * 14}px` }}
            >
              <LoaderIcon className="size-3 animate-spin" />
              Loading…
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function WorkspaceEntryButton(props: {
  relativePath: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  depth: number;
  selected: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  const baseName = props.relativePath.split("/").at(-1) ?? props.relativePath;
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80",
        props.selected && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: `${8 + props.depth * 14}px` }}
      onClick={props.onClick}
    >
      {props.kind === "directory" ? (
        <>
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
              props.expanded && "rotate-90",
            )}
          />
          <VscodeEntryIcon
            pathValue={props.relativePath}
            kind="directory"
            theme={props.theme}
            {...(props.expanded !== undefined ? { expanded: props.expanded } : {})}
          />
        </>
      ) : (
        <>
          <span className="size-3.5 shrink-0" />
          <VscodeEntryIcon pathValue={props.relativePath} kind="file" theme={props.theme} />
        </>
      )}
      <span className="truncate font-mono text-[11px]">{baseName}</span>
    </button>
  );
}

const WorkspacePreviewPanel = memo(function WorkspacePreviewPanel(props: {
  environmentId: EnvironmentId;
  workspaceRoot: string | undefined;
  markdownCwd: string | undefined;
  selectedPreviewPath: string | null;
  availableEditors: ReadonlyArray<EditorId>;
  canOpenInEditor: boolean;
}) {
  const workspaceRoot = props.workspaceRoot;
  const selectedPreviewPath = props.selectedPreviewPath;
  const previewQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId: props.environmentId,
      cwd: workspaceRoot ?? null,
      relativePath: selectedPreviewPath,
      maxBytes: WORKSPACE_FILE_PREVIEW_MAX_BYTES,
      enabled: selectedPreviewPath !== null && workspaceRoot !== undefined,
    }),
  );

  const handleOpenInEditor = useCallback(async () => {
    if (!workspaceRoot || !selectedPreviewPath || !props.canOpenInEditor) {
      return;
    }
    const api = readLocalApi();
    if (!api || props.availableEditors.length === 0) {
      return;
    }
    await openInPreferredEditor(api, `${workspaceRoot}/${selectedPreviewPath}`);
  }, [props.availableEditors.length, props.canOpenInEditor, selectedPreviewPath, workspaceRoot]);

  if (!workspaceRoot) {
    return (
      <Empty className="min-h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2Icon className="size-4.5" />
          </EmptyMedia>
          <EmptyTitle>No workspace preview</EmptyTitle>
          <EmptyDescription>
            Select a file from Explorer or Git to preview it here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!selectedPreviewPath) {
    return (
      <Empty className="min-h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2Icon className="size-4.5" />
          </EmptyMedia>
          <EmptyTitle>Select a file</EmptyTitle>
          <EmptyDescription>
            Explorer and Git can open files directly into this preview pane.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selectedPreviewPath}</p>
          {previewQuery.data ? (
            <p className="truncate text-[11px] text-muted-foreground/65">
              {previewQuery.data.mimeType} · {formatBytes(previewQuery.data.sizeBytes)}
              {previewQuery.data.truncated ? " · truncated" : ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void previewQuery.refetch()}
            disabled={previewQuery.isFetching}
          >
            <RefreshCwIcon className={cn("size-3.5", previewQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void handleOpenInEditor()}
            disabled={!props.canOpenInEditor}
          >
            <ExternalLinkIcon className="size-3.5" />
            Open
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {previewQuery.isPending ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground/70">
            <LoaderIcon className="size-3.5 animate-spin" />
            Loading preview…
          </div>
        ) : previewQuery.error ? (
          <Empty className="min-h-80 py-8">
            <EmptyHeader>
              <EmptyTitle>Preview failed</EmptyTitle>
              <EmptyDescription>
                {previewQuery.error instanceof Error
                  ? previewQuery.error.message
                  : "The file could not be read."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : previewQuery.data ? (
          <WorkspacePreviewBody data={previewQuery.data} markdownCwd={props.markdownCwd} />
        ) : null}
      </ScrollArea>
    </div>
  );
});

function WorkspacePreviewBody(props: {
  data: ProjectReadFileResult;
  markdownCwd: string | undefined;
}) {
  const previewData = props.data;
  if (previewData.kind === "text") {
    if (isMarkdownPreview(previewData.relativePath, previewData.mimeType)) {
      return (
        <div className="p-3">
          <ChatMarkdown
            text={previewData.contents ?? ""}
            cwd={props.markdownCwd}
            isStreaming={false}
          />
        </div>
      );
    }

    return (
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-foreground/90">
        {previewData.contents}
      </pre>
    );
  }

  if (previewData.kind === "binary" && previewData.bytesBase64) {
    const source = `data:${previewData.mimeType};base64,${previewData.bytesBase64}`;
    if (!isRenderableBinaryPreview(previewData)) {
      return null;
    }
    if (previewData.mimeType.startsWith("image/")) {
      return (
        <div className="p-3">
          <img
            src={source}
            alt={previewData.relativePath}
            className="max-h-[70vh] w-full rounded-lg border border-border/60 object-contain bg-background"
          />
        </div>
      );
    }
    if (previewData.mimeType === "application/pdf") {
      return (
        <iframe
          src={source}
          title={previewData.relativePath}
          className="h-[80vh] w-full"
          sandbox="allow-downloads"
        />
      );
    }
    if (previewData.mimeType.startsWith("audio/")) {
      return (
        <div className="p-4">
          <audio src={source} controls className="w-full" />
        </div>
      );
    }
    if (previewData.mimeType.startsWith("video/")) {
      return (
        <div className="p-3">
          <video src={source} controls className="w-full rounded-lg border border-border/60" />
        </div>
      );
    }
  }

  return (
    <Empty className="min-h-80 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {previewData.mimeType.startsWith("image/") ? (
            <ImageIcon className="size-4.5" />
          ) : previewData.mimeType.startsWith("audio/") ? (
            <AudioLinesIcon className="size-4.5" />
          ) : (
            <FileIcon className="size-4.5" />
          )}
        </EmptyMedia>
        <EmptyTitle>Binary preview unavailable</EmptyTitle>
        <EmptyDescription>
          {previewData.truncated
            ? "This file is too large to preview inline."
            : `Inline preview is not supported for ${previewData.mimeType}.`}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const WorkspaceGitPanel = memo(function WorkspaceGitPanel(props: {
  environmentId: EnvironmentId;
  gitCwd: string | null;
  resolvedTheme: "light" | "dark";
  onSelectPreviewPath: (relativePath: string) => void;
}) {
  const gitStatus = useGitStatus({ environmentId: props.environmentId, cwd: props.gitCwd });
  const branchesQuery = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      environmentId: props.environmentId,
      cwd: props.gitCwd,
      query: "",
      enabled: props.gitCwd !== null,
    }),
  );
  const branches = useMemo(
    () => branchesQuery.data?.pages.flatMap((page) => page.branches).slice(0, 16) ?? [],
    [branchesQuery.data?.pages],
  );

  if (!props.gitCwd) {
    return (
      <Empty className="min-h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitBranchIcon className="size-4.5" />
          </EmptyMedia>
          <EmptyTitle>No Git context</EmptyTitle>
          <EmptyDescription>
            Git details are available once the active project resolves to a repository root.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        {gitStatus.data ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <WorkspaceMetaCard label="Branch" value={gitStatus.data.branch ?? "Detached"} />
              <WorkspaceMetaCard
                label="Remote"
                value={gitStatus.data.hasUpstream ? "Tracking" : "No upstream"}
              />
              <WorkspaceMetaCard label="Ahead" value={String(gitStatus.data.aheadCount)} />
              <WorkspaceMetaCard label="Behind" value={String(gitStatus.data.behindCount)} />
            </div>
            {gitStatus.data.pr ? (
              <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{gitStatus.data.pr.title}</p>
                    <p className="text-[11px] text-muted-foreground/65">
                      PR #{gitStatus.data.pr.number} · {gitStatus.data.pr.state}
                    </p>
                  </div>
                  <Badge variant="outline">{gitStatus.data.pr.baseBranch}</Badge>
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border border-border/60 bg-background/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Changed files</p>
                <Badge variant="outline">{gitStatus.data.workingTree.files.length}</Badge>
              </div>
              {gitStatus.data.workingTree.files.length > 0 ? (
                <ChangedFilesTree
                  turnId={WORKSPACE_GIT_TREE_TURN_ID}
                  files={gitStatus.data.workingTree.files as unknown as TurnDiffFileChange[]}
                  allDirectoriesExpanded={false}
                  resolvedTheme={props.resolvedTheme}
                  onOpenTurnDiff={(_turnId, filePath) => {
                    if (filePath) {
                      props.onSelectPreviewPath(filePath);
                    }
                  }}
                />
              ) : (
                <p className="text-[12px] text-muted-foreground/70">Working tree is clean.</p>
              )}
            </div>
          </>
        ) : gitStatus.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
            <LoaderIcon className="size-3.5 animate-spin" />
            Loading git status…
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">Git status is unavailable.</p>
        )}

        <div className="rounded-lg border border-border/60 bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Branches</p>
            {branchesQuery.isFetching ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
          </div>
          <div className="space-y-1">
            {branches.map((branch) => (
              <div
                key={`${branch.remoteName ?? "local"}:${branch.name}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]"
              >
                <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
                {branch.current ? <Badge variant="outline">current</Badge> : null}
                {branch.isRemote ? <Badge variant="outline">remote</Badge> : null}
              </div>
            ))}
            {branches.length === 0 && !branchesQuery.isPending ? (
              <p className="text-[12px] text-muted-foreground/70">No branches returned.</p>
            ) : null}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
});

function WorkspaceMetaCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/55">{props.label}</p>
      <p className="mt-1 truncate font-mono text-[12px] text-foreground/90">{props.value}</p>
    </div>
  );
}

const WorkspaceBrowserPanel = memo(function WorkspaceBrowserPanel({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: Thread["id"];
}) {
  const storageKey = workspaceBrowserUrlStorageKey(environmentId);
  const storedBrowserUrl = getLocalStorageItem(storageKey, Schema.String);
  const initialStoredUrl = storedBrowserUrl ?? WORKSPACE_BROWSER_EMPTY_URL;
  const [inputValue, setInputValue] = useState(initialStoredUrl);
  const [history, setHistory] = useState<string[]>([initialStoredUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [frameKey, setFrameKey] = useState(0);
  const [desktopBrowserState, setDesktopBrowserState] = useState<ThreadBrowserState | null>(null);
  const desktopBrowserBoundsRef = useRef<HTMLDivElement | null>(null);
  const currentUrl = history[historyIndex] ?? initialStoredUrl;
  const desktopBrowser = typeof window === "undefined" ? undefined : window.desktopBridge?.browser;
  const activeDesktopTab: BrowserTabState | null =
    desktopBrowserState?.tabs.find((tab) => tab.id === desktopBrowserState.activeTabId) ??
    desktopBrowserState?.tabs[0] ??
    null;

  const navigateTo = useCallback(
    (rawUrl: string) => {
      const normalizedUrl = normalizeBrowserUrl(rawUrl);
      setInputValue(normalizedUrl);
      setHistory((current) => {
        const nextHistory = [...current.slice(0, historyIndex + 1), normalizedUrl];
        setHistoryIndex(nextHistory.length - 1);
        return nextHistory;
      });
      setLocalStorageItem(storageKey, normalizedUrl, Schema.String);
    },
    [historyIndex, storageKey],
  );

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      navigateTo(inputValue);
    },
    [inputValue, navigateTo],
  );

  useEffect(() => {
    if (!desktopBrowser) {
      setInputValue(currentUrl);
      return;
    }
    setInputValue(activeDesktopTab?.url ?? initialStoredUrl);
  }, [activeDesktopTab?.url, currentUrl, desktopBrowser, initialStoredUrl]);

  useEffect(() => {
    if (!desktopBrowser) {
      return;
    }
    let disposed = false;
    const unsubscribe = desktopBrowser.onState((state) => {
      if (state.threadId === threadId) {
        setDesktopBrowserState(state);
      }
    });
    if (storedBrowserUrl) {
      void desktopBrowser
        .open({ threadId, initialUrl: initialStoredUrl })
        .then((state) => {
          if (!disposed) {
            setDesktopBrowserState(state);
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setDesktopBrowserState({
              threadId,
              open: false,
              activeTabId: null,
              tabs: [],
              lastError: error instanceof Error ? error.message : "Desktop browser failed to open.",
            });
          }
        });
    } else {
      void desktopBrowser
        .getState({ threadId })
        .then((state) => {
          if (!disposed) {
            setDesktopBrowserState(state);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      unsubscribe();
      void desktopBrowser.hide({ threadId }).catch(() => undefined);
    };
  }, [desktopBrowser, initialStoredUrl, storedBrowserUrl, threadId]);

  useEffect(() => {
    if (!desktopBrowser) {
      return;
    }
    const element = desktopBrowserBoundsRef.current;
    if (!element) {
      return;
    }

    const syncBounds = () => {
      const rect = element.getBoundingClientRect();
      void desktopBrowser
        .setPanelBounds({
          threadId,
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        })
        .catch(() => undefined);
    };
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(element);
    window.addEventListener("scroll", syncBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", syncBounds, true);
      void desktopBrowser.setPanelBounds({ threadId, bounds: null }).catch(() => undefined);
    };
  }, [desktopBrowser, threadId]);

  if (desktopBrowser) {
    const navigateDesktopBrowser = (rawUrl: string) => {
      const normalizedUrl = normalizeBrowserUrl(rawUrl);
      setInputValue(normalizedUrl);
      setLocalStorageItem(storageKey, normalizedUrl, Schema.String);
      if (activeDesktopTab) {
        void desktopBrowser
          .navigate({ threadId, tabId: activeDesktopTab.id, url: normalizedUrl })
          .then(setDesktopBrowserState)
          .catch(() => undefined);
        return;
      }
      void desktopBrowser
        .open({ threadId, initialUrl: normalizedUrl })
        .then(setDesktopBrowserState)
        .catch(() => undefined);
    };

    return (
      <div className="flex h-full min-h-0 flex-col">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigateDesktopBrowser(inputValue);
          }}
          className="flex items-center gap-2 border-b border-border/60 p-3"
        >
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            disabled={!activeDesktopTab?.canGoBack}
            onClick={() => {
              if (!activeDesktopTab) return;
              void desktopBrowser
                .goBack({ threadId, tabId: activeDesktopTab.id })
                .then(setDesktopBrowserState)
                .catch(() => undefined);
            }}
            aria-label="Go back"
          >
            <ChevronRightIcon className="size-3.5 rotate-180" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            disabled={!activeDesktopTab?.canGoForward}
            onClick={() => {
              if (!activeDesktopTab) return;
              void desktopBrowser
                .goForward({ threadId, tabId: activeDesktopTab.id })
                .then(setDesktopBrowserState)
                .catch(() => undefined);
            }}
            aria-label="Go forward"
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            disabled={!activeDesktopTab}
            onClick={() => {
              if (!activeDesktopTab) return;
              void desktopBrowser
                .reload({ threadId, tabId: activeDesktopTab.id })
                .then(setDesktopBrowserState)
                .catch(() => undefined);
            }}
            aria-label="Reload page"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
          <Input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Enter a dev URL"
          />
          <Button type="submit" size="xs" variant="outline">
            <Link2Icon className="size-3.5" />
            Open
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            onClick={() => {
              void desktopBrowser
                .newTab({ threadId, url: WORKSPACE_BROWSER_EMPTY_URL, activate: true })
                .then(setDesktopBrowserState)
                .catch(() => undefined);
            }}
            aria-label="New tab"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </form>
        {desktopBrowserState?.tabs.length ? (
          <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5">
            {desktopBrowserState.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "min-w-0 rounded-md border px-2 py-1 text-left text-[11px]",
                  tab.id === desktopBrowserState.activeTabId
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/60 bg-background/50 text-muted-foreground",
                )}
                onClick={() => {
                  void desktopBrowser
                    .selectTab({ threadId, tabId: tab.id })
                    .then(setDesktopBrowserState)
                    .catch(() => undefined);
                }}
              >
                <span className="block max-w-36 truncate">{tab.title || tab.url}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div ref={desktopBrowserBoundsRef} className="min-h-0 flex-1 bg-background">
          <Empty className="min-h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon className="size-4.5" />
              </EmptyMedia>
              <EmptyTitle>Desktop browser panel</EmptyTitle>
              <EmptyDescription>
                The native browser surface is controlled by the desktop bridge. In browser-only mode
                this tab falls back to the iframe preview.
              </EmptyDescription>
              {desktopBrowserState?.lastError ? (
                <p className="mt-2 max-w-sm text-xs text-destructive">
                  {desktopBrowserState.lastError}
                </p>
              ) : activeDesktopTab ? (
                <p className="mt-2 max-w-sm truncate font-mono text-xs text-muted-foreground">
                  {activeDesktopTab.url}
                </p>
              ) : null}
              {activeDesktopTab ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void desktopBrowser
                      .openDevTools({ threadId, tabId: activeDesktopTab.id })
                      .catch(() => undefined);
                  }}
                >
                  Open DevTools
                </Button>
              ) : null}
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-b border-border/60 p-3">
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          disabled={historyIndex <= 0}
          onClick={() => setHistoryIndex((current) => Math.max(0, current - 1))}
          aria-label="Go back"
        >
          <ChevronRightIcon className="size-3.5 rotate-180" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          disabled={historyIndex >= history.length - 1}
          onClick={() => setHistoryIndex((current) => Math.min(history.length - 1, current + 1))}
          aria-label="Go forward"
        >
          <ChevronRightIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          onClick={() => setFrameKey((current) => current + 1)}
          aria-label="Reload preview"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
        <Input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Enter a dev URL"
        />
        <Button type="submit" size="xs" variant="outline">
          <Link2Icon className="size-3.5" />
          Open
        </Button>
      </form>
      <iframe
        key={`${currentUrl}:${frameKey}`}
        src={currentUrl}
        title="Integrated browser"
        className="min-h-0 flex-1 bg-white"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
      />
    </div>
  );
});

const WorkspaceGraphPanel = memo(function WorkspaceGraphPanel(props: {
  environmentId: EnvironmentId;
  gitCwd: string | null;
  activeProjectName: string | undefined;
  activeThread: Thread;
  selectedPreviewPath: string | null;
}) {
  const gitStatus = useGitStatus({ environmentId: props.environmentId, cwd: props.gitCwd }).data;
  const nodes = [
    { id: "project", label: props.activeProjectName ?? "Project" },
    { id: "thread", label: props.activeThread.title },
    { id: "branch", label: props.activeThread.branch ?? gitStatus?.branch ?? "No branch" },
    { id: "file", label: props.selectedPreviewPath ?? "No file selected" },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        <p className="text-sm text-muted-foreground/75">
          v1 graph is intentionally small and read-only: project, thread, branch, selected file and
          current changed-file count.
        </p>
        <div className="space-y-3">
          {nodes.map((node, index) => (
            <div key={node.id} className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-full border border-border/60 bg-background/60">
                <WaypointsIcon className="size-3.5 text-muted-foreground/70" />
              </div>
              <div className="min-w-0 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/55">
                  {node.id}
                </p>
                <p className="truncate font-mono text-[12px]">{node.label}</p>
              </div>
              {index < nodes.length - 1 ? <div className="h-px flex-1 bg-border/60" /> : null}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <WorkspaceMetaCard
            label="Changed files"
            value={String(gitStatus?.workingTree.files.length ?? 0)}
          />
          <WorkspaceMetaCard
            label="PR"
            value={gitStatus?.pr ? `#${gitStatus.pr.number}` : "None"}
          />
        </div>
      </div>
    </ScrollArea>
  );
});

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
