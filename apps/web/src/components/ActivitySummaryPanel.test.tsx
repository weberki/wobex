import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ActivitySummaryModel } from "./activitySummary.logic";
import { ActivitySummaryPanel } from "./ActivitySummaryPanel";

const MODEL: ActivitySummaryModel = {
  progress: {
    items: [
      { id: "step-1", label: "Runtime-log Ursache isolieren", status: "completed" },
      { id: "step-2", label: "Background agents darstellen", status: "inProgress" },
    ],
  },
  branchDetails: {
    branchLabel: "codex/activity-panel",
    changesLabel: "+116 -76",
    changesDetail: "2 files changed",
    gitActionsLabel: "1 ahead",
    pullRequestLabel: "Pull request status unavailable",
    pullRequestUrl: null,
  },
  backgroundAgents: [
    {
      id: "thread-agent-1",
      label: "Aristotle",
      role: "explorer",
      status: "running",
      message: "Inspecting app-server events",
    },
  ],
  sources: [
    {
      id: "search-1",
      label: "Web search",
      detail: "openai codex app-server progress events",
    },
  ],
};

describe("ActivitySummaryPanel", () => {
  it("renders progress, branch details, background agents, and sources", () => {
    const html = renderToStaticMarkup(<ActivitySummaryPanel model={MODEL} />);

    expect(html).toContain("Progress");
    expect(html).toContain("Runtime-log Ursache isolieren");
    expect(html).toContain("Branch details");
    expect(html).toContain("+116");
    expect(html).toContain("-76");
    expect(html).toContain("Background agents");
    expect(html).toContain("Aristotle");
    expect(html).toContain("Sources");
    expect(html).toContain("Web search");
  });
});
