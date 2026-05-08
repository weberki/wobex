import { scopedProjectKey, scopeProjectRef } from "@wobex/client-runtime";
import type { ScopedProjectRef } from "@wobex/contracts";
import type { Project } from "./types";

export function deriveLogicalProjectKey(
  project: Pick<Project, "environmentId" | "id" | "repositoryIdentity">,
): string {
  return (
    project.repositoryIdentity?.canonicalKey ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "repositoryIdentity"> | null | undefined,
): string {
  return project?.repositoryIdentity?.canonicalKey ?? scopedProjectKey(projectRef);
}
