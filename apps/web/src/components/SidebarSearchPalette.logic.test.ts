import { describe, expect, it } from "vitest";
import { scopeProjectRef, scopeThreadRef } from "@wobex/client-runtime";
import { EnvironmentId, ProjectId, ThreadId } from "@wobex/contracts";
import {
  matchSidebarSearchActions,
  matchSidebarSearchProjects,
  matchSidebarSearchThreads,
  type SidebarSearchAction,
  type SidebarSearchProject,
  type SidebarSearchThread,
} from "./SidebarSearchPalette.logic";

const asEnvironmentId = (value: string): EnvironmentId => EnvironmentId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

describe("SidebarSearchPalette.logic", () => {
  const actions: SidebarSearchAction[] = [
    {
      id: "settings",
      label: "Settings",
      description: "Open application settings",
      keywords: ["preferences"],
    },
  ];
  const projects: SidebarSearchProject[] = [
    {
      id: "project:1",
      ref: scopeProjectRef(asEnvironmentId("env-1"), asProjectId("project-1")),
      name: "Wobex",
      cwd: "/workspace/Wobex",
      updatedAt: "2026-04-10T10:00:00.000Z",
    },
  ];
  const threads: SidebarSearchThread[] = [
    {
      id: "thread:1",
      ref: scopeThreadRef(asEnvironmentId("env-1"), asThreadId("thread-1")),
      title: "Implement session status dialog",
      projectId: "project:1",
      projectName: "Wobex",
      provider: "codex",
      createdAt: "2026-04-10T09:00:00.000Z",
      updatedAt: "2026-04-10T10:00:00.000Z",
      messages: [{ text: "Show the latest model and rate limit status." }],
    },
  ];

  it("matches actions by keyword", () => {
    expect(matchSidebarSearchActions(actions, "preferences")).toHaveLength(1);
  });

  it("matches projects by folder path", () => {
    expect(matchSidebarSearchProjects(projects, "Wobex")[0]?.project.id).toBe("project:1");
  });

  it("prefers thread title matches over message matches", () => {
    const result = matchSidebarSearchThreads(threads, "session");
    expect(result[0]?.matchKind).toBe("title");
  });

  it("returns message snippets for content matches", () => {
    const result = matchSidebarSearchThreads(threads, "rate limit");
    expect(result[0]?.matchKind).toBe("message");
    expect(result[0]?.snippet).toContain("rate limit");
  });
});
