import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type EditorId,
  type ProviderKind,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@wobex/contracts";
import { scopeThreadRef } from "@wobex/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import {
  BlocksIcon,
  BotIcon,
  Code2Icon,
  DiffIcon,
  PanelRightIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarHeaderTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { ProviderUsageHeaderMeter } from "./ProviderUsagePanel";
import type { RateLimitSnapshot } from "~/lib/rateLimits";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  workspaceWindowOpen: boolean;
  provider: ProviderKind | null;
  rateLimitSnapshot: RateLimitSnapshot | null;
  usageRefreshing: boolean;
  onOpenSessionStatus: () => void;
  onOpenWorkspacePage: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onToggleWorkspaceWindow: () => void;
}

function ProviderGlyph(props: { provider: ProviderKind | null }) {
  const iconClassName = "size-3.5";
  const Icon =
    props.provider === "claudeAgent"
      ? SparklesIcon
      : props.provider === "opencode"
        ? Code2Icon
        : props.provider === "droid"
          ? BotIcon
          : BotIcon;

  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/75"
      aria-hidden="true"
    >
      <Icon className={iconClassName} />
    </span>
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  workspaceWindowOpen,
  provider,
  rateLimitSnapshot,
  usageRefreshing,
  onOpenSessionStatus,
  onOpenWorkspacePage,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onToggleWorkspaceWindow,
}: ChatHeaderProps) {
  const providerLabel = provider ? (PROVIDER_DISPLAY_NAMES[provider] ?? provider) : "Provider";
  const headerActionClassName =
    "sidebar-icon-button size-6 min-w-6 rounded-md border-0 bg-transparent p-0 shadow-none before:hidden data-pressed:bg-[var(--color-background-button-secondary-hover)]";
  const headerStatusActionClassName =
    "sidebar-icon-button h-6 min-w-6 rounded-md border-0 bg-transparent px-1.5 shadow-none before:hidden data-pressed:bg-[var(--color-background-button-secondary-hover)]";

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 font-system-ui">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarHeaderTrigger className="shrink-0 md:hidden" />
        <ProviderGlyph provider={provider} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              className="max-w-[clamp(12rem,42vw,36rem)] min-w-0 truncate text-sm font-medium text-foreground"
              title={activeThreadTitle}
            >
              {activeThreadTitle}
            </h2>
            {activeProjectName && !isGitRepo && (
              <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
                No Git
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <span className="shrink-0">{providerLabel}</span>
            {activeProjectName ? (
              <>
                <span className="text-muted-foreground/35">/</span>
                <span className="min-w-0 truncate">{activeProjectName}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 rounded-lg border border-[color:var(--color-border-light,var(--border))] bg-[var(--composer-surface,var(--background))] px-1 py-1 shadow-sm @3xl/header-actions:gap-1.5">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className={headerStatusActionClassName}
                pressed={false}
                onPressedChange={onOpenSessionStatus}
                aria-label="Open session status"
                variant="default"
                size="xs"
              >
                <SlidersHorizontalIcon className="size-3" />
                <ProviderUsageHeaderMeter
                  provider={provider}
                  snapshot={rateLimitSnapshot}
                  refreshing={usageRefreshing}
                />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">Open session status</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className={headerActionClassName}
                pressed={false}
                onPressedChange={onOpenWorkspacePage}
                aria-label="Open workspace page"
                variant="default"
                size="xs"
              >
                <BlocksIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">Open terminal workspace</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className={headerActionClassName}
                pressed={workspaceWindowOpen}
                onPressedChange={onToggleWorkspaceWindow}
                aria-label="Toggle workspace window"
                variant="default"
                size="xs"
              >
                <PanelRightIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {workspaceWindowOpen ? "Hide workspace window" : "Show workspace window"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className={headerActionClassName}
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="default"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className={headerActionClassName}
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="default"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
