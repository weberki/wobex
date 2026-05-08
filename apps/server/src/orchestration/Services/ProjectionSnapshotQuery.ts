/**
 * ProjectionSnapshotQuery - Read-model snapshot query service interface.
 *
 * Exposes the current orchestration projection snapshot for read-only API
 * access.
 *
 * @module ProjectionSnapshotQuery
 */
import type {
  OrchestrationCheckpointSummary,
  OrchestrationProject,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from "@wobex/contracts";
import { Context } from "effect";
import type { Option } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionSnapshotCounts {
  readonly projectCount: number;
  readonly threadCount: number;
}

export interface ProjectionThreadCheckpointContext {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

/**
 * ProjectionSnapshotQueryShape - Service API for read-model snapshots.
 */
export interface ProjectionSnapshotQueryShape {
  /**
   * Read the latest orchestration projection snapshot — UNBOUNDED.
   *
   * Rehydrates the full read model from projection tables (all threads,
   * messages, activities, plans, checkpoints) and derives snapshot sequence
   * from projector cursor state.
   *
   * Intended for internal callers that need authoritative state — notably
   * the `OrchestrationEngine` bootstrap, which keeps the full model in
   * memory for its decider, and offline CLI mutations that check invariants
   * against the complete read model. External / client-facing callers
   * (WebSocket `orchestration.getSnapshot`, HTTP `/api/orchestration/snapshot`)
   * should prefer `getBoundedSnapshot` to avoid O(workspace size) payloads.
   */
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;

  /**
   * Read a bounded orchestration projection snapshot suitable for the
   * external API surface.
   *
   * Caps (see constants in the Live Layer):
   * - Most recent threads by `updated_at`.
   * - Per thread: most recent N messages (returned chronologically) and most
   *   recent N activities (returned chronologically).
   * - Pending proposed plans only, up to a global cap.
   *
   * When a collection is capped, the matching `*Truncated` flag on the
   * `OrchestrationReadModel` / `OrchestrationThread` is set to `true` so the
   * client can surface "showing latest N of M" affordances. A follow-up task
   * will add cursor-based lazy loading for older records.
   */
  readonly getBoundedSnapshot: () => Effect.Effect<
    OrchestrationReadModel,
    ProjectionRepositoryError
  >;

  /**
   * Read aggregate projection counts without hydrating the full read model.
   */
  readonly getCounts: () => Effect.Effect<ProjectionSnapshotCounts, ProjectionRepositoryError>;

  /**
   * Read the active project for an exact workspace root match.
   */
  readonly getActiveProjectByWorkspaceRoot: (
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;

  /**
   * Read the earliest active thread for a project.
   */
  readonly getFirstActiveThreadIdByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<ThreadId>, ProjectionRepositoryError>;

  /**
   * Read the checkpoint context needed to resolve a single thread diff.
   */
  readonly getThreadCheckpointContext: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionThreadCheckpointContext>, ProjectionRepositoryError>;
}

/**
 * ProjectionSnapshotQuery - Service tag for projection snapshot queries.
 */
export class ProjectionSnapshotQuery extends Context.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("wobex/orchestration/Services/ProjectionSnapshotQuery") {}
