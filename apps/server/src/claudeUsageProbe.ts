import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { ProviderKind, ServerRefreshProviderUsageResult } from "@wobex/contracts";

const TMUX_SESSION_PREFIX = "wobex-claude-usage";
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 400;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

export interface ClaudeUsageWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetLabel: string;
  kind: "session" | "weekly" | "other";
  source: "tmux";
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface TmuxCommandOptions {
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

type RunCommand = (
  command: string,
  args: readonly string[],
  options?: TmuxCommandOptions,
) => Promise<CommandResult>;
type SleepFn = (ms: number) => Promise<void>;

let cachedResult: {
  expiresAt: number;
  result: ServerRefreshProviderUsageResult;
} | null = null;

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_PATTERN, "");
}

function normalizeCapturedText(value: string): string {
  return stripAnsi(value)
    .replaceAll("\u00a0", " ")
    .replaceAll(/\r/g, "\n")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\n+/g, "\n")
    .trim();
}

function mapClaudeUsageLabel(value: string): string {
  switch (value) {
    case "Current session":
      return "Claude 5h";
    case "Current week (all models)":
      return "Claude weekly";
    case "Current week (Sonnet only)":
      return "Claude weekly Sonnet";
    default:
      return value;
  }
}

function mapClaudeUsageKind(value: string): "session" | "weekly" | "other" {
  switch (value) {
    case "Current session":
      return "session";
    case "Current week (all models)":
    case "Current week (Sonnet only)":
      return "weekly";
    default:
      return "other";
  }
}

export function parseClaudeUsageText(text: string): ClaudeUsageWindow[] {
  const normalized = normalizeCapturedText(text);
  const windows: ClaudeUsageWindow[] = [];
  const pattern =
    /(Current session|Current week \(all models\)|Current week \(Sonnet only\))\s+Resets\s+(.+?)\s+(\d+(?:\.\d+)?)%\s+used/g;

  for (const match of normalized.matchAll(pattern)) {
    const usedPercent = Number.parseFloat(match[3] ?? "");
    if (!Number.isFinite(usedPercent)) {
      continue;
    }
    windows.push({
      label: mapClaudeUsageLabel(match[1] ?? "Claude usage"),
      resetLabel: (match[2] ?? "").trim(),
      usedPercent,
      remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
      kind: mapClaudeUsageKind(match[1] ?? ""),
      source: "tmux",
    });
  }

  return windows;
}

function execFileCommand(
  command: string,
  args: readonly string[],
  options: TmuxCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 2_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          stdout,
          stderr,
        });
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUsageResult(input: {
  provider: ProviderKind;
  windows: readonly ClaudeUsageWindow[];
  cached: boolean;
  error?: string;
}): ServerRefreshProviderUsageResult {
  return {
    provider: input.provider,
    refreshedAt: new Date().toISOString(),
    cached: input.cached,
    available: input.windows.length > 0,
    ...(input.error ? { error: input.error } : {}),
    rateLimits: {
      windows: input.windows.map((window) => ({
        label: window.label,
        usedPercent: window.usedPercent,
        remainingPercent: window.remainingPercent,
        resetsAt: null,
        resetLabel: window.resetLabel,
        kind: window.kind,
        source: window.source,
      })),
    },
  };
}

async function captureUsageWithTmux(input: {
  cwd?: string | undefined;
  timeoutMs: number;
  runCommand: RunCommand;
  sleepFn: SleepFn;
}): Promise<ClaudeUsageWindow[]> {
  const sessionName = `${TMUX_SESSION_PREFIX}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  let started = false;
  const runTmux = (args: readonly string[], timeoutMs = 2_000) =>
    input.runCommand("tmux", args, { cwd: input.cwd, timeoutMs });

  try {
    await runTmux([
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-x",
      "120",
      "-y",
      "40",
      ...(input.cwd ? ["-c", input.cwd] : []),
      "claude",
    ]);
    started = true;

    await input.sleepFn(1_200);
    await runTmux(["send-keys", "-t", sessionName, "/usage", "Enter"]);

    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      await input.sleepFn(POLL_INTERVAL_MS);
      const capture = await runTmux([
        "capture-pane",
        "-p",
        "-J",
        "-S",
        "-",
        "-E",
        "-",
        "-t",
        sessionName,
      ]);
      const windows = parseClaudeUsageText(capture.stdout);
      if (windows.length > 0) {
        return windows;
      }
    }

    return [];
  } finally {
    if (started) {
      await runTmux(["kill-session", "-t", sessionName]).catch(() => undefined);
    }
  }
}

export async function refreshClaudeUsage(input: {
  provider: ProviderKind;
  cwd?: string | undefined;
  force?: boolean | undefined;
  timeoutMs?: number | undefined;
  runCommand?: RunCommand | undefined;
  sleepFn?: SleepFn | undefined;
}): Promise<ServerRefreshProviderUsageResult> {
  if (input.provider !== "claudeAgent") {
    return toUsageResult({
      provider: input.provider,
      windows: [],
      cached: false,
      error: "Provider usage refresh is only supported for Claude.",
    });
  }

  const now = Date.now();
  if (!input.force && cachedResult && cachedResult.expiresAt > now) {
    return { ...cachedResult.result, cached: true };
  }

  try {
    const windows = await captureUsageWithTmux({
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      runCommand: input.runCommand ?? execFileCommand,
      sleepFn: input.sleepFn ?? sleep,
    });
    const result = toUsageResult({
      provider: input.provider,
      windows,
      cached: false,
      ...(windows.length === 0 ? { error: "Claude usage output was not detected." } : {}),
    });
    if (windows.length > 0) {
      cachedResult = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        result,
      };
    }
    return result;
  } catch (error) {
    return toUsageResult({
      provider: input.provider,
      windows: [],
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
