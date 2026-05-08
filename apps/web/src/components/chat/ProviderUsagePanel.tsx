import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@wobex/contracts";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";
import type { RateLimitSnapshot, RateLimitWindow } from "~/lib/rateLimits";
import {
  formatUsagePaceDisplay,
  formatUsagePercent,
  formatUsageReset,
  formatUsageSource,
  formatUsageUpdatedAt,
  getUsageRemainingPercent,
  getUsageUsedPercent,
  selectPrimaryUsageWindow,
} from "~/lib/providerUsageDisplay";

function providerLabel(provider: ProviderKind | null): string {
  return provider ? (PROVIDER_DISPLAY_NAMES[provider] ?? provider) : "Provider";
}

function usageToneClasses(provider: ProviderKind | null, remainingPercent: number | null) {
  if (remainingPercent !== null && remainingPercent <= 10) {
    return {
      fill: "bg-red-500",
      text: "text-red-700 dark:text-red-400",
      badge: "border-red-500/20 bg-red-500/8 text-red-700 dark:text-red-400",
    };
  }
  if (remainingPercent !== null && remainingPercent <= 25) {
    return {
      fill: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      badge: "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-400",
    };
  }
  if (provider === "claudeAgent") {
    return {
      fill: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
      badge: "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400",
    };
  }
  if (provider === "codex") {
    return {
      fill: "bg-blue-500",
      text: "text-blue-700 dark:text-blue-400",
      badge: "border-blue-500/20 bg-blue-500/8 text-blue-700 dark:text-blue-400",
    };
  }
  return {
    fill: "bg-primary",
    text: "text-foreground",
    badge: "border-border bg-muted/40 text-foreground",
  };
}

function UsageLoadingState() {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-border/70 bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Spinner className="size-4" />
        <span>Loading Usage</span>
      </div>
      <div className="space-y-2">
        <div className="h-2 rounded-sm bg-muted" />
        <div className="h-2 w-3/4 rounded-sm bg-muted" />
      </div>
    </div>
  );
}

function UsageWindowRow({
  provider,
  window,
}: {
  provider: ProviderKind | null;
  window: RateLimitWindow;
}) {
  const remainingPercent = getUsageRemainingPercent(window);
  const usedPercent = getUsageUsedPercent(window);
  const tone = usageToneClasses(provider, remainingPercent);
  const pace = formatUsagePaceDisplay(window);
  const barWidth = remainingPercent ?? 0;
  const sourceSuffix = window.source ? ` · ${window.source}` : "";

  return (
    <div className="space-y-2 border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium text-foreground">{window.label}</p>
          <p className="text-xs text-muted-foreground">
            {formatUsageReset(window)}
            {sourceSuffix}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("text-sm font-semibold tabular-nums", tone.text)}>
            {remainingPercent !== null
              ? `${formatUsagePercent(remainingPercent)} remaining`
              : "Remaining unknown"}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {usedPercent !== null ? `${formatUsagePercent(usedPercent)} used` : "Used unknown"}
          </p>
        </div>
      </div>
      <div
        className="h-2 overflow-hidden rounded-sm bg-muted"
        role="meter"
        aria-label={`${window.label} remaining usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(remainingPercent !== null ? { "aria-valuenow": Math.round(remainingPercent) } : {})}
      >
        <div
          className={cn("h-full rounded-sm transition-[width] duration-500 ease-out", tone.fill)}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {pace ? (
        <p
          className={cn(
            "text-xs leading-relaxed",
            pace.status === "ahead"
              ? "text-amber-700 dark:text-amber-400"
              : pace.status === "reserve"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground",
          )}
        >
          <span className="font-medium">Pace</span> {pace.text}
        </p>
      ) : null}
    </div>
  );
}

export function ProviderUsagePanel(props: {
  provider: ProviderKind | null;
  snapshot: RateLimitSnapshot | null;
  refreshing?: boolean;
  refreshError?: string | null;
  onRefresh?: () => void | Promise<void>;
}) {
  const { provider, snapshot, refreshing = false, refreshError = null, onRefresh } = props;
  const hasWindows = Boolean(snapshot && snapshot.windows.length > 0);
  const source = formatUsageSource(snapshot);
  const updatedAt = snapshot ? formatUsageUpdatedAt(snapshot.updatedAt) : null;
  const firstWindow = snapshot?.windows[0] ?? null;
  const primaryRemaining = firstWindow ? getUsageRemainingPercent(firstWindow) : null;
  const tone = usageToneClasses(provider, primaryRemaining);

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Usage</p>
            <Badge variant="outline" className={cn("rounded-sm", tone.badge)}>
              {providerLabel(provider)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {source && updatedAt ? `${source} · refreshed ${updatedAt}` : "Account limits."}
          </p>
        </div>
        {onRefresh ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? (
              <>
                <Spinner className="size-3" />
                Loading Usage
              </>
            ) : (
              "Refresh"
            )}
          </Button>
        ) : null}
      </div>

      {refreshError ? <p className="text-sm text-destructive">{refreshError}</p> : null}

      {refreshing && !hasWindows ? <UsageLoadingState /> : null}

      {hasWindows ? (
        <div className="space-y-3">
          {snapshot?.windows.map((window) => (
            <UsageWindowRow
              key={`${window.label}:${window.resetsAt ?? "none"}:${window.usedPercent ?? "na"}:${window.source ?? "source"}`}
              provider={provider}
              window={window}
            />
          ))}
        </div>
      ) : refreshing ? null : (
        <p className="text-sm text-muted-foreground">
          Account usage has not been reported yet. Refresh uses the local provider probe.
        </p>
      )}
    </div>
  );
}

export function ProviderUsageHeaderMeter(props: {
  provider: ProviderKind | null;
  snapshot: RateLimitSnapshot | null;
  refreshing?: boolean;
}) {
  const { provider, snapshot, refreshing = false } = props;
  const window = selectPrimaryUsageWindow(snapshot);
  if (!window) {
    return refreshing ? <Spinner className="size-3" /> : null;
  }

  const remainingPercent = getUsageRemainingPercent(window);
  const tone = usageToneClasses(provider, remainingPercent);
  const barWidth = remainingPercent ?? 0;

  return (
    <span className="hidden min-w-16 items-center gap-1.5 @4xl/header-actions:inline-flex">
      {refreshing ? <Spinner className="size-3" /> : null}
      <span className="h-1.5 w-9 overflow-hidden rounded-sm bg-muted">
        <span
          className={cn("block h-full rounded-sm", tone.fill)}
          style={{ width: `${barWidth}%` }}
        />
      </span>
      <span className={cn("min-w-6 text-right text-[10px] tabular-nums", tone.text)}>
        {remainingPercent !== null ? formatUsagePercent(remainingPercent) : "--"}
      </span>
    </span>
  );
}
