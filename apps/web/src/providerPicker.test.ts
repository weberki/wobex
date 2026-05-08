import { describe, expect, it } from "vitest";

import {
  getCanonicalProviderForPickerKind,
  getProviderPickerKind,
  getProviderPickerModelOptions,
  KIMI_MODEL_OPTION,
  MINIMAX_MODEL_OPTION,
} from "./providerPicker";

describe("providerPicker", () => {
  it("maps Claude-compatible remote models to dedicated picker kinds", () => {
    expect(getProviderPickerKind("codex", "gpt-5-codex")).toBe("codex");
    expect(getProviderPickerKind("claudeAgent", "claude-sonnet-4-6")).toBe("claudeAgent");
    expect(getProviderPickerKind("claudeAgent", KIMI_MODEL_OPTION.slug)).toBe("kimi");
    expect(getProviderPickerKind("claudeAgent", MINIMAX_MODEL_OPTION.slug)).toBe("minimax");
    expect(getProviderPickerKind("opencode", "opencode-default")).toBe("opencode");
    expect(getProviderPickerKind("droid", "droid-default")).toBe("droid");
  });

  it("splits Claude remote presets into dedicated provider groups", () => {
    const modelOptionsByProvider = {
      codex: [{ slug: "gpt-5-codex", name: "GPT-5 Codex" }],
      claudeAgent: [
        { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
        KIMI_MODEL_OPTION,
        MINIMAX_MODEL_OPTION,
      ],
      opencode: [{ slug: "opencode-default", name: "OpenCode Default" }],
      droid: [{ slug: "droid-default", name: "Droid Default" }],
    };

    expect(getProviderPickerModelOptions("claudeAgent", modelOptionsByProvider)).toEqual([
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ]);
    expect(getProviderPickerModelOptions("kimi", modelOptionsByProvider)).toEqual([
      KIMI_MODEL_OPTION,
    ]);
    expect(getProviderPickerModelOptions("minimax", modelOptionsByProvider)).toEqual([
      MINIMAX_MODEL_OPTION,
    ]);
    expect(getProviderPickerModelOptions("opencode", modelOptionsByProvider)).toEqual([
      { slug: "opencode-default", name: "OpenCode Default" },
    ]);
    expect(getProviderPickerModelOptions("droid", modelOptionsByProvider)).toEqual([
      { slug: "droid-default", name: "Droid Default" },
    ]);
  });

  it("keeps Kimi and MiniMax mapped to the Claude runtime", () => {
    expect(getCanonicalProviderForPickerKind("kimi")).toBe("claudeAgent");
    expect(getCanonicalProviderForPickerKind("minimax")).toBe("claudeAgent");
    expect(getCanonicalProviderForPickerKind("opencode")).toBe("opencode");
    expect(getCanonicalProviderForPickerKind("droid")).toBe("droid");
  });
});
