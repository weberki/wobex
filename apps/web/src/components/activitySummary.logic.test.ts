import type { GitStatusResult } from "@wobex/contracts";
import { describe, expect, it } from "vitest";

import type { ActivePlanState, WorkLogEntry } from "../session-logic";
import { deriveActivitySummaryModel, hasActivitySummarySignals } from "./activitySummary.logic";

const ACTIVE_PLAN: ActivePlanState = {
  createdAt: "2026-05-08T10:00:00.000Z",
  turnId: null,
  steps: [
    { step: "Runtime-log Ursache isolieren", status: "completed" },
    { step: "Background agents darstellen", status: "inProgress" },
    { step: "Sources normalisieren", status: "pending" },
  ],
};

const GIT_STATUS: GitStatusResult = {
  isRepo: true,
  hasOriginRemote: true,
  hostingProvider: {
    kind: "github",
    name: "GitHub",
    baseUrl: "https://github.com",
  },
  isDefaultBranch: false,
  branch: "codex/activity-panel",
  hasWorkingTreeChanges: true,
  workingTree: {
    files: [
      { path: "apps/web/src/components/ActivitySummaryPanel.tsx", insertions: 100, deletions: 20 },
      { path: "apps/web/src/components/activitySummary.logic.ts", insertions: 16, deletions: 56 },
    ],
    insertions: 116,
    deletions: 76,
  },
  hasUpstream: true,
  aheadCount: 1,
  behindCount: 0,
  pr: null,
};

function workEntry(input: Partial<WorkLogEntry> & Pick<WorkLogEntry, "id">): WorkLogEntry {
  return {
    createdAt: "2026-05-08T10:00:00.000Z",
    activityKind: "tool.updated",
    label: "Tool",
    tone: "tool",
    ...input,
  };
}

describe("deriveActivitySummaryModel", () => {
  it("builds Codex-style progress and branch summaries from active plan and git status", () => {
    const model = deriveActivitySummaryModel({
      activePlan: ACTIVE_PLAN,
      activeProposedPlan: null,
      workLogEntries: [],
      gitStatus: GIT_STATUS,
      gitStatusPending: false,
    });

    expect(model.progress.items).toEqual([
      {
        id: "0:Runtime-log Ursache isolieren",
        label: "Runtime-log Ursache isolieren",
        status: "completed",
      },
      {
        id: "1:Background agents darstellen",
        label: "Background agents darstellen",
        status: "inProgress",
      },
      { id: "2:Sources normalisieren", label: "Sources normalisieren", status: "pending" },
    ]);
    expect(model.branchDetails.branchLabel).toBe("codex/activity-panel");
    expect(model.branchDetails.changesLabel).toBe("+116 -76");
    expect(model.branchDetails.changesDetail).toBe("2 files changed");
    expect(model.branchDetails.gitActionsLabel).toBe("1 ahead");
    expect(model.branchDetails.pullRequestLabel).toBe("Pull request status unavailable");
  });

  it("extracts background agents from collaboration tool payloads", () => {
    const model = deriveActivitySummaryModel({
      activePlan: null,
      activeProposedPlan: null,
      gitStatus: null,
      gitStatusPending: false,
      workLogEntries: [
        workEntry({
          id: "agents",
          itemType: "collab_agent_tool_call",
          payload: {
            data: {
              item: {
                agentsStates: {
                  "thread-agent-1": {
                    nickname: "Aristotle",
                    agent_type: "explorer",
                    status: "running",
                    message: "Inspecting app-server events",
                  },
                  "thread-agent-2": {
                    agentType: "worker",
                    status: "completed",
                    message: "Implemented derivation tests",
                  },
                },
              },
            },
          },
        }),
      ],
    });

    expect(model.backgroundAgents).toEqual([
      {
        id: "thread-agent-1",
        label: "Aristotle",
        role: "explorer",
        status: "running",
        message: "Inspecting app-server events",
      },
      {
        id: "thread-agent-2",
        label: "worker",
        role: "worker",
        status: "completed",
        message: "Implemented derivation tests",
      },
    ]);
  });

  it("summarizes web-search source activity without requiring structured citations", () => {
    const model = deriveActivitySummaryModel({
      activePlan: null,
      activeProposedPlan: null,
      gitStatus: null,
      gitStatusPending: false,
      workLogEntries: [
        workEntry({
          id: "search-1",
          itemType: "web_search",
          label: "Web search",
          detail: "openai codex app-server progress events",
        }),
        workEntry({
          id: "search-2",
          itemType: "mcp_tool_call",
          toolTitle: "Fetch docs",
          detail: "developers.openai.com",
        }),
      ],
    });

    expect(model.sources).toEqual([
      {
        id: "search-1",
        label: "Web search",
        detail: "openai codex app-server progress events",
      },
    ]);
  });

  it("detects when the compact activity panel has useful signal", () => {
    expect(
      hasActivitySummarySignals({
        activePlan: null,
        activeProposedPlan: null,
        workLogEntries: [],
        gitStatus: {
          ...GIT_STATUS,
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
          pr: null,
        },
      }),
    ).toBe(false);

    expect(
      hasActivitySummarySignals({
        activePlan: null,
        activeProposedPlan: null,
        workLogEntries: [workEntry({ id: "agent", itemType: "collab_agent_tool_call" })],
        gitStatus: null,
      }),
    ).toBe(true);
  });
});
