import { describe, expect, it } from "vitest";
import { calculateUsagePace, formatPrecisePercent, formatUsageDuration } from "./providerUsage";

describe("providerUsage", () => {
  it("calculates weekly linear pace with reserve", () => {
    const pace = calculateUsagePace(
      {
        kind: "weekly",
        usedPercent: 14,
        windowMinutes: 10_080,
        resetsAt: "2026-04-23T18:00:57.000Z",
      },
      new Date("2026-04-17T21:30:52.159Z"),
    );

    expect(pace).toMatchObject({
      status: "reserve",
      expectedUsedPercent: 16.37,
      deltaPercent: -2.37,
      lastsUntilReset: true,
      runsOutInMinutes: null,
    });
  });

  it("keeps small deltas on track", () => {
    const pace = calculateUsagePace(
      {
        kind: "weekly",
        usedPercent: 1,
        windowDurationMins: 10_080,
        resetsAt: "2026-04-24T19:00:24.000Z",
      },
      new Date("2026-04-17T21:30:52.159Z"),
    );

    expect(pace?.status).toBe("on-track");
  });

  it("formats compact usage values", () => {
    expect(formatPrecisePercent(2.38)).toBe("2.4%");
    expect(formatUsageDuration(90)).toBe("1.5h");
    expect(formatUsageDuration(10_080)).toBe("7d");
  });
});
