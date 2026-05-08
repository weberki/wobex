import { describe, expect, it } from "vitest";

import { normalizeWorkspaceRootForComparison, workspaceRootsEqual } from "./threadWorkspace";

describe("threadWorkspace", () => {
  it("normalizes separators and trailing slashes for workspace-root identity", () => {
    expect(normalizeWorkspaceRootForComparison("/tmp//repo/")).toBe("/tmp/repo");
    expect(workspaceRootsEqual("/tmp//repo/", "/tmp/repo")).toBe(true);
  });

  it("normalizes likely Windows roots case-insensitively", () => {
    expect(
      workspaceRootsEqual("C:\\Users\\Dev\\Repo\\", "c:/users/dev/repo", { platform: "win32" }),
    ).toBe(true);
  });
});
