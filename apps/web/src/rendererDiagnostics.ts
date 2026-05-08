import type { DesktopRendererDiagnostic } from "@wobex/contracts";

let installed = false;

function reportRendererDiagnostic(input: DesktopRendererDiagnostic): void {
  const reporter = window.desktopBridge?.reportRendererDiagnostic;
  if (!reporter) {
    return;
  }
  void Promise.resolve(reporter(input)).catch(() => {
    // Diagnostics must never break the app path they are observing.
  });
}

function errorMessageFromUnknown(input: unknown): string {
  if (input instanceof Error && input.message.trim()) {
    return input.message;
  }
  if (typeof input === "string" && input.trim()) {
    return input;
  }
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}

function stackFromUnknown(input: unknown): string | undefined {
  return input instanceof Error && typeof input.stack === "string" && input.stack.trim()
    ? input.stack
    : undefined;
}

export function installRendererDiagnostics(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  window.addEventListener("error", (event) => {
    const stack = stackFromUnknown(event.error);
    reportRendererDiagnostic({
      level: "error",
      source: "window-error",
      message: event.message || errorMessageFromUnknown(event.error),
      ...(event.filename ? { url: event.filename } : {}),
      ...(event.lineno ? { line: event.lineno } : {}),
      ...(event.colno ? { column: event.colno } : {}),
      ...(stack ? { stack } : {}),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const stack = stackFromUnknown(event.reason);
    reportRendererDiagnostic({
      level: "error",
      source: "unhandled-rejection",
      message: errorMessageFromUnknown(event.reason),
      ...(window.location.href ? { url: window.location.href } : {}),
      ...(stack ? { stack } : {}),
    });
  });
}

export function __resetRendererDiagnosticsForTests(): void {
  installed = false;
}
