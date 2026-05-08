import { assert, describe, it } from "vitest";

import { getVscodeIconUrlForEntry } from "./vscode-icons";

describe("getVscodeIconUrlForEntry", () => {
  it("uses exact filename matches from the vscode-icons manifest", () => {
    const darkUrl = getVscodeIconUrlForEntry("pnpm-workspace.yaml", "file", "dark");
    const lightUrl = getVscodeIconUrlForEntry("pnpm-workspace.yaml", "file", "light");

    assert.isTrue(darkUrl.endsWith("/pnpm.svg"));
    assert.isTrue(lightUrl.endsWith("/pnpm_light.svg"));
  });

  it("uses longest extension match for compound extensions", () => {
    const iconUrl = getVscodeIconUrlForEntry("tsconfig.tsbuildinfo", "file", "dark");
    const manifestStyleUrl = getVscodeIconUrlForEntry("buf.yaml", "file", "dark");
    assert.isTrue(iconUrl.endsWith("/typescript-def.svg"));
    assert.isTrue(manifestStyleUrl.endsWith("/file.svg"));
  });

  it("uses folder mappings, expanded folders, and root folder icons", () => {
    const folderUrl = getVscodeIconUrlForEntry("packages/src", "directory", "light");
    const expandedFolderUrl = getVscodeIconUrlForEntry("packages/src", "directory", "light", {
      expanded: true,
    });
    const rootFolderUrl = getVscodeIconUrlForEntry("/tmp/project", "directory", "dark", {
      root: true,
    });
    const rootFolderExpandedUrl = getVscodeIconUrlForEntry("/tmp/project", "directory", "dark", {
      root: true,
      expanded: true,
    });

    assert.isTrue(folderUrl.endsWith("/folder-src.svg"));
    assert.isTrue(expandedFolderUrl.endsWith("/folder-src-open.svg"));
    assert.isTrue(rootFolderUrl.endsWith("/folder-root.svg"));
    assert.isTrue(rootFolderExpandedUrl.endsWith("/folder-root-open.svg"));
  });

  it("falls back to language-based mappings for path-only cases", () => {
    const tsxUrl = getVscodeIconUrlForEntry("checkbox.tsx", "file", "light");
    const dockerfileUrl = getVscodeIconUrlForEntry("Dockerfile", "file", "dark");
    const shellUrl = getVscodeIconUrlForEntry("entrypoint.sh", "file", "dark");
    const htmlUrl = getVscodeIconUrlForEntry("index.html", "file", "dark");
    const cursorRulesUrl = getVscodeIconUrlForEntry("general.mdc", "file", "dark");
    const githubWorkflowUrl = getVscodeIconUrlForEntry(".github/workflows/ci.yml", "file", "light");

    assert.isTrue(tsxUrl.endsWith("/react_ts.svg"));
    assert.isTrue(dockerfileUrl.endsWith("/docker.svg"));
    assert.isTrue(shellUrl.endsWith("/console.svg"));
    assert.isTrue(htmlUrl.endsWith("/html.svg"));
    assert.isTrue(cursorRulesUrl.endsWith("/markdown.svg"));
    assert.isTrue(githubWorkflowUrl.endsWith("/yaml.svg"));
  });

  it("uses local overrides for agent files and falls back to defaults when there is no match", () => {
    const agentsUrl = getVscodeIconUrlForEntry("AGENTS.md", "file", "dark");
    const fileUrl = getVscodeIconUrlForEntry("foo.unknown-ext", "file", "dark");
    const folderUrl = getVscodeIconUrlForEntry("totally-unknown-folder", "directory", "dark");

    assert.isTrue(agentsUrl.endsWith("/instructions.clone.svg"));
    assert.isTrue(fileUrl.endsWith("/file.svg"));
    assert.isTrue(folderUrl.endsWith("/folder.svg"));
  });
});
