import { describe, expect, it } from "vitest";

import {
  buildTerminalPaneLayoutFromPreset,
  collectTerminalPaneTerminalIds,
  findFirstTerminalPaneId,
  layoutContainsTerminalPaneId,
} from "./terminalPaneLayout";

describe("terminalPaneLayout", () => {
  it("builds a preset layout tree and preserves terminal order", () => {
    const layout = buildTerminalPaneLayoutFromPreset({
      presetId: "top-main",
      terminalIds: ["alpha", "beta", "gamma"],
      activeTerminalId: "gamma",
    });

    expect(collectTerminalPaneTerminalIds(layout)).toEqual(["alpha", "beta", "gamma"]);
    expect(findFirstTerminalPaneId(layout)).toBe("alpha");
    expect(layoutContainsTerminalPaneId(layout, "beta")).toBe(true);
    expect(layoutContainsTerminalPaneId(layout, "missing")).toBe(false);
  });

  it("falls back to the default terminal when no ids are provided", () => {
    const layout = buildTerminalPaneLayoutFromPreset({
      presetId: "single",
      terminalIds: [],
    });

    expect(collectTerminalPaneTerminalIds(layout)).toEqual(["default"]);
    expect(findFirstTerminalPaneId(layout)).toBe("default");
  });
});
