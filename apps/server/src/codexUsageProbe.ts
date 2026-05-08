import { spawn } from "node:child_process";
import readline from "node:readline";

import type { ProviderKind, ServerRefreshProviderUsageResult } from "@wobex/contracts";
import { asNumber, asObject, asString } from "@wobex/shared/tokenUsage";

import { buildCodexProcessEnv } from "./codexProcessEnv";
import { buildCodexInitializeParams, killCodexChildProcess } from "./provider/codexAppServer";

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface CodexUsageWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
  kind: "session" | "weekly" | "other";
  windowMinutes: number | undefined;
  source: "app-server";
}

type RunAppServerRequest = (input: {
  binaryPath: string;
  homePath?: string | undefined;
  timeoutMs: number;
}) => Promise<unknown>;

let cachedResult: {
  expiresAt: number;
  result: ServerRefreshProviderUsageResult;
} | null = null;

function toUsageResult(input: {
  provider: ProviderKind;
  windows: readonly CodexUsageWindow[];
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
        resetsAt: window.resetsAt,
        kind: window.kind,
        ...(window.windowMinutes !== undefined ? { windowMinutes: window.windowMinutes } : {}),
        source: window.source,
      })),
    },
  };
}

function normalizeLimitName(limit: Record<string, unknown>): string {
  const name = asString(limit.limitName)?.trim();
  if (name) {
    return name;
  }

  const id = asString(limit.limitId)?.trim();
  if (!id || id === "codex") {
    return "Codex";
  }

  return id
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeWindowLabel(durationMins: number | undefined): string {
  switch (durationMins) {
    case 300:
      return "5h";
    case 10080:
      return "weekly";
    default:
      return durationMins ? `${durationMins}m` : "window";
  }
}

function normalizeWindowKind(durationMins: number | undefined): "session" | "weekly" | "other" {
  switch (durationMins) {
    case 300:
      return "session";
    case 10080:
      return "weekly";
    default:
      return "other";
  }
}

function normalizeResetTime(value: unknown): string | null {
  const reset = asNumber(value);
  if (reset === undefined) {
    return null;
  }
  const millis = reset < 10_000_000_000 ? reset * 1000 : reset;
  return new Date(millis).toISOString();
}

function pushWindow(
  windows: CodexUsageWindow[],
  limit: Record<string, unknown>,
  key: "primary" | "secondary",
): void {
  const window = asObject(limit[key]);
  if (!window) {
    return;
  }

  const usedPercent = asNumber(window.usedPercent);
  if (usedPercent === undefined) {
    return;
  }

  const durationMins = asNumber(window.windowDurationMins);
  windows.push({
    label: `${normalizeLimitName(limit)} ${normalizeWindowLabel(durationMins)}`,
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetsAt: normalizeResetTime(window.resetsAt),
    kind: normalizeWindowKind(durationMins),
    windowMinutes: durationMins,
    source: "app-server",
  });
}

function collectLimitWindows(limit: Record<string, unknown> | undefined): CodexUsageWindow[] {
  if (!limit) {
    return [];
  }
  const windows: CodexUsageWindow[] = [];
  pushWindow(windows, limit, "primary");
  pushWindow(windows, limit, "secondary");
  return windows;
}

export function parseCodexRateLimitsResult(value: unknown): CodexUsageWindow[] {
  const root = asObject(value);
  if (!root) {
    return [];
  }

  const windows = collectLimitWindows(asObject(root.rateLimits));
  const primaryLimitId = asString(asObject(root.rateLimits)?.limitId);
  const byLimitId = asObject(root.rateLimitsByLimitId);
  if (byLimitId) {
    for (const [limitId, limitValue] of Object.entries(byLimitId)) {
      if (limitId === primaryLimitId) {
        continue;
      }
      windows.push(...collectLimitWindows(asObject(limitValue)));
    }
  }

  return windows;
}

async function runCodexAppServerRequest(input: {
  binaryPath: string;
  homePath?: string | undefined;
  timeoutMs: number;
}): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ["app-server"], {
      env: buildCodexProcessEnv(input.homePath ? { homePath: input.homePath } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let completed = false;
    const output = readline.createInterface({ input: child.stdout });
    const timeout = setTimeout(
      () => fail(new Error("Codex usage probe timed out.")),
      input.timeoutMs,
    );

    const cleanup = () => {
      clearTimeout(timeout);
      output.removeAllListeners();
      output.close();
      child.removeAllListeners();
      if (!child.killed) {
        killCodexChildProcess(child);
      }
    };

    const finish = (callback: () => void) => {
      if (completed) return;
      completed = true;
      cleanup();
      callback();
    };

    const fail = (error: Error) => finish(() => reject(error));

    const writeMessage = (message: unknown) => {
      if (!child.stdin.writable) {
        fail(new Error("Cannot write to codex app-server stdin."));
        return;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    output.on("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail(new Error("Received invalid JSON from codex app-server during usage probe."));
        return;
      }

      const message = asObject(parsed);
      if (!message) {
        return;
      }

      const id = message.id;
      const error = asObject(message.error);
      const errorMessage = asString(error?.message);
      if (id === 1) {
        if (errorMessage) {
          fail(new Error(`initialize failed: ${errorMessage}`));
          return;
        }
        writeMessage({ method: "initialized" });
        writeMessage({ id: 2, method: "account/rateLimits/read" });
        return;
      }

      if (id === 2) {
        if (errorMessage) {
          fail(new Error(`account/rateLimits/read failed: ${errorMessage}`));
          return;
        }
        finish(() => resolve(message.result));
      }
    });

    child.once("error", (error) => fail(error));
    child.once("exit", (code, signal) => {
      if (completed) return;
      fail(
        new Error(
          `codex app-server exited before usage probe completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    });

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}

export async function refreshCodexUsage(input: {
  provider: ProviderKind;
  force?: boolean | undefined;
  binaryPath?: string | undefined;
  homePath?: string | undefined;
  timeoutMs?: number | undefined;
  runAppServerRequest?: RunAppServerRequest | undefined;
}): Promise<ServerRefreshProviderUsageResult> {
  if (input.provider !== "codex") {
    return toUsageResult({
      provider: input.provider,
      windows: [],
      cached: false,
      error: "Provider usage refresh is only supported for Codex.",
    });
  }

  const now = Date.now();
  if (!input.force && cachedResult && cachedResult.expiresAt > now) {
    return { ...cachedResult.result, cached: true };
  }

  try {
    const rateLimits = await (input.runAppServerRequest ?? runCodexAppServerRequest)({
      binaryPath: input.binaryPath ?? "codex",
      homePath: input.homePath,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const windows = parseCodexRateLimitsResult(rateLimits);
    const result = toUsageResult({
      provider: input.provider,
      windows,
      cached: false,
      ...(windows.length === 0 ? { error: "Codex usage output was not detected." } : {}),
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
