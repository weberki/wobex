import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_LIST_TREE_MAX_LIMIT = 500;
const PROJECT_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectListTreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_FILE_PATH_MAX_LENGTH)),
  ),
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_LIST_TREE_MAX_LIMIT)),
  ),
});
export type ProjectListTreeInput = typeof ProjectListTreeInput.Type;

export const ProjectListTreeResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectListTreeResult = typeof ProjectListTreeResult.Type;

export class ProjectListTreeError extends Schema.TaggedErrorClass<ProjectListTreeError>()(
  "ProjectListTreeError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_FILE_PATH_MAX_LENGTH)),
  maxBytes: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_READ_FILE_MAX_BYTES)),
  ),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

const ProjectReadFilePreviewBase = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  truncated: Schema.Boolean,
});

export const ProjectReadFileTextResult = Schema.Struct({
  kind: Schema.Literal("text"),
  ...ProjectReadFilePreviewBase.fields,
  contents: Schema.String,
});
export type ProjectReadFileTextResult = typeof ProjectReadFileTextResult.Type;

export const ProjectReadFileBinaryResult = Schema.Struct({
  kind: Schema.Literal("binary"),
  ...ProjectReadFilePreviewBase.fields,
  bytesBase64: Schema.String,
});
export type ProjectReadFileBinaryResult = typeof ProjectReadFileBinaryResult.Type;

export const ProjectReadFileResult = Schema.Union([
  ProjectReadFileTextResult,
  ProjectReadFileBinaryResult,
]);
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
