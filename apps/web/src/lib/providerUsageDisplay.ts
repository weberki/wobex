import {
  calculateUsagePace,
  clampPercent,
  formatPrecisePercent,
  formatUsageDuration,
} from "@wobex/shared/providerUsage";
import {
  formatRateLimitResetTime,
  type RateLimitSnapshot,
  type RateLimitWindow,
} from "./rateLimits";

export interface ProviderUsagePaceDisplay {
  readonly status: "reserve" | "on-track" | "ahead";
  readonly text: string;
}

function isFinitePercent(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatUsagePercent(value: number | null | undefined): string {
  if (!isFinitePercent(value)) {
    return "Unknown";
  }
  const percent = clampPercent(value);
  if (percent < 10 && percent > 0) {
    return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(percent)}%`;
}

export function getUsageUsedPercent(window: RateLimitWindow): number | null {
  if (isFinitePercent(window.usedPercent)) {
    return clampPercent(window.usedPercent);
  }
  if (isFinitePercent(window.remainingPercent)) {
    return clampPercent(100 - window.remainingPercent);
  }
  return null;
}

export function getUsageRemainingPercent(window: RateLimitWindow): number | null {
  if (isFinitePercent(window.remainingPercent)) {
    return clampPercent(window.remainingPercent);
  }
  if (isFinitePercent(window.usedPercent)) {
    return clampPercent(100 - window.usedPercent);
  }
  return null;
}

export function selectPrimaryUsageWindow(
  snapshot: RateLimitSnapshot | null,
): RateLimitWindow | null {
  if (!snapshot || snapshot.windows.length === 0) {
    return null;
  }
  return (
    snapshot.windows.find((window) => window.kind === "session") ??
    snapshot.windows.find((window) => window.windowDurationMins === 300) ??
    snapshot.windows.find((window) => /\b5h\b/i.test(window.label)) ??
    snapshot.windows.find((window) => window.kind === "weekly") ??
    snapshot.windows[0] ??
    null
  );
}

export function formatUsageReset(window: RateLimitWindow): string {
  return window.resetLabel ?? formatRateLimitResetTime(window.resetsAt) ?? "Reset unknown";
}

export function formatUsageSource(snapshot: RateLimitSnapshot | null): string | null {
  const source = snapshot?.windows.find((window) => window.source)?.source ?? null;
  return source ? `Source ${source}` : null;
}

export function formatUsageUpdatedAt(updatedAt: string): string {
  const parsed = new Date(updatedAt);
  if (!Number.isFinite(parsed.getTime())) {
    return updatedAt;
  }
  return parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatUsagePaceDisplay(
  window: RateLimitWindow,
  now: Date = new Date(),
): ProviderUsagePaceDisplay | null {
  const pace = calculateUsagePace(
    {
      kind: window.kind ?? undefined,
      usedPercent: getUsageUsedPercent(window),
      windowDurationMins: window.windowDurationMins,
      resetsAt: window.resetsAt,
    },
    now,
  );
  if (!pace) {
    return null;
  }

  if (pace.status === "reserve") {
    const suffix = pace.lastsUntilReset
      ? "Lasts until reset."
      : `Runs out in ${formatUsageDuration(pace.runsOutInMinutes ?? 0)}.`;
    return {
      status: "reserve",
      text: `${formatPrecisePercent(Math.abs(pace.deltaPercent))} reserve vs linear plan (${formatPrecisePercent(pace.expectedUsedPercent)} expected). ${suffix}`,
    };
  }

  if (pace.status === "ahead") {
    const suffix = pace.lastsUntilReset
      ? "Still lasts until reset."
      : `Runs out in ${formatUsageDuration(pace.runsOutInMinutes ?? 0)}.`;
    return {
      status: "ahead",
      text: `${formatPrecisePercent(pace.deltaPercent)} ahead vs linear plan (${formatPrecisePercent(pace.expectedUsedPercent)} expected). ${suffix}`,
    };
  }

  return {
    status: "on-track",
    text: `On track vs linear plan (${formatPrecisePercent(pace.expectedUsedPercent)} expected).`,
  };
}
