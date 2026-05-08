import { describe, expect, it } from "vitest";

import {
  formatRendererDiagnosticLine,
  normalizeRendererDiagnostic,
  toRendererDiagnosticLevel,
} from "./rendererDiagnostics";

describe("rendererDiagnostics", () => {
  it("normalizes renderer error diagnostics with stack and location", () => {
    expect(
      normalizeRendererDiagnostic({
        level: "error",
        source: "window-error",
        message: "Uncaught TypeError: bad state",
        url: "http://127.0.0.1:5733/src/App.tsx",
        line: 42,
        column: 7,
        stack: "TypeError: bad state\n    at App",
      }),
    ).toEqual({
      level: "error",
      source: "window-error",
      message: "Uncaught TypeError: bad state",
      url: "http://127.0.0.1:5733/src/App.tsx",
      line: 42,
      column: 7,
      stack: "TypeError: bad state\n    at App",
    });
  });

  it("rejects empty renderer diagnostic messages", () => {
    expect(normalizeRendererDiagnostic({ level: "error", message: "   " })).toBeNull();
  });

  it("maps Electron console levels to log levels", () => {
    expect(toRendererDiagnosticLevel(0)).toBe("debug");
    expect(toRendererDiagnosticLevel(1)).toBe("info");
    expect(toRendererDiagnosticLevel(2)).toBe("warning");
    expect(toRendererDiagnosticLevel(3)).toBe("error");
    expect(toRendererDiagnosticLevel("warn")).toBe("warning");
    expect(toRendererDiagnosticLevel("debug")).toBe("debug");
  });

  it("formats renderer diagnostics as parseable JSON lines with app metadata", () => {
    const line = formatRendererDiagnosticLine(
      {
        level: "warning",
        source: "chromium-console",
        message: "React warning",
        url: "http://localhost:5733/main.tsx",
        line: 12,
      },
      {
        appRunId: "run-123",
        recordedAt: "2026-05-08T10:00:00.000Z",
        windowId: 5,
      },
    );

    expect(JSON.parse(line)).toEqual({
      recordedAt: "2026-05-08T10:00:00.000Z",
      appRunId: "run-123",
      windowId: 5,
      level: "warning",
      source: "chromium-console",
      message: "React warning",
      url: "http://localhost:5733/main.tsx",
      line: 12,
    });
    expect(line.endsWith("\n")).toBe(true);
  });
});
