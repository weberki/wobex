import type { OrchestrationThreadActivity } from "@wobex/contracts";

export interface RateLimitWindow {
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  resetLabel: string | null;
  status: "ok" | "allowed_warning" | "rejected" | null;
  kind: "session" | "weekly" | "other" | null;
  source: string | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  windowDurationMins: number | null;
  limitId: string | null;
  limitName: string | null;
}

export interface RateLimitSnapshot {
  updatedAt: string;
  windows: RateLimitWindow[];
  overallStatus: "allowed_warning" | "rejected" | null;
}

export interface RateLimitStatus {
  status: "allowed_warning" | "rejected";
  resetsAt: string | null;
  utilization: number | null;
  label: string | null;
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asUsageWindowKind(value: unknown): RateLimitWindow["kind"] {
  return value === "session" || value === "weekly" || value === "other" ? value : null;
}

function asIsoString(value: unknown): string | null {
  const stringValue = asString(value);
  if (!stringValue) return null;
  return Number.isNaN(Date.parse(stringValue)) ? null : stringValue;
}

function normalizeLabel(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return value.replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatLimitLabel(limitId: string | null, limitName: string | null): string | null {
  if (limitName) {
    return limitName;
  }
  if (!limitId) {
    return null;
  }
  const normalized = normalizeLabel(limitId, limitId);
  return normalized.toLowerCase() === "codex" ? "Codex" : titleCaseWords(normalized);
}

function formatWindowDurationLabel(windowDurationMins: number | null): string | null {
  if (windowDurationMins === null) {
    return null;
  }
  if (windowDurationMins === 300) {
    return "5h";
  }
  if (windowDurationMins === 10080) {
    return "weekly";
  }
  if (windowDurationMins % 1440 === 0) {
    const days = windowDurationMins / 1440;
    return days === 1 ? "daily" : `${days}d`;
  }
  if (windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}h`;
  }
  return `${windowDurationMins}m`;
}

function toResetTime(value: unknown): string | null {
  const isoValue = asIsoString(value);
  if (isoValue) return isoValue;

  const numericValue = asFiniteNumber(value);
  if (numericValue === null) return null;
  const epochMs = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
  const parsed = new Date(epochMs);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function firstDefinedNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = asFiniteNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function firstDefinedString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function firstDefinedResetTime(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = toResetTime(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function statusFromRecord(record: Record<string, unknown>): "allowed_warning" | "rejected" | null {
  const rawStatus = firstDefinedString(record, [
    "status",
    "state",
    "decision",
    "level",
    "severity",
    "event",
    "result",
  ])?.toLowerCase();
  if (rawStatus) {
    if (
      rawStatus.includes("reject") ||
      rawStatus.includes("denied") ||
      rawStatus.includes("block") ||
      rawStatus.includes("exhaust") ||
      rawStatus.includes("limit_reached")
    ) {
      return "rejected";
    }
    if (
      rawStatus.includes("warn") ||
      rawStatus.includes("throttle") ||
      rawStatus.includes("approach") ||
      rawStatus.includes("near")
    ) {
      return "allowed_warning";
    }
  }

  const rejected = asBoolean(record.rejected) ?? asBoolean(record.isRejected) ?? false;
  if (rejected) {
    return "rejected";
  }

  return null;
}

interface RateLimitWindowContext {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
}

function extendWindowContext(
  context: RateLimitWindowContext,
  record: Record<string, unknown>,
): RateLimitWindowContext {
  return {
    limitId: firstDefinedString(record, ["limitId", "limit_id"]) ?? context.limitId,
    limitName: firstDefinedString(record, ["limitName", "limit_name"]) ?? context.limitName,
    planType: firstDefinedString(record, ["planType", "plan_type"]) ?? context.planType,
  };
}

function buildRateLimitWindowLabel(input: {
  record: Record<string, unknown>;
  fallbackLabel: string;
  context: RateLimitWindowContext;
  windowDurationMins: number | null;
}): string {
  const explicitLabel = firstDefinedString(input.record, [
    "label",
    "name",
    "window",
    "period",
    "type",
  ]);
  if (explicitLabel) {
    return normalizeLabel(explicitLabel, input.fallbackLabel);
  }

  const limitLabel = formatLimitLabel(input.context.limitId, input.context.limitName);
  const durationLabel = formatWindowDurationLabel(input.windowDurationMins);
  if (limitLabel && durationLabel) {
    return `${limitLabel} ${durationLabel}`;
  }
  if (durationLabel) {
    return durationLabel;
  }
  return normalizeLabel(null, input.fallbackLabel);
}

function buildWindowFromRecord(
  record: Record<string, unknown>,
  fallbackLabel: string,
  context: RateLimitWindowContext,
): RateLimitWindow | null {
  const used = firstDefinedNumber(record, ["used", "current", "consumed", "count", "value"]);
  const limit = firstDefinedNumber(record, ["limit", "max", "capacity", "allowed"]);
  const remaining = firstDefinedNumber(record, ["remaining", "available", "left"]);
  const explicitRemainingPercent = firstDefinedNumber(record, [
    "remainingPercent",
    "percentRemaining",
    "availablePercent",
  ]);
  const utilization =
    firstDefinedNumber(record, ["utilization", "usedPercent", "percentUsed", "usagePercent"]) ??
    firstDefinedNumber(record, ["pct", "percentage"]);
  const resetsAt = firstDefinedResetTime(record, [
    "resetsAt",
    "resetAt",
    "reset_at",
    "retryAt",
    "retry_at",
    "until",
  ]);
  const resetLabel = firstDefinedString(record, ["resetLabel", "reset_label", "resetText"]);
  const windowDurationMins = firstDefinedNumber(record, [
    "windowMinutes",
    "window_minutes",
    "windowDurationMins",
    "window_duration_mins",
    "durationMins",
    "durationMinutes",
  ]);
  const computedUsedPercent =
    utilization !== null
      ? Math.min(100, utilization <= 1 ? utilization * 100 : utilization)
      : explicitRemainingPercent !== null
        ? Math.max(0, Math.min(100, 100 - explicitRemainingPercent))
        : used !== null && limit !== null && limit > 0
          ? Math.min(100, (used / limit) * 100)
          : remaining !== null && limit !== null && limit > 0
            ? Math.min(100, ((limit - remaining) / limit) * 100)
            : null;
  const remainingPercent =
    explicitRemainingPercent !== null
      ? Math.max(0, Math.min(100, explicitRemainingPercent))
      : computedUsedPercent !== null
        ? Math.max(0, Math.min(100, 100 - computedUsedPercent))
        : null;

  const recordStatus = statusFromRecord(record);
  const status =
    recordStatus ??
    (remaining !== null && remaining <= 0
      ? "rejected"
      : computedUsedPercent !== null && computedUsedPercent >= 80
        ? "allowed_warning"
        : null);

  if (
    used === null &&
    limit === null &&
    remaining === null &&
    computedUsedPercent === null &&
    resetsAt === null &&
    windowDurationMins === null &&
    status === null
  ) {
    return null;
  }

  return {
    label: buildRateLimitWindowLabel({
      record,
      fallbackLabel,
      context,
      windowDurationMins,
    }),
    usedPercent: computedUsedPercent,
    resetsAt,
    resetLabel,
    status,
    kind: asUsageWindowKind(record.kind),
    source: firstDefinedString(record, ["source"]),
    used,
    limit,
    remaining,
    remainingPercent,
    windowDurationMins,
    limitId: context.limitId,
    limitName: context.limitName,
  };
}

function collectCandidateWindows(
  value: unknown,
  path = "Limit",
  context: RateLimitWindowContext = { limitId: null, limitName: null, planType: null },
): RateLimitWindow[] {
  const record = asRecord(value);
  if (record) {
    const nextContext = extendWindowContext(context, record);
    const directWindow = buildWindowFromRecord(record, path, nextContext);
    const nestedWindows = Object.entries(record).flatMap(([key, nestedValue]) =>
      collectCandidateWindows(nestedValue, normalizeLabel(asString(key), path), nextContext),
    );
    return directWindow ? [directWindow, ...nestedWindows] : nestedWindows;
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectCandidateWindows(entry, `${path} ${index + 1}`, context),
    );
  }

  return [];
}

function dedupeWindows(windows: readonly RateLimitWindow[]): RateLimitWindow[] {
  const seen = new Set<string>();
  const deduped: RateLimitWindow[] = [];
  for (const window of windows) {
    const key = [
      window.label,
      window.usedPercent ?? "na",
      window.resetsAt ?? "na",
      window.resetLabel ?? "na",
      window.used ?? "na",
      window.limit ?? "na",
      window.remaining ?? "na",
      window.windowDurationMins ?? "na",
      window.limitId ?? "na",
      window.limitName ?? "na",
      window.kind ?? "na",
      window.source ?? "na",
      window.status ?? "na",
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(window);
  }
  return deduped;
}

function rateLimitWindowSeverity(status: RateLimitWindow["status"]): number {
  return status === "rejected" ? 2 : status === "allowed_warning" ? 1 : 0;
}

export function deriveLatestRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): RateLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account.rate-limits.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const rateLimits = payload?.rateLimits ?? payload ?? null;
    return deriveRateLimitSnapshotFromRateLimits(rateLimits, activity.createdAt);
  }

  return null;
}

export function deriveRateLimitSnapshotFromRateLimits(
  rateLimits: unknown,
  updatedAt: string,
): RateLimitSnapshot | null {
  const windows = dedupeWindows(collectCandidateWindows(rateLimits)).toSorted((left, right) => {
    const bySeverity = rateLimitWindowSeverity(right.status) - rateLimitWindowSeverity(left.status);
    if (bySeverity !== 0) return bySeverity;
    return (right.usedPercent ?? -1) - (left.usedPercent ?? -1);
  });
  if (windows.length === 0) {
    return null;
  }
  return {
    updatedAt,
    windows,
    overallStatus: windows.some((window) => window.status === "rejected")
      ? "rejected"
      : windows.some((window) => window.status === "allowed_warning")
        ? "allowed_warning"
        : null,
  };
}

export function deriveLatestRateLimitStatus(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): RateLimitStatus | null {
  const snapshot = deriveLatestRateLimitSnapshot(activities);
  if (!snapshot?.overallStatus) {
    return null;
  }

  const primaryWindow =
    snapshot.windows.find((window) => window.status === snapshot.overallStatus) ??
    snapshot.windows[0] ??
    null;
  if (!primaryWindow) {
    return null;
  }

  return {
    status: snapshot.overallStatus,
    resetsAt: primaryWindow.resetsAt,
    utilization:
      primaryWindow.usedPercent !== null
        ? Math.max(0, Math.min(1, primaryWindow.usedPercent / 100))
        : null,
    label: primaryWindow.label,
    updatedAt: snapshot.updatedAt,
  };
}

export function formatRateLimitResetTime(resetsAt: string | null): string | null {
  if (!resetsAt) {
    return null;
  }

  const parsedMs = Date.parse(resetsAt);
  if (Number.isNaN(parsedMs)) {
    return null;
  }

  const secondsLeft = Math.max(0, Math.ceil((parsedMs - Date.now()) / 1000));
  if (secondsLeft < 60) {
    return `Resets in ${secondsLeft}s`;
  }
  const minutesLeft = Math.ceil(secondsLeft / 60);
  if (minutesLeft < 60) {
    return `Resets in ${minutesLeft}m`;
  }
  return `Resets at ${new Date(parsedMs).toLocaleTimeString()}`;
}
