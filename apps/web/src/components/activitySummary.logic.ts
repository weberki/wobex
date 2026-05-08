import type { GitStatusResult } from "@wobex/contracts";

import type { ActivePlanState, LatestProposedPlanState, WorkLogEntry } from "../session-logic";

export interface ActivitySummaryProgressItem {
  id: string;
  label: string;
  status: "pending" | "inProgress" | "completed";
}

export interface ActivitySummaryBranchDetails {
  branchLabel: string;
  changesLabel: string;
  changesDetail: string;
  gitActionsLabel: string;
  pullRequestLabel: string;
  pullRequestUrl: string | null;
}

export interface ActivitySummaryBackgroundAgent {
  id: string;
  label: string;
  role: string | null;
  status: string;
  message: string | null;
}

export interface ActivitySummarySource {
  id: string;
  label: string;
  detail: string | null;
}

export interface ActivitySummaryModel {
  progress: {
    items: ActivitySummaryProgressItem[];
  };
  branchDetails: ActivitySummaryBranchDetails;
  backgroundAgents: ActivitySummaryBackgroundAgent[];
  sources: ActivitySummarySource[];
}

export function deriveActivitySummaryModel(input: {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  gitStatus: GitStatusResult | null;
  gitStatusPending: boolean;
}): ActivitySummaryModel {
  return {
    progress: {
      items: deriveProgressItems(input.activePlan, input.activeProposedPlan),
    },
    branchDetails: deriveBranchDetails(input.gitStatus, input.gitStatusPending),
    backgroundAgents: deriveBackgroundAgents(input.workLogEntries),
    sources: deriveSources(input.workLogEntries),
  };
}

export function hasActivitySummarySignals(input: {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  workLogEntries: ReadonlyArray<WorkLogEntry>;
  gitStatus: GitStatusResult | null;
}): boolean {
  if (input.activePlan || input.activeProposedPlan) {
    return true;
  }
  if (input.gitStatus?.hasWorkingTreeChanges || input.gitStatus?.pr) {
    return true;
  }
  return input.workLogEntries.some(
    (entry) => entry.itemType === "collab_agent_tool_call" || entry.itemType === "web_search",
  );
}

function deriveProgressItems(
  activePlan: ActivePlanState | null,
  activeProposedPlan: LatestProposedPlanState | null,
): ActivitySummaryProgressItem[] {
  if (activePlan?.steps.length) {
    return activePlan.steps.map((step, index) => ({
      id: `${index}:${step.step}`,
      label: step.step,
      status: step.status,
    }));
  }

  if (activeProposedPlan) {
    return [
      {
        id: `proposed-plan:${activeProposedPlan.id}`,
        label: activeProposedPlan.implementedAt ? "Plan implemented" : "Plan ready",
        status: "completed",
      },
    ];
  }

  return [];
}

function deriveBranchDetails(
  gitStatus: GitStatusResult | null,
  gitStatusPending: boolean,
): ActivitySummaryBranchDetails {
  if (!gitStatus) {
    const label = gitStatusPending ? "Loading" : "Unavailable";
    return {
      branchLabel: label,
      changesLabel: label,
      changesDetail: "Git status unavailable",
      gitActionsLabel: label,
      pullRequestLabel: "Pull request status unavailable",
      pullRequestUrl: null,
    };
  }

  if (!gitStatus.isRepo) {
    return {
      branchLabel: "No Git repository",
      changesLabel: "Unavailable",
      changesDetail: "Git actions require a repository",
      gitActionsLabel: "Unavailable",
      pullRequestLabel: "Pull request status unavailable",
      pullRequestUrl: null,
    };
  }

  const fileCount = gitStatus.workingTree.files.length;
  return {
    branchLabel: gitStatus.branch ?? "Detached",
    changesLabel:
      gitStatus.hasWorkingTreeChanges ||
      gitStatus.workingTree.insertions > 0 ||
      gitStatus.workingTree.deletions > 0
        ? `+${gitStatus.workingTree.insertions} -${gitStatus.workingTree.deletions}`
        : "No changes",
    changesDetail:
      fileCount > 0
        ? `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`
        : "Working tree clean",
    gitActionsLabel: deriveGitActionsLabel(gitStatus),
    pullRequestLabel: gitStatus.pr
      ? `#${gitStatus.pr.number} ${gitStatus.pr.state}`
      : "Pull request status unavailable",
    pullRequestUrl: gitStatus.pr?.url ?? null,
  };
}

function deriveGitActionsLabel(gitStatus: GitStatusResult): string {
  if (gitStatus.aheadCount > 0 && gitStatus.behindCount > 0) {
    return `${gitStatus.aheadCount} ahead, ${gitStatus.behindCount} behind`;
  }
  if (gitStatus.aheadCount > 0) {
    return `${gitStatus.aheadCount} ahead`;
  }
  if (gitStatus.behindCount > 0) {
    return `${gitStatus.behindCount} behind`;
  }
  if (gitStatus.hasWorkingTreeChanges) {
    return "Ready";
  }
  if (gitStatus.hasUpstream) {
    return "Up to date";
  }
  return gitStatus.hasOriginRemote ? "No upstream" : "Local only";
}

function deriveBackgroundAgents(
  workLogEntries: ReadonlyArray<WorkLogEntry>,
): ActivitySummaryBackgroundAgent[] {
  const agents = new Map<string, ActivitySummaryBackgroundAgent>();

  for (const entry of workLogEntries) {
    if (entry.itemType !== "collab_agent_tool_call") {
      continue;
    }

    const states = readAgentStates(entry.payload);
    if (!states) {
      continue;
    }

    for (const [id, state] of Object.entries(states)) {
      const record = asRecord(state);
      if (!record) {
        continue;
      }
      const role = firstString(record, ["role", "agent_type", "agentType", "type"]);
      const label = firstString(record, ["nickname", "name", "label"]) ?? role ?? shortAgentId(id);
      const status = firstString(record, ["status"]) ?? "unknown";
      agents.set(id, {
        id,
        label,
        role: role ?? null,
        status,
        message: firstString(record, ["message", "summary", "detail"]) ?? null,
      });
    }
  }

  return [...agents.values()];
}

function deriveSources(workLogEntries: ReadonlyArray<WorkLogEntry>): ActivitySummarySource[] {
  return workLogEntries.flatMap((entry) => {
    if (entry.itemType !== "web_search") {
      return [];
    }
    return [
      {
        id: entry.id,
        label: entry.toolTitle ?? entry.label,
        detail: entry.detail ?? null,
      },
    ];
  });
}

function readAgentStates(payload: WorkLogEntry["payload"]): Record<string, unknown> | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const item = asRecord(data?.item) ?? asRecord(root?.item);
  return (
    asRecord(item?.agentsStates) ?? asRecord(data?.agentsStates) ?? asRecord(root?.agentsStates)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function shortAgentId(id: string): string {
  const normalized = id.trim();
  if (normalized.length <= 12) {
    return normalized;
  }
  return normalized.slice(0, 12);
}
