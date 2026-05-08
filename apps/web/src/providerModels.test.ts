import { describe, expect, it } from "vitest";
import { getProviderRuntimeMetadata } from "./providerModels";
import type { ServerProvider } from "@wobex/contracts";

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.1.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "claudeAgent",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: "claude-opus-4-7[1m]",
        name: "Claude Opus 4.7 1M",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "accounts/fireworks/routers/kimi-k2p5-turbo",
        name: "Kimi K2.5",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "MiniMax-M2.7",
        name: "MiniMax M2.7",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
];

describe("getProviderRuntimeMetadata", () => {
  it("reports Anthropic for native Claude models", () => {
    expect(
      getProviderRuntimeMetadata(TEST_PROVIDERS, "claudeAgent", "claude-opus-4-7[1m]"),
    ).toEqual({
      providerLabel: "Claude",
      backendLabel: "Anthropic",
      modelLabel: "Claude Opus 4.7 1M",
      modelSlug: "claude-opus-4-7[1m]",
    });
  });

  it("reports Fireworks for Kimi presets under the Claude runtime", () => {
    expect(
      getProviderRuntimeMetadata(
        TEST_PROVIDERS,
        "claudeAgent",
        "accounts/fireworks/routers/kimi-k2p5-turbo",
      ),
    ).toEqual({
      providerLabel: "Kimi",
      backendLabel: "Fireworks",
      modelLabel: "Kimi K2.5",
      modelSlug: "accounts/fireworks/routers/kimi-k2p5-turbo",
    });
  });

  it("reports MiniMax API for MiniMax presets under the Claude runtime", () => {
    expect(getProviderRuntimeMetadata(TEST_PROVIDERS, "claudeAgent", "MiniMax-M2.7")).toEqual({
      providerLabel: "MiniMax",
      backendLabel: "MiniMax API",
      modelLabel: "MiniMax M2.7",
      modelSlug: "MiniMax-M2.7",
    });
  });

  it("reports local metadata for OpenCode and Droid providers", () => {
    expect(getProviderRuntimeMetadata(TEST_PROVIDERS, "opencode", "opencode-default")).toEqual({
      providerLabel: "OpenCode",
      backendLabel: "OpenCode",
      modelLabel: "opencode-default",
      modelSlug: "opencode-default",
    });
    expect(getProviderRuntimeMetadata(TEST_PROVIDERS, "droid", "droid-default")).toEqual({
      providerLabel: "Droid",
      backendLabel: "Droid",
      modelLabel: "droid-default",
      modelSlug: "droid-default",
    });
  });
});
