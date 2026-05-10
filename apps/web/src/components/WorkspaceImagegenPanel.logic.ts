import type {
  ServerImageGenerationFit,
  ServerImageGenerationFormat,
  ServerImageGenerationInput,
} from "@wobex/contracts";

export const IMAGEGEN_ASPECT_PRESETS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1024x1024",
  "1536x864",
  "864x1536",
] as const;

export const IMAGEGEN_OUTPUT_PRESETS = [
  "native",
  "1024x1024",
  "1920x1080",
  "1080x1920",
  "1536x1024",
  "1024x1536",
  "custom",
] as const;

export const IMAGEGEN_QUALITY_OPTIONS = ["auto", "low", "medium", "high"] as const;

export type ImagegenMode = "single" | "batch";
export type ImagegenAspectPreset = (typeof IMAGEGEN_ASPECT_PRESETS)[number];
export type ImagegenOutputPreset = (typeof IMAGEGEN_OUTPUT_PRESETS)[number];
export type ImagegenQuality = (typeof IMAGEGEN_QUALITY_OPTIONS)[number];

export interface ImagegenDraft {
  readonly mode: ImagegenMode;
  readonly prompt: string;
  readonly batchPrompts: string;
  readonly count: number;
  readonly aspectPreset: ImagegenAspectPreset;
  readonly outputPreset: ImagegenOutputPreset;
  readonly customWidth: number;
  readonly customHeight: number;
  readonly quality: ImagegenQuality;
  readonly format: ServerImageGenerationFormat;
  readonly fit: ServerImageGenerationFit;
  readonly background: string;
  readonly outputBasename: string;
}

export const DEFAULT_IMAGEGEN_DRAFT: ImagegenDraft = {
  mode: "single",
  prompt: "",
  batchPrompts: "",
  count: 1,
  aspectPreset: "16:9",
  outputPreset: "1920x1080",
  customWidth: 1920,
  customHeight: 1080,
  quality: "high",
  format: "png",
  fit: "cover",
  background: "",
  outputBasename: "imagegen",
};

export function splitImagegenBatchPrompts(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const nonEmptyLines = normalized.split("\n").filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length > 1 && nonEmptyLines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return nonEmptyLines.map((line) => line.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean);
  }

  return normalized
    .replace(/^\s*---+\s*$/gm, "\n\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function clampImagegenCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(4, Math.max(1, Math.round(value)));
}

export function buildImagegenRequests(
  draft: ImagegenDraft,
  options: { readonly cwd: string | null | undefined },
): ServerImageGenerationInput[] {
  const prompts =
    draft.mode === "batch"
      ? splitImagegenBatchPrompts(draft.batchPrompts)
      : draft.prompt.trim()
        ? [draft.prompt.trim()]
        : [];
  const baseName = sanitizeImagegenBasename(draft.outputBasename);
  const resize = resolveImagegenResize(draft);

  return prompts.map((prompt, index) => {
    const request: ServerImageGenerationInput = {
      prompt,
      count: clampImagegenCount(draft.count),
      quality: draft.quality,
      format: draft.format,
      outputBasename: prompts.length > 1 ? `${baseName}-${index + 1}` : baseName,
    };
    if (draft.aspectPreset !== "auto") {
      Object.assign(request, { size: draft.aspectPreset });
    }
    if (options.cwd) {
      Object.assign(request, { cwd: options.cwd });
    }
    if (resize) {
      Object.assign(request, { resize });
    }
    return request;
  });
}

function resolveImagegenResize(draft: ImagegenDraft): ServerImageGenerationInput["resize"] {
  if (draft.outputPreset === "native") {
    return undefined;
  }

  const dimensions =
    draft.outputPreset === "custom"
      ? normalizeDimensions(draft.customWidth, draft.customHeight)
      : parseDimensions(draft.outputPreset);
  if (!dimensions) {
    return undefined;
  }

  return {
    width: dimensions.width,
    height: dimensions.height,
    fit: draft.fit,
    ...(draft.background.trim() ? { background: draft.background.trim() } : {}),
  };
}

function parseDimensions(value: string): { width: number; height: number } | null {
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  return normalizeDimensions(Number(match[1]), Number(match[2]));
}

function normalizeDimensions(width: number, height: number): { width: number; height: number } {
  return {
    width: clampImageDimension(width),
    height: clampImageDimension(height),
  };
}

function clampImageDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 1024;
  }
  return Math.min(8192, Math.max(1, Math.round(value)));
}

function sanitizeImagegenBasename(value: string): string {
  const sanitized = value
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "imagegen";
}
