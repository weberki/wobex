import type {
  EnvironmentId,
  ProjectListTreeResult,
  ProjectSearchEntriesResult,
} from "@wobex/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environmentApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  listTree: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
    limit: number,
  ) => ["projects", "list-tree", environmentId ?? null, cwd, relativePath, limit] as const,
  readFile: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
    maxBytes: number | null,
  ) => ["projects", "read-file", environmentId ?? null, cwd, relativePath, maxBytes] as const,
  searchEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit: number,
  ) => ["projects", "search-entries", environmentId ?? null, cwd, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_LIST_TREE_LIMIT = 200;
const DEFAULT_LIST_TREE_STALE_TIME = 15_000;
const DEFAULT_READ_FILE_STALE_TIME = 15_000;
const EMPTY_LIST_TREE_RESULT: ProjectListTreeResult = {
  entries: [],
  truncated: false,
};
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
export function projectListTreeQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath?: string | null;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_LIST_TREE_LIMIT;
  const relativePath = input.relativePath ?? null;
  return queryOptions({
    queryKey: projectQueryKeys.listTree(input.environmentId, input.cwd, relativePath, limit),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace tree listing is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.listTree({
        cwd: input.cwd,
        ...(relativePath ? { relativePath } : {}),
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_LIST_TREE_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_LIST_TREE_RESULT,
  });
}

export function projectSearchEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.environmentId, input.cwd, input.query, limit),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace entry search is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  maxBytes?: number;
  enabled?: boolean;
  staleTime?: number;
}) {
  const maxBytes = input.maxBytes ?? null;
  return queryOptions({
    queryKey: projectQueryKeys.readFile(
      input.environmentId,
      input.cwd,
      input.relativePath,
      maxBytes,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.relativePath) {
        throw new Error("Workspace file preview is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
        ...(typeof maxBytes === "number" ? { maxBytes } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
  });
}
