import { describe, expect, it } from "vitest";

import {
  calculateUsagePace,
  formatProviderUsageResult,
  formatProviderUsageResults,
} from "./usageCli";

describe("usageCli", () => {
  it("formats Claude tmux usage windows with green terminal bars", () => {
    const formatted = formatProviderUsageResult({
      provider: "claudeAgent",
      refreshedAt: "2026-04-17T20:00:00.000Z",
      cached: false,
      available: true,
      rateLimits: {
        windows: [
          {
            label: "Claude 5h",
            usedPercent: 32,
            remainingPercent: 68,
            resetsAt: null,
            resetLabel: "10pm (Europe/Berlin)",
            source: "tmux",
          },
        ],
      },
    });

    expect(formatted).toContain("Claude 5h");
    expect(formatted).toContain("Loading source tmux");
    expect(formatted).toContain("\u001b[32m");
  });

  it("formats Codex app-server usage windows with blue terminal bars and pace", () => {
    const formatted = formatProviderUsageResult(
      {
        provider: "codex",
        refreshedAt: "2026-04-17T12:00:00.000Z",
        cached: false,
        available: true,
        rateLimits: {
          windows: [
            {
              label: "Codex 5h",
              usedPercent: 16,
              remainingPercent: 84,
              resetsAt: "2026-04-17T21:24:45.000Z",
              source: "app-server",
              kind: "session",
              windowMinutes: 300,
            },
            {
              label: "Codex weekly",
              usedPercent: 20,
              remainingPercent: 80,
              resetsAt: "2026-04-21T12:00:00.000Z",
              source: "app-server",
              kind: "weekly",
              windowMinutes: 10080,
            },
          ],
        },
      },
      { now: new Date("2026-04-17T12:00:00.000Z") },
    );

    expect(formatted).toContain("Codex Usage");
    expect(formatted).toContain("Codex 5h");
    expect(formatted).toContain("████");
    expect(formatted).toContain("Pace");
    expect(formatted).toContain("reserve");
    expect(formatted).toContain("\u001b[34m");
  });

  it("formats multiple provider usage results in one terminal view", () => {
    const formatted = formatProviderUsageResults(
      [
        {
          provider: "claudeAgent",
          refreshedAt: "2026-04-17T20:00:00.000Z",
          cached: false,
          available: true,
          rateLimits: {
            windows: [
              {
                label: "Claude weekly",
                usedPercent: 9,
                remainingPercent: 91,
                resetsAt: null,
                resetLabel: "Apr 23",
                source: "tmux",
                kind: "weekly",
              },
            ],
          },
        },
        {
          provider: "codex",
          refreshedAt: "2026-04-17T20:00:00.000Z",
          cached: false,
          available: false,
          error: "Codex unavailable",
          rateLimits: { windows: [] },
        },
      ],
      { now: new Date("2026-04-17T20:00:00.000Z") },
    );

    expect(formatted).toContain("Claude Usage");
    expect(formatted).toContain("Codex usage unavailable: Codex unavailable");
  });

  it("calculates linear weekly pace against the reset timestamp", () => {
    expect(
      calculateUsagePace(
        {
          label: "Codex weekly",
          usedPercent: 20,
          remainingPercent: 80,
          resetsAt: "2026-04-21T12:00:00.000Z",
          source: "app-server",
          kind: "weekly",
          windowMinutes: 10080,
        },
        new Date("2026-04-17T12:00:00.000Z"),
      ),
    ).toMatchObject({
      status: "reserve",
      deltaPercent: -22.86,
      expectedUsedPercent: 42.86,
      lastsUntilReset: true,
    });
  });
});
