import type { GitStatusRemoteResult, GitStatusResult } from "@wobex/contracts";
import { describe, expect, it } from "vitest";

import {
  applyGitStatusStreamEvent,
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
} from "./git";

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:weberki/wobex.git")).toBe(
      "github.com/weberki/wobex",
    );
    expect(normalizeGitRemoteUrl("https://github.com/weberki/wobex.git")).toBe(
      "github.com/weberki/wobex",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/weberki/wobex")).toBe(
      "github.com/weberki/wobex",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:weberki/platform/wobex.git")).toBe(
      "gitlab.com/weberki/platform/wobex",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/weberki/platform/wobex.git")).toBe(
      "gitlab.com/weberki/platform/wobex",
    );
  });

  it("drops explicit ports from URL-shaped remotes", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
  });
});

describe("parseGitHubRepositoryNameWithOwnerFromRemoteUrl", () => {
  it("extracts the owner and repository from common GitHub remote shapes", () => {
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("git@github.com:weberki/wobex.git"),
    ).toBe("weberki/wobex");
    expect(
      parseGitHubRepositoryNameWithOwnerFromRemoteUrl("https://github.com/weberki/wobex.git"),
    ).toBe("weberki/wobex");
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: GitStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasOriginRemote: false,
      isDefaultBranch: false,
      branch: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: GitStatusResult = {
      isRepo: true,
      hostingProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasOriginRemote: true,
      isDefaultBranch: false,
      branch: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: GitStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
