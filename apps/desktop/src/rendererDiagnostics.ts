import type {
  DesktopRendererDiagnostic,
  DesktopRendererDiagnosticLevel,
  DesktopRendererDiagnosticSource,
} from "@wobex/contracts";

const MAX_RENDERER_DIAGNOSTIC_TEXT_LENGTH = 16_000;
const DEFAULT_SOURCE: DesktopRendererDiagnosticSource = "chromium-console";

export function toRendererDiagnosticLevel(input: unknown): DesktopRendererDiagnosticLevel {
  if (input === "debug" || input === "verbose" || input === 0) {
    return "debug";
  }
  if (input === "warn" || input === "warning" || input === 2) {
    return "warning";
  }
  if (input === "error" || input === 3) {
    return "error";
  }
  return "info";
}

function cleanText(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > MAX_RENDERER_DIAGNOSTIC_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_RENDERER_DIAGNOSTIC_TEXT_LENGTH - 3)}...`
    : normalized;
}

function cleanNumber(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    return undefined;
  }
  return Math.floor(input);
}

function cleanSource(input: unknown): DesktopRendererDiagnosticSource {
  if (input === "chromium-console" || input === "window-error" || input === "unhandled-rejection") {
    return input;
  }
  return DEFAULT_SOURCE;
}

export function normalizeRendererDiagnostic(input: unknown): DesktopRendererDiagnostic | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const message = cleanText(record.message);
  if (!message) {
    return null;
  }

  const url = cleanText(record.url);
  const line = cleanNumber(record.line);
  const column = cleanNumber(record.column);
  const stack = cleanText(record.stack);

  return {
    level: toRendererDiagnosticLevel(record.level),
    source: cleanSource(record.source),
    message,
    ...(url ? { url } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(stack ? { stack } : {}),
  };
}

export function formatRendererDiagnosticLine(
  diagnostic: DesktopRendererDiagnostic,
  metadata: {
    readonly appRunId: string;
    readonly recordedAt?: string;
    readonly windowId?: number;
  },
): string {
  return `${JSON.stringify({
    recordedAt: metadata.recordedAt ?? new Date().toISOString(),
    appRunId: metadata.appRunId,
    ...(metadata.windowId !== undefined ? { windowId: metadata.windowId } : {}),
    ...diagnostic,
  })}\n`;
}
