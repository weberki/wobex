import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID,
  ensureWorkspaceTerminalIdsForPreset,
  getWorkspaceTerminalLayoutPreset,
  getWorkspaceTerminalLayoutPresetSlotCount,
  normalizeWorkspaceTerminalLayoutPresetId,
} from "./workspaceTerminalLayoutPresets";

describe("workspaceTerminalLayoutPresets", () => {
  it("normalizes unknown preset ids to the default preset", () => {
    expect(normalizeWorkspaceTerminalLayoutPresetId("missing")).toBe(
      DEFAULT_WORKSPACE_TERMINAL_LAYOUT_PRESET_ID,
    );
    expect(getWorkspaceTerminalLayoutPreset("two-columns").id).toBe("two-columns");
  });

  it("reports the correct slot counts for presets", () => {
    expect(getWorkspaceTerminalLayoutPresetSlotCount("single")).toBe(1);
    expect(getWorkspaceTerminalLayoutPresetSlotCount("quad")).toBe(4);
  });

  it("fills missing terminal ids without duplicating existing ids", () => {
    const generatedIds = ["two", "three", "four"];
    const terminalIds = ensureWorkspaceTerminalIdsForPreset(["default"], "quad", () => {
      const nextTerminalId = generatedIds.shift();
      if (!nextTerminalId) {
        throw new Error("unexpected terminal id request");
      }
      return nextTerminalId;
    });

    expect(terminalIds).toEqual(["default", "two", "three", "four"]);
  });
});
