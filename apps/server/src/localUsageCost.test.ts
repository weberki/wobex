import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatLocalUsageSummary, readLocalUsageSummary } from "./localUsageCost";

describe("localUsageCost", () => {
  it("summarizes Codex JSONL and Claude session metadata without double-counting Codex cumulative usage", async () => {
    const root = mkdtempSync(join(tmpdir(), "wobex-local-usage-"));
    const codexHome = join(root, "codex");
    const claudeUsageDataDir = join(root, "claude", "usage-data");
    const codexSessionDir = join(codexHome, "sessions", "2026", "04", "17");
    const claudeSessionMetaDir = join(claudeUsageDataDir, "session-meta");
    mkdirSync(codexSessionDir, { recursive: true });
    mkdirSync(claudeSessionMetaDir, { recursive: true });

    writeFileSync(
      join(codexSessionDir, "rollout-1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-04-17T10:00:00.000Z",
          type: "event_msg",
          payload: {
            info: {
              total_token_usage: {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 4,
                reasoning_output_tokens: 1,
                total_tokens: 17,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-17T10:05:00.000Z",
          type: "event_msg",
          payload: {
            info: {
              total_token_usage: {
                input_tokens: 20,
                cached_input_tokens: 5,
                output_tokens: 7,
                reasoning_output_tokens: 3,
                total_tokens: 35,
              },
            },
          },
        }),
      ].join("\n"),
    );

    writeFileSync(
      join(claudeSessionMetaDir, "claude-1.json"),
      JSON.stringify({
        session_id: "claude-1",
        start_time: "2026-04-17T11:00:00.000Z",
        input_tokens: 100,
        output_tokens: 40,
        duration_minutes: 12,
      }),
    );

    const summary = await readLocalUsageSummary({
      codexHome,
      claudeUsageDataDir,
      since: new Date("2026-04-17T00:00:00.000Z"),
    });

    expect(summary.providers).toEqual([
      {
        provider: "codex",
        source: "local-files",
        filesScanned: 1,
        sessions: 1,
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 7,
        reasoningOutputTokens: 3,
        totalTokens: 35,
      },
      {
        provider: "claudeAgent",
        source: "local-files",
        filesScanned: 1,
        sessions: 1,
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 40,
        reasoningOutputTokens: 0,
        totalTokens: 140,
      },
    ]);
  });

  it("formats local usage totals for CLI comparison", () => {
    expect(
      formatLocalUsageSummary({
        generatedAt: "2026-04-17T12:00:00.000Z",
        since: "2026-04-10T12:00:00.000Z",
        providers: [
          {
            provider: "codex",
            source: "local-files",
            filesScanned: 12,
            sessions: 3,
            inputTokens: 1200,
            cachedInputTokens: 300,
            outputTokens: 400,
            reasoningOutputTokens: 100,
            totalTokens: 2000,
          },
        ],
      }),
    ).toContain("Local Usage Comparison");
  });
});
