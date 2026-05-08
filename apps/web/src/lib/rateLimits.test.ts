import { describe, expect, it } from "vitest";
import { EventId } from "@wobex/contracts";
import {
  deriveRateLimitSnapshotFromRateLimits,
  deriveLatestRateLimitSnapshot,
  deriveLatestRateLimitStatus,
  formatRateLimitResetTime,
} from "./rateLimits";

const asEventId = (value: string): EventId => EventId.make(value);

describe("rateLimits", () => {
  it("derives warning status from structured windows", () => {
    const status = deriveLatestRateLimitStatus([
      {
        id: asEventId("activity-1"),
        createdAt: "2026-04-10T10:00:00.000Z",
        tone: "info",
        kind: "account.rate-limits.updated",
        summary: "Rate limits updated",
        payload: {
          rateLimits: {
            daily: {
              used: 92,
              limit: 100,
              resetsAt: "2099-04-10T11:00:00.000Z",
            },
          },
        },
        turnId: null,
      },
    ]);

    expect(status).toMatchObject({
      status: "allowed_warning",
      label: "daily",
    });
  });

  it("derives rejection status from explicit flags", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      {
        id: asEventId("activity-2"),
        createdAt: "2026-04-10T10:00:00.000Z",
        tone: "info",
        kind: "account.rate-limits.updated",
        summary: "Rate limits updated",
        payload: {
          rateLimits: {
            request: {
              status: "rejected",
              retryAt: "2099-04-10T10:05:00.000Z",
            },
          },
        },
        turnId: null,
      },
    ]);

    expect(snapshot?.overallStatus).toBe("rejected");
    expect(snapshot?.windows[0]?.status).toBe("rejected");
  });

  it("labels Codex app-server 5h and weekly rate limit windows", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      {
        id: asEventId("activity-codex-limits"),
        createdAt: "2026-04-10T10:00:00.000Z",
        tone: "info",
        kind: "account.rate-limits.updated",
        summary: "Rate limits updated",
        payload: {
          rateLimits: {
            rateLimits: {
              limitId: "codex",
              limitName: null,
              primary: {
                usedPercent: 16,
                windowDurationMins: 300,
                resetsAt: 1776461085,
              },
              secondary: {
                usedPercent: 9,
                windowDurationMins: 10080,
                resetsAt: 1776967257,
              },
              planType: "pro",
            },
          },
        },
        turnId: null,
      },
    ]);

    expect(snapshot?.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Codex weekly",
          usedPercent: 9,
          remainingPercent: 91,
          resetsAt: "2026-04-23T18:00:57.000Z",
          windowDurationMins: 10080,
        }),
        expect.objectContaining({
          label: "Codex 5h",
          usedPercent: 16,
          remainingPercent: 84,
          resetsAt: "2026-04-17T21:24:45.000Z",
          windowDurationMins: 300,
        }),
      ]),
    );
  });

  it("keeps Claude tmux reset labels and remaining percentages", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      {
        id: asEventId("activity-claude-limits"),
        createdAt: "2026-04-10T10:00:00.000Z",
        tone: "info",
        kind: "account.rate-limits.updated",
        summary: "Rate limits updated",
        payload: {
          rateLimits: {
            windows: [
              {
                label: "Claude 5h",
                usedPercent: 30,
                remainingPercent: 70,
                resetLabel: "10pm (Europe/Berlin)",
                source: "tmux",
              },
            ],
          },
        },
        turnId: null,
      },
    ]);

    expect(snapshot?.windows[0]).toEqual(
      expect.objectContaining({
        label: "Claude 5h",
        usedPercent: 30,
        remainingPercent: 70,
        resetLabel: "10pm (Europe/Berlin)",
      }),
    );
  });

  it("keeps provider usage refresh metadata from normalized server windows", () => {
    const snapshot = deriveRateLimitSnapshotFromRateLimits(
      {
        windows: [
          {
            label: "Codex weekly",
            usedPercent: 14,
            remainingPercent: 86,
            resetsAt: "2026-04-23T18:00:57.000Z",
            kind: "weekly",
            windowMinutes: 10080,
            source: "app-server",
          },
        ],
      },
      "2026-04-17T21:30:52.159Z",
    );

    expect(snapshot?.windows[0]).toEqual(
      expect.objectContaining({
        label: "Codex weekly",
        usedPercent: 14,
        remainingPercent: 86,
        resetsAt: "2026-04-23T18:00:57.000Z",
        kind: "weekly",
        windowDurationMins: 10080,
        source: "app-server",
      }),
    );
  });

  it("formats reset times into human text", () => {
    expect(formatRateLimitResetTime("2099-04-10T10:05:00.000Z")).toBeTypeOf("string");
  });
});
