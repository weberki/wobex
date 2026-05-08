import type {
  ProviderKind,
  ServerProviderUsageWindow,
  ServerRefreshProviderUsageResult,
} from "@wobex/contracts";
import {
  calculateUsagePace,
  clampPercent,
  formatPrecisePercent,
  formatUsageDuration,
} from "@wobex/shared/providerUsage";

export { calculateUsagePace, type UsagePace } from "@wobex/shared/providerUsage";

const ANSI_RESET = "\u001b[0m";
const ANSI_DIM = "\u001b[2m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_RED = "\u001b[31m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_BLUE = "\u001b[34m";
const ANSI_GRAY = "\u001b[90m";
const PROVIDER_COLORS: Partial<Record<ProviderKind, string>> = {
  claudeAgent: ANSI_GREEN,
  codex: ANSI_BLUE,
};

export interface UsageCliFormatOptions {
  readonly now?: Date | undefined;
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "unknown";
}

function formatProviderName(provider: ProviderKind): string {
  switch (provider) {
    case "claudeAgent":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "droid":
      return "Droid";
  }
}

function colorize(provider: ProviderKind, value: string): string {
  const color = PROVIDER_COLORS[provider];
  return color ? `${color}${value}${ANSI_RESET}` : value;
}

function colorByRemaining(provider: ProviderKind, remainingPercent: number | null | undefined) {
  if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent)) {
    return ANSI_GRAY;
  }
  if (remainingPercent <= 10) return ANSI_RED;
  if (remainingPercent <= 25) return ANSI_YELLOW;
  return PROVIDER_COLORS[provider] ?? ANSI_GREEN;
}

function colorizeRemaining(
  provider: ProviderKind,
  value: string,
  remainingPercent: number | null | undefined,
): string {
  return `${colorByRemaining(provider, remainingPercent)}${value}${ANSI_RESET}`;
}

function formatUsageBar(
  provider: ProviderKind,
  remainingPercent: number | null | undefined,
): string {
  const width = 24;
  const remaining =
    typeof remainingPercent === "number" && Number.isFinite(remainingPercent)
      ? clampPercent(remainingPercent)
      : 0;
  const filled = Math.round((remaining / 100) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  return `${colorByRemaining(provider, remainingPercent)}${bar}${ANSI_RESET}`;
}

function formatReset(window: ServerProviderUsageWindow): string {
  return window.resetLabel ?? window.resetsAt ?? "unknown";
}

function formatPaceLine(
  provider: ProviderKind,
  window: ServerProviderUsageWindow,
  options: UsageCliFormatOptions,
): string | null {
  const pace = calculateUsagePace(window, options.now ?? new Date());
  if (!pace) return null;

  if (pace.status === "reserve") {
    const suffix = pace.lastsUntilReset
      ? "Lasts until reset"
      : `Runs out in ${formatUsageDuration(pace.runsOutInMinutes ?? 0)}`;
    return `  Pace         ${ANSI_GREEN}${formatPrecisePercent(Math.abs(pace.deltaPercent))} reserve${ANSI_RESET} vs linear plan (${formatPrecisePercent(pace.expectedUsedPercent)} expected). ${suffix}.`;
  }
  if (pace.status === "ahead") {
    const suffix = pace.lastsUntilReset
      ? "Still lasts until reset"
      : `Runs out in ${formatUsageDuration(pace.runsOutInMinutes ?? 0)}`;
    return `  Pace         ${ANSI_YELLOW}${formatPrecisePercent(pace.deltaPercent)} ahead${ANSI_RESET} vs linear plan (${formatPrecisePercent(pace.expectedUsedPercent)} expected). ${suffix}.`;
  }
  return `  Pace         ${colorize(provider, "on track")} vs linear plan (${formatPrecisePercent(pace.expectedUsedPercent)} expected).`;
}

function formatWindowLine(provider: ProviderKind, window: ServerProviderUsageWindow): string {
  const label = window.label.padEnd(26);
  const remaining = formatPercent(window.remainingPercent).padStart(4);
  const used = formatPercent(window.usedPercent).padStart(4);
  return [
    `  ${colorize(provider, label)}`,
    formatUsageBar(provider, window.remainingPercent),
    `${colorizeRemaining(provider, remaining, window.remainingPercent)} remaining`,
    `${ANSI_DIM}${used} used${ANSI_RESET}`,
    `${ANSI_DIM}reset ${formatReset(window)}${ANSI_RESET}`,
  ].join("  ");
}

function formatProviderMeta(result: ServerRefreshProviderUsageResult): string {
  const firstWindow = result.rateLimits.windows[0];
  const source = firstWindow?.source ?? "unknown";
  const cached = result.cached ? "cached" : "fresh";
  return `${ANSI_DIM}  Loading source ${source} · ${cached} · ${result.refreshedAt}${ANSI_RESET}`;
}

export function formatProviderUsageResult(
  result: ServerRefreshProviderUsageResult,
  options: UsageCliFormatOptions = {},
): string {
  const providerName = formatProviderName(result.provider);
  if (!result.available || result.rateLimits.windows.length === 0) {
    return `${providerName} usage unavailable${result.error ? `: ${result.error}` : "."}`;
  }

  const header = `${colorize(result.provider, `${ANSI_BOLD}${providerName} Usage${ANSI_RESET}`)}`;
  const lines = [header, formatProviderMeta(result)];
  for (const window of result.rateLimits.windows) {
    lines.push(formatWindowLine(result.provider, window));
    const paceLine = formatPaceLine(result.provider, window, options);
    if (paceLine) {
      lines.push(paceLine);
    }
  }

  return lines.join("\n");
}

export function formatProviderUsageResults(
  results: readonly ServerRefreshProviderUsageResult[],
  options: UsageCliFormatOptions = {},
): string {
  return results.map((result) => formatProviderUsageResult(result, options)).join("\n\n");
}

export async function withUsageSpinner<T>(
  label: string,
  task: () => Promise<T>,
  enabled = true,
): Promise<T> {
  if (!enabled || !process.stderr.isTTY) {
    return await task();
  }

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frame = 0;
  const render = () => {
    process.stderr.write(`\r${colorize("codex", frames[frame % frames.length] ?? "|")} ${label}`);
    frame += 1;
  };

  render();
  const interval = setInterval(render, 80);
  try {
    return await task();
  } finally {
    clearInterval(interval);
    process.stderr.write(`\r${" ".repeat(label.length + 4)}\r`);
  }
}
