import { scopedProjectKey, scopeProjectRef } from "@wobex/client-runtime";
import type { ScopedProjectRef } from "@wobex/contracts";
import type { Project } from "./types";

type LogicalProjectInput = Pick<Project, "environmentId" | "id" | "repositoryIdentity">;

export function deriveLogicalProjectKey(project: LogicalProjectInput): string {
  return (
    project.repositoryIdentity?.canonicalKey ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function createLogicalProjectKeyResolver(projects: readonly LogicalProjectInput[]) {
  const physicalKeyForProject = (project: LogicalProjectInput) =>
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
  const membersByRawKey = new Map<string, LogicalProjectInput[]>();

  for (const project of projects) {
    const rawKey = deriveLogicalProjectKey(project);
    const members = membersByRawKey.get(rawKey);
    if (members) {
      members.push(project);
    } else {
      membersByRawKey.set(rawKey, [project]);
    }
  }

  const resolvedKeysByPhysicalKey = new Map<string, string>();
  for (const [rawKey, members] of membersByRawKey) {
    const usesRepositoryIdentity = members.some(
      (project) => project.repositoryIdentity?.canonicalKey === rawKey,
    );

    if (!usesRepositoryIdentity) {
      for (const project of members) {
        resolvedKeysByPhysicalKey.set(physicalKeyForProject(project), rawKey);
      }
      continue;
    }

    const firstProjectByEnvironment = new Set<string>();
    for (const project of members) {
      const physicalKey = physicalKeyForProject(project);
      if (firstProjectByEnvironment.has(project.environmentId)) {
        resolvedKeysByPhysicalKey.set(physicalKey, physicalKey);
        continue;
      }

      firstProjectByEnvironment.add(project.environmentId);
      resolvedKeysByPhysicalKey.set(physicalKey, rawKey);
    }
  }

  return (project: LogicalProjectInput): string =>
    resolvedKeysByPhysicalKey.get(physicalKeyForProject(project)) ??
    deriveLogicalProjectKey(project);
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "repositoryIdentity"> | null | undefined,
): string {
  return project?.repositoryIdentity?.canonicalKey ?? scopedProjectKey(projectRef);
}
