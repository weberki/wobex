import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
} from "@wobex/contracts";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { ProviderUsagePanel } from "./ProviderUsagePanel";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { type RateLimitSnapshot } from "~/lib/rateLimits";

function formatRuntimeModeLabel(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "approval-required":
      return "Approval required";
    case "auto-accept-edits":
      return "Auto accept edits";
    case "full-access":
      return "Full access";
    default:
      return runtimeMode;
  }
}

function formatInteractionModeLabel(interactionMode: ProviderInteractionMode): string {
  return interactionMode === "plan" ? "Plan" : "Default";
}

export function SessionStatusDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderKind | null;
  selectedModel: string | null;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  contextWindow: ContextWindowSnapshot | null;
  rateLimitSnapshot: RateLimitSnapshot | null;
  usageRefreshing?: boolean;
  usageRefreshError?: string | null;
  onRefreshUsage?: () => void | Promise<void>;
}) {
  const {
    open,
    onOpenChange,
    provider,
    selectedModel,
    runtimeMode,
    interactionMode,
    branch,
    worktreePath,
    contextWindow,
    rateLimitSnapshot,
    usageRefreshing = false,
    usageRefreshError = null,
    onRefreshUsage,
  } = props;

  const providerLabel = provider ? PROVIDER_DISPLAY_NAMES[provider] : "Unknown";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Session Status</DialogTitle>
          <DialogDescription>
            Live thread state from the current session, model selection, and provider activity.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Provider</p>
              <p className="font-medium text-foreground">{providerLabel}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Model</p>
              <p className="font-medium text-foreground">{selectedModel ?? "Unknown"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Runtime</p>
              <p className="font-medium text-foreground">{formatRuntimeModeLabel(runtimeMode)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Mode</p>
              <p className="font-medium text-foreground">
                {formatInteractionModeLabel(interactionMode)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Branch</p>
              <p className="font-medium text-foreground">{branch ?? "Not attached"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Workspace</p>
              <p className="font-medium text-foreground">{worktreePath ?? "Project root"}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  Context Window
                </p>
                <p className="text-sm text-muted-foreground">
                  Latest token usage reported by the active thread.
                </p>
              </div>
              {contextWindow ? <ContextWindowMeter usage={contextWindow} /> : null}
            </div>
            {contextWindow ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Used</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.usedTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Remaining</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.remainingTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Window</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.maxTokens ?? null)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cost</p>
                  <p className="font-medium text-foreground">Not available</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Context usage has not been reported yet for this thread.
              </p>
            )}
          </div>

          <ProviderUsagePanel
            provider={provider}
            snapshot={rateLimitSnapshot}
            refreshing={usageRefreshing}
            refreshError={usageRefreshError}
            {...(onRefreshUsage ? { onRefresh: onRefreshUsage } : {})}
          />
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
