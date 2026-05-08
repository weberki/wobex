/**
 * WorkspaceEntries - Effect service contract for cached workspace entry search.
 *
 * Owns indexed workspace entry search plus cache invalidation for workspace
 * roots when the underlying filesystem changes.
 *
 * @module WorkspaceEntries
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type {
  ProjectListTreeInput,
  ProjectListTreeResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@wobex/contracts";

export class WorkspaceEntriesError extends Schema.TaggedErrorClass<WorkspaceEntriesError>()(
  "WorkspaceEntriesError",
  {
    cwd: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * WorkspaceEntriesShape - Service API for workspace entry search and cache
 * invalidation.
 */
export interface WorkspaceEntriesShape {
  /**
   * List direct child entries for a workspace directory, optionally under a
   * nested relative path.
   */
  readonly listTree: (
    input: ProjectListTreeInput,
  ) => Effect.Effect<ProjectListTreeResult, WorkspaceEntriesError>;

  /**
   * Search indexed workspace entries for files and directories matching the
   * provided query.
   */
  readonly search: (
    input: ProjectSearchEntriesInput,
  ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceEntriesError>;

  /**
   * Drop any cached workspace entries for the given workspace root.
   */
  readonly invalidate: (cwd: string) => Effect.Effect<void>;
}

/**
 * WorkspaceEntries - Service tag for cached workspace entry search.
 */
export class WorkspaceEntries extends Context.Service<WorkspaceEntries, WorkspaceEntriesShape>()(
  "wobex/workspace/Services/WorkspaceEntries",
) {}
