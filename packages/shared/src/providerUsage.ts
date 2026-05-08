export interface ProviderUsageWindowLike {
  readonly label?: string | undefined;
  readonly usedPercent?: number | null | undefined;
  readonly remainingPercent?: number | null | undefined;
  readonly kind?: "session" | "weekly" | "other" | undefined;
  readonly windowMinutes?: number | null | undefined;
  readonly windowDurationMins?: number | null | undefined;
  readonly resetsAt?: string | null | undefined;
  readonly source?: string | undefined;
}

export interface UsagePace {
  readonly status: "reserve" | "on-track" | "ahead" | "unknown";
  readonly expectedUsedPercent: number;
  readonly deltaPercent: number;
  readonly elapsedMinutes: number;
  readonly remainingMinutes: number;
  readonly lastsUntilReset: boolean | null;
  readonly runsOutInMinutes: number | null;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function formatPrecisePercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

export function formatUsageDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  const days = minutes / (60 * 24);
  return Number.isInteger(days) ? `${days}d` : `${days.toFixed(1)}d`;
}

function getWindowMinutes(window: ProviderUsageWindowLike): number | null {
  const minutes = window.windowMinutes ?? window.windowDurationMins ?? null;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function calculateUsagePace(
  window: ProviderUsageWindowLike,
  now: Date = new Date(),
): UsagePace | null {
  const windowMinutes = getWindowMinutes(window);
  if (
    window.kind !== "weekly" ||
    typeof window.usedPercent !== "number" ||
    !Number.isFinite(window.usedPercent) ||
    windowMinutes === null ||
    !window.resetsAt
  ) {
    return null;
  }

  const resetAt = new Date(window.resetsAt);
  if (!Number.isFinite(resetAt.getTime())) {
    return null;
  }

  const remainingMinutes = (resetAt.getTime() - now.getTime()) / 60_000;
  if (remainingMinutes <= 0 || remainingMinutes >= windowMinutes) {
    return null;
  }

  const elapsedMinutes = windowMinutes - remainingMinutes;
  if (elapsedMinutes <= 0) {
    return null;
  }

  const expectedUsedPercent = clampPercent((elapsedMinutes / windowMinutes) * 100);
  const deltaPercent = window.usedPercent - expectedUsedPercent;
  const status = Math.abs(deltaPercent) <= 2 ? "on-track" : deltaPercent > 0 ? "ahead" : "reserve";
  const consumptionPercentPerMinute = window.usedPercent / elapsedMinutes;
  const minutesUntilFull =
    consumptionPercentPerMinute > 0
      ? Math.max(0, (100 - window.usedPercent) / consumptionPercentPerMinute)
      : Number.POSITIVE_INFINITY;
  const lastsUntilReset = minutesUntilFull >= remainingMinutes;

  return {
    status,
    expectedUsedPercent: Math.round(expectedUsedPercent * 100) / 100,
    deltaPercent: Math.round(deltaPercent * 100) / 100,
    elapsedMinutes: Math.round(elapsedMinutes),
    remainingMinutes: Math.round(remainingMinutes),
    lastsUntilReset,
    runsOutInMinutes: lastsUntilReset ? null : Math.round(minutesUntilFull),
  };
}
