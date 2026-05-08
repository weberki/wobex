import { describe, expect, it } from "vitest";
import {
  formatUsagePaceDisplay,
  formatUsagePercent,
  getUsageRemainingPercent,
  selectPrimaryUsageWindow,
} from "./providerUsageDisplay";
import type { RateLimitSnapshot, RateLimitWindow } from "./rateLimits";

const baseWindow: RateLimitWindow = {
  label: "Codex weekly",
  usedPercent: 14,
  remainingPercent: 86,
  resetsAt: "2026-04-23T18:00:57.000Z",
  resetLabel: null,
  status: null,
  kind: "weekly",
  source: "app-server",
  used: null,
  limit: null,
  remaining: null,
  windowDurationMins: 10_080,
  limitId: null,
  limitName: null,
};

describe("providerUsageDisplay", () => {
  it("selects the 5h/session window as the header primary", () => {
    const snapshot: RateLimitSnapshot = {
      updatedAt: "2026-04-17T21:30:52.159Z",
      overallStatus: null,
      windows: [
        baseWindow,
        {
          ...baseWindow,
          label: "Codex 5h",
          usedPercent: 0,
          remainingPercent: 100,
          kind: "session",
          windowDurationMins: 300,
        },
      ],
    };

    expect(selectPrimaryUsageWindow(snapshot)?.label).toBe("Codex 5h");
  });

  it("formats remaining percentages from used percentages", () => {
    expect(
      getUsageRemainingPercent({ ...baseWindow, remainingPercent: null, usedPercent: 2 }),
    ).toBe(98);
    expect(formatUsagePercent(2.4)).toBe("2.4%");
    expect(formatUsagePercent(86)).toBe("86%");
  });

  it("matches CLI pace wording for weekly reserve", () => {
    expect(
      formatUsagePaceDisplay(baseWindow, new Date("2026-04-17T21:30:52.159Z"))?.text,
    ).toContain("2.4% reserve vs linear plan");
  });
});
