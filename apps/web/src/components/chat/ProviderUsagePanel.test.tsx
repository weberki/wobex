import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderUsagePanel } from "./ProviderUsagePanel";

describe("ProviderUsagePanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders provider windows with remaining usage and pace", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T21:30:52.159Z"));

    const markup = renderToStaticMarkup(
      <ProviderUsagePanel
        provider="codex"
        snapshot={{
          updatedAt: "2026-04-17T21:30:52.159Z",
          overallStatus: null,
          windows: [
            {
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
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Codex weekly");
    expect(markup).toContain("86% remaining");
    expect(markup).toContain("Pace");
    expect(markup).toContain("app-server");
  });

  it("renders a loading state before usage is available", () => {
    const markup = renderToStaticMarkup(
      <ProviderUsagePanel provider="claudeAgent" snapshot={null} refreshing />,
    );

    expect(markup).toContain("Loading Usage");
  });
});
