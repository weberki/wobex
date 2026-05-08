import { describe, expect, it } from "vitest";

import { parseCodexRateLimitsResult, refreshCodexUsage } from "./codexUsageProbe";

describe("codexUsageProbe", () => {
  it("parses Codex app-server rate limit windows", () => {
    const windows = parseCodexRateLimitsResult({
      rateLimits: {
        limitId: "codex",
        limitName: null,
        primary: {
          usedPercent: 27,
          windowDurationMins: 300,
          resetsAt: 1776461085,
        },
        secondary: {
          usedPercent: 11,
          windowDurationMins: 10080,
          resetsAt: 1776967257,
        },
      },
      rateLimitsByLimitId: {
        codex_bengalfox: {
          limitId: "codex_bengalfox",
          limitName: "GPT-5.3-Codex-Spark",
          primary: {
            usedPercent: 2,
            windowDurationMins: 300,
            resetsAt: 1776470424,
          },
          secondary: {
            usedPercent: 1,
            windowDurationMins: 10080,
            resetsAt: 1777057224,
          },
        },
      },
    });

    expect(windows).toEqual([
      {
        label: "Codex 5h",
        usedPercent: 27,
        remainingPercent: 73,
        resetsAt: "2026-04-17T21:24:45.000Z",
        source: "app-server",
        kind: "session",
        windowMinutes: 300,
      },
      {
        label: "Codex weekly",
        usedPercent: 11,
        remainingPercent: 89,
        resetsAt: "2026-04-23T18:00:57.000Z",
        source: "app-server",
        kind: "weekly",
        windowMinutes: 10080,
      },
      {
        label: "GPT-5.3-Codex-Spark 5h",
        usedPercent: 2,
        remainingPercent: 98,
        resetsAt: "2026-04-18T00:00:24.000Z",
        source: "app-server",
        kind: "session",
        windowMinutes: 300,
      },
      {
        label: "GPT-5.3-Codex-Spark weekly",
        usedPercent: 1,
        remainingPercent: 99,
        resetsAt: "2026-04-24T19:00:24.000Z",
        source: "app-server",
        kind: "weekly",
        windowMinutes: 10080,
      },
    ]);
  });

  it("kills the Codex app-server process when usage read fails", async () => {
    let killed = false;
    const result = await refreshCodexUsage({
      provider: "codex",
      force: true,
      runAppServerRequest: async () => {
        killed = true;
        throw new Error("account/rateLimits/read failed: nope");
      },
    });

    expect(result.available).toBe(false);
    expect(result.error).toBe("account/rateLimits/read failed: nope");
    expect(killed).toBe(true);
  });
});
