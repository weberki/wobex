import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ThreadId, type ProviderEvent } from "@wobex/contracts";

import { CodexAppServerManager } from "../codexAppServerManager";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DEFAULT_IMAGEGEN_TIMEOUT_MS = 10 * 60 * 1000;
const noop = () => {};

export interface CodexImagegenPromptInput {
  readonly prompt: string;
  readonly count?: number;
  readonly size?: string;
  readonly quality?: string;
  readonly outputFormat?: string;
}

export interface GeneratedImageFile {
  readonly path: string;
  readonly extension: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface RunCodexImagegenDevToolInput extends CodexImagegenPromptInput {
  readonly outPath: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly codexBinary?: string;
  readonly codexHome?: string;
  readonly manager?: CodexAppServerManager;
}

export interface CodexImagegenDevToolResult {
  readonly generatedFiles: readonly string[];
  readonly outputFiles: readonly string[];
  readonly threadId: string;
}

export function buildCodexImagegenPrompt(input: CodexImagegenPromptInput): string {
  const count = normalizeImageCount(input.count);
  return [
    "You are running inside Wobex's dev image generation helper.",
    "Use the built-in `image_gen` tool to generate the requested raster image(s).",
    `Request: ${input.prompt}`,
    `Number of images: ${count}`,
    ...(input.size ? [`Size: ${input.size}`] : []),
    ...(input.quality ? [`Quality: ${input.quality}`] : []),
    ...(input.outputFormat ? [`Preferred output format: ${input.outputFormat}`] : []),
    "Do not write code or create SVG placeholders. Use raster image generation.",
    "Respond with a concise JSON object containing any generated image paths you can identify.",
  ].join("\n");
}

export function resolveCodexGeneratedImagesDir(codexHome?: string): string {
  return path.join(
    resolveHomePath(codexHome ?? path.join(homedir(), ".codex")),
    "generated_images",
  );
}

export async function findGeneratedImageFiles(input: {
  readonly generatedImagesDir: string;
  readonly sinceMs: number;
}): Promise<GeneratedImageFile[]> {
  const files: GeneratedImageFile[] = [];
  await collectGeneratedImageFiles(input.generatedImagesDir, input.sinceMs, files);
  return files.toSorted(
    (left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path),
  );
}

export function resolveImagegenOutputTargets(input: {
  readonly outPath: string;
  readonly sources: ReadonlyArray<Pick<GeneratedImageFile, "path" | "extension">>;
}): string[] {
  const parsed = path.parse(input.outPath);
  if (input.sources.length <= 1) {
    const sourceExtension = input.sources[0]?.extension;
    return [parsed.ext ? input.outPath : `${input.outPath}${sourceExtension ?? ".png"}`];
  }

  return input.sources.map((source, index) => {
    const extension = parsed.ext || source.extension || ".png";
    return path.join(parsed.dir, `${parsed.name}-${index + 1}${extension}`);
  });
}

export async function runCodexImagegenDevTool(
  input: RunCodexImagegenDevToolInput,
): Promise<CodexImagegenDevToolResult> {
  const manager = input.manager ?? new CodexAppServerManager();
  const threadId = ThreadId.make(`dev-imagegen-${randomUUID()}`);
  const startedAt = Date.now();
  const count = normalizeImageCount(input.count);
  const prompt = buildCodexImagegenPrompt(input);
  const ownsManager = input.manager === undefined;

  try {
    await manager.startSession({
      threadId,
      provider: "codex",
      binaryPath: input.codexBinary ?? "codex",
      ...(input.codexHome ? { homePath: resolveHomePath(input.codexHome) } : {}),
      cwd: input.cwd ?? process.cwd(),
      runtimeMode: "full-access",
      ...(input.model ? { model: input.model } : {}),
    });

    const completion = createCodexTurnCompletionWaiter(manager, threadId, input.timeoutMs);
    try {
      await manager.sendTurn({
        threadId,
        input: prompt,
        interactionMode: "default",
        ...(input.model ? { model: input.model } : {}),
      });
      await completion.promise;
    } catch (error) {
      completion.cancel();
      throw error;
    }

    const generatedFiles = (
      await findGeneratedImageFiles({
        generatedImagesDir: resolveCodexGeneratedImagesDir(input.codexHome),
        sinceMs: startedAt - 1_000,
      })
    ).slice(0, count);
    if (generatedFiles.length === 0) {
      throw new Error("Codex completed, but no new generated image files were found.");
    }

    const outputFiles = resolveImagegenOutputTargets({
      outPath: input.outPath,
      sources: generatedFiles,
    });
    await Promise.all(
      generatedFiles.map(async (source, index) => {
        const target = outputFiles[index];
        if (!target) {
          return;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source.path, target);
      }),
    );

    return {
      generatedFiles: generatedFiles.map((file) => file.path),
      outputFiles,
      threadId,
    };
  } finally {
    if (ownsManager || manager.hasSession(threadId)) {
      manager.stopSession(threadId);
    }
  }
}

async function collectGeneratedImageFiles(
  dir: string,
  sinceMs: number,
  files: GeneratedImageFile[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectGeneratedImageFiles(fullPath, sinceMs, files);
        return;
      }
      if (!entry.isFile()) {
        return;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) {
        return;
      }
      const stats = await stat(fullPath);
      if (stats.mtimeMs < sinceMs) {
        return;
      }
      files.push({
        path: fullPath,
        extension,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
    }),
  );
}

function createCodexTurnCompletionWaiter(
  manager: CodexAppServerManager,
  threadId: ThreadId,
  timeoutMs = DEFAULT_IMAGEGEN_TIMEOUT_MS,
): { readonly promise: Promise<void>; readonly cancel: () => void } {
  let cleanup = noop;
  const promise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting ${timeoutMs}ms for Codex image generation to finish.`));
    }, timeoutMs);

    cleanup = () => {
      clearTimeout(timeout);
      manager.off("event", onEvent);
    };

    const onEvent = (event: ProviderEvent) => {
      if (event.threadId !== threadId) {
        return;
      }
      if (event.kind === "error" || event.method === "error") {
        cleanup();
        reject(new Error(event.message ?? "Codex image generation failed."));
        return;
      }
      if (event.method !== "turn/completed") {
        return;
      }

      const payload = asRecord(event.payload);
      const turn = asRecord(payload?.turn);
      const status = typeof turn?.status === "string" ? turn.status : "completed";
      if (status === "failed") {
        const errorMessage = asRecord(turn?.error)?.message;
        cleanup();
        reject(
          new Error(
            typeof errorMessage === "string" ? errorMessage : "Codex image generation failed.",
          ),
        );
        return;
      }

      cleanup();
      resolve();
    };

    manager.on("event", onEvent);
  });

  return { promise, cancel: cleanup };
}

function normalizeImageCount(count: number | undefined): number {
  if (count === undefined) {
    return 1;
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Image count must be an integer greater than zero.");
  }
  return count;
}

function resolveHomePath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
