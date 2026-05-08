import fsPromises from "node:fs/promises";

import Mime from "@effect/platform-node/Mime";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const DEFAULT_READ_FILE_MAX_BYTES = 1_048_576;
const WORKSPACE_READ_FILE_MAX_BYTES = 2 * 1024 * 1024;

function processErrorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isProbablyTextBuffer(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return true;
  }

  const sampleSize = Math.min(bytes.length, 4096);
  let suspiciousCount = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const byte = bytes[index]!;
    if (byte === 0) {
      return false;
    }
    if (byte < 7 || (byte > 13 && byte < 32) || byte === 127) {
      suspiciousCount += 1;
    }
  }

  return suspiciousCount / sampleSize < 0.3;
}

function makeWorkspaceFileSystemError(input: {
  readonly cwd: string;
  readonly operation: string;
  readonly detail: string;
  readonly relativePath?: string;
  readonly cause?: unknown;
}): WorkspaceFileSystemError {
  return new WorkspaceFileSystemError({
    cwd: input.cwd,
    operation: input.operation,
    detail: input.detail,
    ...(input.relativePath === undefined ? {} : { relativePath: input.relativePath }),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const normalizedCwd = yield* workspacePaths.normalizeWorkspaceRoot(input.cwd).pipe(
        Effect.mapError((cause) =>
          makeWorkspaceFileSystemError({
            cwd: input.cwd,
            operation: "workspaceFileSystem.normalizeWorkspaceRoot",
            detail: cause.message,
            cause,
          }),
        ),
      );

      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: normalizedCwd,
        relativePath: input.relativePath,
      });

      const stat = yield* Effect.tryPromise({
        try: () => fsPromises.stat(target.absolutePath),
        catch: (cause) =>
          makeWorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFileStat",
            detail: processErrorDetail(cause),
            cause,
          }),
      });
      if (!stat.isFile()) {
        return yield* makeWorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.readFile",
          detail: `Workspace path is not a file: ${target.relativePath}`,
        });
      }

      const requestedMaxBytes = Math.min(
        input.maxBytes ?? DEFAULT_READ_FILE_MAX_BYTES,
        WORKSPACE_READ_FILE_MAX_BYTES,
      );
      const maxBytes = Math.max(0, requestedMaxBytes);
      const bytesToRead = Math.min(stat.size, maxBytes);

      const bytes = yield* Effect.tryPromise({
        try: async () => {
          const handle = await fsPromises.open(target.absolutePath, "r");
          try {
            const buffer = new Uint8Array(bytesToRead);
            const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
            return buffer.slice(0, bytesRead);
          } finally {
            await handle.close();
          }
        },
        catch: (cause) =>
          makeWorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.readFile",
            detail: processErrorDetail(cause),
            cause,
          }),
      });

      const mimeType = Mime.getType(target.absolutePath) ?? "application/octet-stream";
      const truncated = stat.size > bytes.length;
      const relativePath = target.relativePath;

      if (isProbablyTextBuffer(bytes)) {
        return {
          kind: "text",
          relativePath,
          mimeType,
          sizeBytes: stat.size,
          truncated,
          contents: new TextDecoder("utf-8").decode(bytes),
        };
      }

      return {
        kind: "binary",
        relativePath,
        mimeType,
        sizeBytes: stat.size,
        truncated,
        bytesBase64: Buffer.from(bytes).toString("base64"),
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return { readFile, writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
