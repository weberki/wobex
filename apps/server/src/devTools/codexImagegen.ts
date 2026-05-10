import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import {
  ThreadId,
  type ProviderEvent,
  type ServerGeneratedImage,
  type ServerImageGenerationInput,
  type ServerImageGenerationResult,
} from "@wobex/contracts";

import { CodexAppServerManager } from "../codexAppServerManager";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DEFAULT_IMAGEGEN_TIMEOUT_MS = 10 * 60 * 1000;
const noop = () => {};

export const IMAGE_OUTPUT_FORMATS = ["png", "webp", "jpg", "jpeg"] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];
export type ImageResizeFit = "cover" | "contain" | "fill";

export interface ImageResizeOptions {
  readonly width: number;
  readonly height: number;
  readonly fit?: ImageResizeFit;
  readonly background?: string;
}

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
  readonly resize?: ImageResizeOptions;
  readonly magickBinary?: string;
  readonly manager?: CodexAppServerManager;
}

export interface CodexImagegenDevToolResult {
  readonly generatedFiles: readonly string[];
  readonly outputFiles: readonly string[];
  readonly threadId: string;
}

export interface RunCodexImagegenServerToolInput {
  readonly request: ServerImageGenerationInput;
  readonly attachmentsDir: string;
  readonly codexBinary?: string;
  readonly codexHome?: string;
  readonly magickBinary?: string;
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
  readonly outputFormat?: ImageOutputFormat;
  readonly sources: ReadonlyArray<Pick<GeneratedImageFile, "path" | "extension">>;
}): string[] {
  const parsed = path.parse(input.outPath);
  const requestedExtension = input.outputFormat ? `.${input.outputFormat}` : undefined;
  if (input.sources.length <= 1) {
    const sourceExtension = input.sources[0]?.extension;
    const extension = requestedExtension ?? (parsed.ext || sourceExtension || ".png");
    return [path.join(parsed.dir, `${parsed.name}${extension}`)];
  }

  return input.sources.map((source, index) => {
    const extension = requestedExtension ?? (parsed.ext || source.extension || ".png");
    return path.join(parsed.dir, `${parsed.name}-${index + 1}${extension}`);
  });
}

export function parseImageResize(value: string): ImageResizeOptions {
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(value.trim());
  if (!match) {
    throw new Error("Expected resize in WIDTHxHEIGHT pixels, for example 1024x1024.");
  }
  const width = Number.parseInt(match[1] ?? "", 10);
  const height = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Expected resize in WIDTHxHEIGHT pixels, for example 1024x1024.");
  }
  return { width, height };
}

export function normalizeImageOutputFormat(value: string): ImageOutputFormat {
  const normalized = value.trim().toLowerCase();
  if (IMAGE_OUTPUT_FORMATS.includes(normalized as ImageOutputFormat)) {
    return normalized as ImageOutputFormat;
  }
  throw new Error(`Unsupported output format: ${value}. Use png, webp, jpg, or jpeg.`);
}

export function buildImageMagickPostprocessArgs(input: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly resize?: ImageResizeOptions;
}): string[] {
  const args = [input.sourcePath, "-auto-orient"];
  const resize = input.resize;
  if (resize) {
    const geometry = `${resize.width}x${resize.height}`;
    const fit = resize.fit ?? "cover";
    if (fit === "cover") {
      args.push("-resize", `${geometry}^`, "-gravity", "center", "-extent", geometry);
    } else if (fit === "contain") {
      args.push(
        "-resize",
        geometry,
        "-background",
        resize.background ?? "transparent",
        "-gravity",
        "center",
        "-extent",
        geometry,
      );
    } else {
      args.push("-resize", `${geometry}!`);
    }
  }
  args.push(input.targetPath);
  return args;
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
      ...(input.outputFormat
        ? { outputFormat: normalizeImageOutputFormat(input.outputFormat) }
        : {}),
      sources: generatedFiles,
    });
    await Promise.all(
      generatedFiles.map(async (source, index) => {
        const target = outputFiles[index];
        if (!target) {
          return;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await copyOrPostprocessImage({
          source,
          targetPath: target,
          ...(input.resize ? { resize: input.resize } : {}),
          ...(input.magickBinary ? { magickBinary: input.magickBinary } : {}),
        });
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

export async function runCodexImagegenServerTool(
  input: RunCodexImagegenServerToolInput,
): Promise<ServerImageGenerationResult> {
  const startedAt = Date.now();
  const jobId = randomUUID();
  const outputBasename = sanitizeImageOutputBasename(input.request.outputBasename ?? "imagegen");
  const outputStem = path.join(input.attachmentsDir, "imagegen", jobId, outputBasename);
  const result = await runCodexImagegenDevTool({
    prompt: input.request.prompt,
    outPath: outputStem,
    count: input.request.count ?? 1,
    ...(input.request.size ? { size: input.request.size } : {}),
    ...(input.request.quality ? { quality: input.request.quality } : {}),
    ...(input.request.format ? { outputFormat: input.request.format } : {}),
    ...(input.request.resize
      ? {
          resize: {
            width: input.request.resize.width,
            height: input.request.resize.height,
            fit: input.request.resize.fit ?? "cover",
            ...(input.request.resize.background
              ? { background: input.request.resize.background }
              : {}),
          },
        }
      : {}),
    ...(input.request.model ? { model: input.request.model } : {}),
    ...(input.request.cwd ? { cwd: input.request.cwd } : {}),
    ...(input.request.timeoutMs ? { timeoutMs: input.request.timeoutMs } : {}),
    ...(input.codexBinary ? { codexBinary: input.codexBinary } : {}),
    ...(input.codexHome ? { codexHome: input.codexHome } : {}),
    ...(input.magickBinary ? { magickBinary: input.magickBinary } : {}),
  });

  const images = await Promise.all(
    result.outputFiles.map(async (filePath, index): Promise<ServerGeneratedImage> => {
      const stats = await stat(filePath);
      const sourcePath = result.generatedFiles[index];
      const relativePath = path.relative(input.attachmentsDir, filePath).replace(/\\/g, "/");
      return {
        path: filePath,
        url: `/attachments/${relativePath}`,
        sizeBytes: stats.size,
        ...(sourcePath ? { sourcePath } : {}),
      };
    }),
  );

  return {
    threadId: result.threadId,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    images,
  };
}

async function copyOrPostprocessImage(input: {
  readonly source: GeneratedImageFile;
  readonly targetPath: string;
  readonly resize?: ImageResizeOptions;
  readonly magickBinary?: string;
}): Promise<void> {
  const targetExtension = path.extname(input.targetPath).toLowerCase();
  const shouldPostprocess = Boolean(input.resize) || targetExtension !== input.source.extension;
  if (!shouldPostprocess) {
    await copyFile(input.source.path, input.targetPath);
    return;
  }

  const args = buildImageMagickPostprocessArgs({
    sourcePath: input.source.path,
    targetPath: input.targetPath,
    ...(input.resize ? { resize: input.resize } : {}),
  });
  await runImageMagick(input.magickBinary ?? "magick", args);
}

async function runImageMagick(binary: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Image postprocessing failed to start '${binary}'. Install ImageMagick or omit --resize/format conversion.`,
          { cause: error },
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          signal
            ? `Image postprocessing exited after signal ${signal}.`
            : `Image postprocessing exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });
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

function sanitizeImageOutputBasename(value: string): string {
  const sanitized = value
    .trim()
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || "imagegen";
}
