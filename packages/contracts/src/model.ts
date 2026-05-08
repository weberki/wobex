import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import type { ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];
export const CLAUDE_CODE_EFFORT_OPTIONS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultrathink",
] as const;
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_OPTIONS)[number];
export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort;

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(Schema.Literals(CLAUDE_CODE_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(Schema.String),
});
export type ClaudeModelOptions = typeof ClaudeModelOptions.Type;

export const OpenCodeModelOptions = Schema.Struct({});
export type OpenCodeModelOptions = typeof OpenCodeModelOptions.Type;

export const DroidModelOptions = Schema.Struct({});
export type DroidModelOptions = typeof DroidModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeAgent: Schema.optional(ClaudeModelOptions),
  opencode: Schema.optional(OpenCodeModelOptions),
  droid: Schema.optional(DroidModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

export const EffortOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type EffortOption = typeof EffortOption.Type;

export const ContextWindowOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type ContextWindowOption = typeof ContextWindowOption.Type;

export const ModelCapabilities = Schema.Struct({
  reasoningEffortLevels: Schema.Array(EffortOption),
  supportsFastMode: Schema.Boolean,
  supportsThinkingToggle: Schema.Boolean,
  contextWindowOptions: Schema.Array(ContextWindowOption),
  promptInjectedEffortLevels: Schema.Array(TrimmedNonEmptyString),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  opencode: "gpt-5.4",
  droid: "claude-sonnet-4-6",
};

export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;

/** Per-provider text generation model defaults. */
export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4-mini",
  claudeAgent: "claude-haiku-4-5",
  opencode: "gpt-5.4-mini",
  droid: "claude-haiku-4-5",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<ProviderKind, Record<string, string>> = {
  codex: {
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeAgent: {
    opus: "claude-opus-4-7",
    "opus-4.7": "claude-opus-4-7",
    "opus-4.7-1m": "claude-opus-4-7[1m]",
    "opus-4.7[1m]": "claude-opus-4-7[1m]",
    "claude-opus-4.7": "claude-opus-4-7",
    "claude-opus-4.7-1m": "claude-opus-4-7[1m]",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251101": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
    kimi: "accounts/fireworks/routers/kimi-k2p5-turbo",
    "kimi-k2.5": "accounts/fireworks/routers/kimi-k2p5-turbo",
    "kimi-k2p5": "accounts/fireworks/routers/kimi-k2p5-turbo",
    minimax: "MiniMax-M2.7",
    "minimax-m2.7": "MiniMax-M2.7",
    "m2.7": "MiniMax-M2.7",
  },
  opencode: {},
  droid: {},
};

function normalizeClaudeCompatibleRemoteModelSlug(model: string | null | undefined): string | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER.claudeAgent as Record<string, string>;
  return aliases[trimmed] ?? trimmed;
}

type ClaudeCompatibleRemoteModelKey = "kimi" | "minimax";

export interface ClaudeCompatibleRemoteModelPreset {
  readonly key: ClaudeCompatibleRemoteModelKey;
  readonly label: string;
  readonly defaultBaseUrl: string;
  readonly apiTimeoutMs: string;
  readonly modelSlug: string;
}

export const CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESETS = [
  {
    key: "kimi",
    label: "Kimi K2.5",
    defaultBaseUrl: "https://api.fireworks.ai/inference",
    apiTimeoutMs: "600000",
    modelSlug: "accounts/fireworks/routers/kimi-k2p5-turbo",
  },
  {
    key: "minimax",
    label: "MiniMax M2.7",
    defaultBaseUrl: "https://api.minimax.io/anthropic",
    apiTimeoutMs: "3000000",
    modelSlug: "MiniMax-M2.7",
  },
] as const satisfies ReadonlyArray<ClaudeCompatibleRemoteModelPreset>;

const CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESET_BY_MODEL = Object.fromEntries(
  CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESETS.map((preset) => [preset.modelSlug, preset]),
) as Record<string, ClaudeCompatibleRemoteModelPreset>;

export function getClaudeCompatibleRemoteModelPreset(
  model: string | null | undefined,
): ClaudeCompatibleRemoteModelPreset | null {
  const normalized = normalizeClaudeCompatibleRemoteModelSlug(model);
  if (!normalized) {
    return null;
  }
  return CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESET_BY_MODEL[normalized] ?? null;
}

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  opencode: "OpenCode",
  droid: "Droid",
};
