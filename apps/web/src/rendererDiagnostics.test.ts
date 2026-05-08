import type { DesktopBridge } from "@wobex/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetRendererDiagnosticsForTests,
  installRendererDiagnostics,
} from "./rendererDiagnostics";

type TestWindow = Window &
  typeof globalThis & {
    desktopBridge?: DesktopBridge;
  };

function installTestWindow() {
  const listeners = new Map<string, Array<(event: Event) => void>>();
  const reportRendererDiagnostic = vi.fn<NonNullable<DesktopBridge["reportRendererDiagnostic"]>>();
  const testWindow = {
    location: new URL("http://127.0.0.1:5733/"),
    desktopBridge: {
      reportRendererDiagnostic,
    } as Partial<DesktopBridge> as DesktopBridge,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const callback =
        typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    }),
    removeEventListener: vi.fn(),
  } as unknown as TestWindow;

  vi.stubGlobal("window", testWindow);
  return {
    reportRendererDiagnostic,
    dispatch(type: string, event: Event) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
}

describe("rendererDiagnostics", () => {
  afterEach(() => {
    __resetRendererDiagnosticsForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports window errors to the desktop diagnostics bridge", () => {
    const harness = installTestWindow();

    installRendererDiagnostics();
    harness.dispatch(
      "error",
      Object.assign(new Event("error"), {
        message: "TypeError: Cannot read properties of undefined",
        filename: "http://127.0.0.1:5733/src/App.tsx",
        lineno: 44,
        colno: 9,
        error: new Error("Cannot read properties of undefined"),
      }),
    );

    expect(harness.reportRendererDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        source: "window-error",
        message: "TypeError: Cannot read properties of undefined",
        url: "http://127.0.0.1:5733/src/App.tsx",
        line: 44,
        column: 9,
      }),
    );
  });

  it("reports unhandled promise rejections with stack details", () => {
    const harness = installTestWindow();
    const reason = new Error("provider state exploded");

    installRendererDiagnostics();
    harness.dispatch(
      "unhandledrejection",
      Object.assign(new Event("unhandledrejection"), {
        promise: Promise.reject(reason).catch(() => undefined),
        reason,
      }),
    );

    expect(harness.reportRendererDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        source: "unhandled-rejection",
        message: "provider state exploded",
        stack: expect.stringContaining("provider state exploded"),
      }),
    );
  });
});
