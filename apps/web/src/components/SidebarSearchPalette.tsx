import { BlocksIcon, SearchIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { FolderIcon } from "lucide-react";
import { PROVIDER_DISPLAY_NAMES, type ProviderKind, type ScopedThreadRef } from "@wobex/contracts";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "./ui/command";
import {
  type SidebarSearchAction,
  type SidebarSearchProject,
  type SidebarSearchThread,
  hasSidebarSearchResults,
  matchSidebarSearchActions,
  matchSidebarSearchProjects,
  matchSidebarSearchThreads,
} from "./SidebarSearchPalette.logic";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { cn } from "~/lib/utils";

interface SidebarSearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly SidebarSearchAction[];
  projects: readonly SidebarSearchProject[];
  threads: readonly SidebarSearchThread[];
  onSelectAction: (actionId: string) => void;
  onOpenProject: (project: SidebarSearchProject) => void;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
}

type IconComponent = ComponentType<{ className?: string }>;

const ACTION_ICONS: Record<string, IconComponent> = {
  "new-thread": SquarePenIcon,
  "add-project": FolderIcon,
  plugins: BlocksIcon,
  settings: SettingsIcon,
};

function tokenizeHighlightQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token, index, allTokens) => allTokens.indexOf(token) === index)
    .toSorted((left, right) => right.length - left.length);
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText(props: { text: string; query: string; className?: string }) {
  const segments = useMemo(() => {
    const tokens = tokenizeHighlightQuery(props.query);
    if (tokens.length === 0) {
      return [{ key: `0:${props.text}`, text: props.text, highlighted: false }];
    }

    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
    const parts = props.text.split(pattern).filter((part) => part.length > 0);
    let cursor = 0;
    return parts.map((part) => {
      const startIndex = props.text.indexOf(part, cursor);
      const stableStartIndex = startIndex >= 0 ? startIndex : cursor;
      cursor = stableStartIndex + part.length;
      return {
        key: `${stableStartIndex}:${part}`,
        text: part,
        highlighted: tokens.some((token) => token === part.toLowerCase()),
      };
    });
  }, [props.query, props.text]);

  return (
    <span className={props.className}>
      {segments.map((segment) =>
        segment.highlighted ? (
          <mark
            key={segment.key}
            className="rounded-[3px] bg-amber-200/80 px-[1px] text-current dark:bg-amber-300/25"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={segment.key}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

function ProviderPill(props: { provider: ProviderKind }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {PROVIDER_DISPLAY_NAMES[props.provider] ?? props.provider}
    </span>
  );
}

function threadMatchLabel(input: {
  matchKind: "message" | "project" | "title";
  messageMatchCount: number;
}): string | null {
  if (input.matchKind === "message") {
    return input.messageMatchCount > 1 ? `${input.messageMatchCount} message hits` : "Message hit";
  }
  if (input.matchKind === "project") {
    return "Project match";
  }
  return null;
}

export function SidebarSearchPalette(props: SidebarSearchPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!props.open) {
      setQuery("");
    }
  }, [props.open]);

  const matchedActions = useMemo(
    () => matchSidebarSearchActions(props.actions, query),
    [props.actions, query],
  );
  const matchedProjects = useMemo(
    () => matchSidebarSearchProjects(props.projects, query),
    [props.projects, query],
  );
  const matchedThreads = useMemo(
    () => matchSidebarSearchThreads(props.threads, query),
    [props.threads, query],
  );
  const hasResults = hasSidebarSearchResults({
    actions: matchedActions,
    projects: matchedProjects,
    threads: matchedThreads,
  });

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup className="max-w-2xl">
        <Command autoHighlight={false}>
          <CommandPanel className="overflow-hidden">
            <CommandInput
              placeholder="Search threads, projects, and actions"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              startAddon={<SearchIcon className="text-muted-foreground" />}
            />
            <CommandList className="max-h-[min(26rem,60vh)] not-empty:px-1.5 not-empty:pt-0 not-empty:pb-1.5">
              {matchedActions.length > 0 ? (
                <CommandGroup>
                  <CommandGroupLabel className="pt-0 pb-1.5 pl-3">Actions</CommandGroupLabel>
                  {matchedActions.map((action) => {
                    const Icon = ACTION_ICONS[action.id];
                    return (
                      <CommandItem
                        key={action.id}
                        value={`action:${action.id}`}
                        className="cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          props.onOpenChange(false);
                          props.onSelectAction(action.id);
                        }}
                      >
                        {Icon ? (
                          <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                            <Icon className="size-4" />
                          </div>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {action.label}
                        </span>
                        {action.shortcutLabel ? (
                          <CommandShortcut>{action.shortcutLabel}</CommandShortcut>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}

              {matchedActions.length > 0 &&
              (matchedThreads.length > 0 || matchedProjects.length > 0) ? (
                <CommandSeparator />
              ) : null}

              {matchedThreads.length > 0 ? (
                <CommandGroup>
                  <CommandGroupLabel className="py-1.5 pl-3">
                    {query ? "Threads" : "Recent threads"}
                  </CommandGroupLabel>
                  {matchedThreads.map(({ id, matchKind, messageMatchCount, snippet, thread }) => (
                    <CommandItem
                      key={id}
                      value={id}
                      className="cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        props.onOpenChange(false);
                        props.onOpenThread(thread.ref);
                      }}
                    >
                      <div className="pt-0.5">
                        <ProviderPill provider={thread.provider} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1 truncate text-sm text-foreground">
                            <HighlightedText
                              text={thread.title || "Untitled thread"}
                              query={query}
                            />
                          </div>
                          <span className="max-w-40 truncate text-xs text-muted-foreground/75">
                            {thread.projectName}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground/65">
                            {formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt)}
                          </span>
                        </div>
                        {snippet ? (
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1 line-clamp-1 text-xs leading-5 text-muted-foreground/80">
                              <HighlightedText text={snippet} query={query} />
                            </div>
                            <div className="w-28 shrink-0 text-right text-[11px] text-muted-foreground/60">
                              {threadMatchLabel({ matchKind, messageMatchCount })}
                            </div>
                          </div>
                        ) : threadMatchLabel({ matchKind, messageMatchCount }) ? (
                          <div className="text-[11px] text-muted-foreground/60">
                            {threadMatchLabel({ matchKind, messageMatchCount })}
                          </div>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {matchedThreads.length > 0 && matchedProjects.length > 0 ? (
                <CommandSeparator />
              ) : null}

              {matchedProjects.length > 0 ? (
                <CommandGroup>
                  <CommandGroupLabel className="py-1.5 pl-3">Projects</CommandGroupLabel>
                  {matchedProjects.map(({ id, project }) => (
                    <CommandItem
                      key={id}
                      value={id}
                      className="cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        props.onOpenChange(false);
                        props.onOpenProject(project);
                      }}
                    >
                      <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                        <FolderIcon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">
                          <HighlightedText text={project.name} query={query} />
                        </div>
                        <div className="truncate text-xs text-muted-foreground/75">
                          <HighlightedText text={project.cwd} query={query} />
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {!hasResults ? (
                <CommandEmpty className="px-5 py-8 text-left">
                  <div className="space-y-1">
                    <p className="text-sm text-foreground">
                      No matching threads, projects, or actions.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Try a thread title, project path, or an action like “settings”.
                    </p>
                  </div>
                </CommandEmpty>
              ) : null}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>Search stays local to your current sidebar state.</span>
            <span className={cn("font-medium text-foreground/80")}>Enter to open</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
