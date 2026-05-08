import {
  type DevServerSnapshot,
  EnvironmentId,
  ProjectId,
  type ProjectScript,
} from "@wobex/contracts";
import { describe, expect, it } from "vitest";

import type { Project } from "../types";
import { resolveDevServerSidebarItems } from "./Sidebar.devServers.logic";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-local");

function script(input: Partial<ProjectScript> & Pick<ProjectScript, "id" | "name">): ProjectScript {
  return {
    command: "bun dev",
    icon: "play",
    runOnWorktreeCreate: false,
    ...input,
  };
}

function project(scripts: ProjectScript[]): Project {
  return {
    id: projectId,
    environmentId,
    name: "Project",
    cwd: "/repo",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts,
  };
}

const emptySnapshot: DevServerSnapshot = {
  recordedAt: "2026-01-01T00:00:00.000Z",
  supported: true,
  listeners: [],
  externalDevServers: [],
  managedDevServers: [],
};

describe("resolveDevServerSidebarItems", () => {
  it("exposes only dev-server scripts as start candidates", () => {
    const items = resolveDevServerSidebarItems({
      environmentId,
      projects: [
        project([
          script({ id: "dev", name: "Dev", role: "dev-server" }),
          script({ id: "lint", name: "Lint" }),
        ]),
      ],
      snapshot: emptySnapshot,
    });

    expect(items.candidates.map((item) => item.script.id)).toEqual(["dev"]);
    expect(items.candidates[0]?.action).toBe("start");
  });

  it("hides start candidates that already have an active managed server", () => {
    const items = resolveDevServerSidebarItems({
      environmentId,
      projects: [project([script({ id: "dev", name: "Dev", role: "dev-server" })])],
      snapshot: {
        ...emptySnapshot,
        managedDevServers: [
          {
            id: "dev-server-1",
            projectId,
            projectTitle: "Project",
            scriptId: "dev",
            scriptName: "Dev",
            command: "bun dev",
            cwd: "/repo",
            worktreePath: null,
            pid: 123,
            port: 5173,
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            exitCode: null,
            exitSignal: null,
          },
        ],
      },
    });

    expect(items.candidates).toHaveLength(0);
    expect(items.managed[0]?.action).toBe("stop");
  });

  it("keeps external occupied ports read-only", () => {
    const items = resolveDevServerSidebarItems({
      environmentId,
      projects: [],
      snapshot: {
        ...emptySnapshot,
        externalDevServers: [
          {
            id: "external-123-5173",
            pid: 123,
            label: "vite",
            command: "node vite",
            port: 5173,
            workspacePath: "/repo",
            status: "running",
          },
        ],
      },
    });

    expect(items.external[0]?.action).toBe("readonly");
  });
});
