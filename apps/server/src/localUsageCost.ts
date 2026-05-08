import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ProviderKind } from "@wobex/contracts";
import { asNumber, asObject, asString } from "@wobex/shared/tokenUsage";

export interface LocalProviderUsageSummary {
  readonly provider: Extract<ProviderKind, "codex" | "claudeAgent">;
  readonly source: "local-files";
  readonly filesScanned: number;
  readonly sessions: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export interface LocalUsageSummary {
  readonly generatedAt: string;
  readonly since: string;
  readonly providers: readonly LocalProviderUsageSummary[];
}

export interface ReadLocalUsageSummaryOptions {
  readonly codexHome?: string | undefined;
  readonly claudeUsageDataDir?: string | undefined;
  readonly since?: Date | undefined;
}

interface TokenUsageSnapshot {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

const DEFAULT_LOOKBACK_DAYS = 30;
const CODEX_SESSION_FILE_LIMIT = 20_000;
const CLAUDE_SESSION_FILE_LIMIT = 20_000;

function zeroSnapshot(): TokenUsageSnapshot {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addSnapshots(left: TokenUsageSnapshot, right: TokenUsageSnapshot): TokenUsageSnapshot {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function snapshotFromRecord(record: Record<string, unknown>): TokenUsageSnapshot | null {
  const inputTokens = asNumber(record.input_tokens) ?? asNumber(record.inputTokens) ?? 0;
  const cachedInputTokens =
    asNumber(record.cached_input_tokens) ??
    asNumber(record.cachedInputTokens) ??
    asNumber(record.cache_read_input_tokens) ??
    asNumber(record.cacheReadInputTokens) ??
    0;
  const outputTokens = asNumber(record.output_tokens) ?? asNumber(record.outputTokens) ?? 0;
  const reasoningOutputTokens =
    asNumber(record.reasoning_output_tokens) ?? asNumber(record.reasoningOutputTokens) ?? 0;
  const explicitTotal = asNumber(record.total_tokens) ?? asNumber(record.totalTokens);
  const totalTokens =
    explicitTotal ?? inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;

  if (totalTokens <= 0) {
    return null;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function findTokenUsageSnapshot(value: unknown): TokenUsageSnapshot | null {
  const object = asObject(value);
  if (!object) {
    return null;
  }

  const direct =
    snapshotFromRecord(asObject(object.total_token_usage) ?? {}) ??
    snapshotFromRecord(asObject(object.totalTokenUsage) ?? {}) ??
    snapshotFromRecord(asObject(object.usage) ?? {}) ??
    snapshotFromRecord(asObject(object.total) ?? {}) ??
    snapshotFromRecord(object);
  if (direct) {
    return direct;
  }

  for (const nested of Object.values(object)) {
    if (!nested || typeof nested !== "object") {
      continue;
    }
    if (Array.isArray(nested)) {
      for (const entry of nested) {
        const snapshot = findTokenUsageSnapshot(entry);
        if (snapshot) {
          return snapshot;
        }
      }
      continue;
    }

    const snapshot = findTokenUsageSnapshot(nested);
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

function parseTimestamp(value: unknown): number | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const millis = Date.parse(text);
  return Number.isFinite(millis) ? millis : null;
}

async function collectFiles(root: string, extension: string, limit: number): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const visit = async (dir: string) => {
    if (files.length >= limit) {
      return;
    }
    let entries: Array<{
      readonly name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as typeof entries;
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(path);
        if (files.length >= limit) {
          return;
        }
      }
    }
  };

  await visit(root);
  return files;
}

async function summarizeCodexLocalUsage(input: {
  codexHome: string;
  since: Date;
}): Promise<LocalProviderUsageSummary> {
  const roots = [join(input.codexHome, "sessions"), join(input.codexHome, "archived_sessions")];
  const sinceMillis = input.since.getTime();
  const files = (
    await Promise.all(roots.map((root) => collectFiles(root, ".jsonl", CODEX_SESSION_FILE_LIMIT)))
  ).flat();
  let filesScanned = 0;
  let sessions = 0;
  let totals = zeroSnapshot();

  for (const file of files) {
    let raw: string;
    try {
      const fileStat = await stat(file);
      if (fileStat.mtimeMs < sinceMillis) {
        continue;
      }
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }

    filesScanned += 1;
    let best = zeroSnapshot();
    let hasRecentUsage = false;
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const record = asObject(parsed);
      const timestamp = parseTimestamp(record?.timestamp);
      const snapshot = findTokenUsageSnapshot(parsed);
      if (!snapshot) {
        continue;
      }
      if (timestamp === null || timestamp >= sinceMillis) {
        hasRecentUsage = true;
        if (snapshot.totalTokens >= best.totalTokens) {
          best = snapshot;
        }
      }
    }

    if (hasRecentUsage && best.totalTokens > 0) {
      sessions += 1;
      totals = addSnapshots(totals, best);
    }
  }

  return {
    provider: "codex",
    source: "local-files",
    filesScanned,
    sessions,
    ...totals,
  };
}

async function summarizeClaudeLocalUsage(input: {
  claudeUsageDataDir: string;
  since: Date;
}): Promise<LocalProviderUsageSummary> {
  const sessionMetaDir = join(input.claudeUsageDataDir, "session-meta");
  const sinceMillis = input.since.getTime();
  const files = await collectFiles(sessionMetaDir, ".json", CLAUDE_SESSION_FILE_LIMIT);
  let filesScanned = 0;
  let sessions = 0;
  let totals = zeroSnapshot();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch {
      continue;
    }

    const record = asObject(parsed);
    const startTime = parseTimestamp(record?.start_time);
    if (startTime !== null && startTime < sinceMillis) {
      continue;
    }

    filesScanned += 1;
    const snapshot = snapshotFromRecord(record ?? {});
    if (!snapshot) {
      continue;
    }
    sessions += 1;
    totals = addSnapshots(totals, snapshot);
  }

  return {
    provider: "claudeAgent",
    source: "local-files",
    filesScanned,
    sessions,
    ...totals,
  };
}

export async function readLocalUsageSummary(
  options: ReadLocalUsageSummaryOptions = {},
): Promise<LocalUsageSummary> {
  const now = new Date();
  const since =
    options.since ?? new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const codexHome = options.codexHome ?? join(homedir(), ".codex");
  const claudeUsageDataDir = options.claudeUsageDataDir ?? join(homedir(), ".claude", "usage-data");

  const [codex, claude] = await Promise.all([
    summarizeCodexLocalUsage({ codexHome, since }),
    summarizeClaudeLocalUsage({ claudeUsageDataDir, since }),
  ]);

  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    providers: [codex, claude],
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatProvider(provider: ProviderKind): string {
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

export function formatLocalUsageSummary(summary: LocalUsageSummary): string {
  const lines = [
    "Local Usage Comparison",
    `  Since ${summary.since}`,
    "  Token totals are read from local session files; no provider quota or pricing API is used.",
  ];

  for (const provider of summary.providers) {
    lines.push(
      [
        `  ${formatProvider(provider.provider).padEnd(6)}`,
        `${formatNumber(provider.totalTokens).padStart(12)} total`,
        `${formatNumber(provider.inputTokens).padStart(12)} input`,
        `${formatNumber(provider.cachedInputTokens).padStart(12)} cached`,
        `${formatNumber(provider.outputTokens).padStart(10)} output`,
        `${formatNumber(provider.reasoningOutputTokens).padStart(10)} reasoning`,
        `${provider.sessions} sessions`,
        `${provider.filesScanned} files`,
      ].join("  "),
    );
  }

  return lines.join("\n");
}
