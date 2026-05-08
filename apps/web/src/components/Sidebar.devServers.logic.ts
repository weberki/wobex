import type { DevServerSnapshot, EnvironmentId } from "@wobex/contracts";

import type { Project } from "../types";

export type DevServerSidebarManagedItem = {
  readonly kind: "managed";
  readonly action: "stop" | "readonly";
  readonly server: DevServerSnapshot["managedDevServers"][number];
};

export type DevServerSidebarCandidateItem = {
  readonly kind: "candidate";
  readonly action: "start";
  readonly project: Project;
  readonly script: Project["scripts"][number];
};

export type DevServerSidebarExternalItem = {
  readonly kind: "external";
  readonly action: "readonly";
  readonly server: DevServerSnapshot["externalDevServers"][number];
};

export type DevServerSidebarItems = {
  readonly managed: readonly DevServerSidebarManagedItem[];
  readonly candidates: readonly DevServerSidebarCandidateItem[];
  readonly external: readonly DevServerSidebarExternalItem[];
};

export function isActiveManagedDevServer(server: DevServerSnapshot["managedDevServers"][number]) {
  return server.status !== "stopped" && server.status !== "exited" && server.status !== "error";
}

export function resolveDevServerSidebarItems(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: readonly Project[];
  readonly snapshot: DevServerSnapshot | null;
}): DevServerSidebarItems {
  const devServerScripts =
    input.environmentId === null
      ? []
      : input.projects
          .filter((project) => project.environmentId === input.environmentId)
          .flatMap((project) =>
            project.scripts
              .filter((script) => (script.role ?? "task") === "dev-server")
              .map((script) => ({ project, script })),
          );

  const activeScriptKeys = new Set<string>();
  for (const server of input.snapshot?.managedDevServers ?? []) {
    if (!isActiveManagedDevServer(server)) {
      continue;
    }
    activeScriptKeys.add(`${server.projectId}:${server.scriptId}`);
  }

  return {
    managed: (input.snapshot?.managedDevServers ?? []).map((server) => ({
      kind: "managed" as const,
      action: isActiveManagedDevServer(server) ? ("stop" as const) : ("readonly" as const),
      server,
    })),
    candidates: devServerScripts
      .filter(({ project, script }) => !activeScriptKeys.has(`${project.id}:${script.id}`))
      .map(({ project, script }) => ({
        kind: "candidate" as const,
        action: "start" as const,
        project,
        script,
      })),
    external: (input.snapshot?.externalDevServers ?? []).map((server) => ({
      kind: "external" as const,
      action: "readonly" as const,
      server,
    })),
  };
}
