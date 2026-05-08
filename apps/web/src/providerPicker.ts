import {
  getClaudeCompatibleRemoteModelPreset,
  type SelectableModelOption,
} from "@wobex/shared/model";
import type { WebProviderKind } from "./webProviders";

export type ProviderPickerKind = WebProviderKind | "kimi" | "minimax";

export interface ProviderPickerOption {
  value: ProviderPickerKind;
  label: string;
  available: boolean;
  canonicalProvider: WebProviderKind | null;
}

export const KIMI_MODEL_OPTION: SelectableModelOption = {
  slug: "accounts/fireworks/routers/kimi-k2p5-turbo",
  name: "Kimi K2.5",
};

export const MINIMAX_MODEL_OPTION: SelectableModelOption = {
  slug: "MiniMax-M2.7",
  name: "MiniMax M2.7",
};

export const PROVIDER_OPTIONS: ReadonlyArray<ProviderPickerOption> = [
  { value: "codex", label: "Codex", available: true, canonicalProvider: "codex" },
  { value: "claudeAgent", label: "Claude", available: true, canonicalProvider: "claudeAgent" },
  { value: "kimi", label: "Kimi", available: true, canonicalProvider: "claudeAgent" },
  { value: "minimax", label: "MiniMax", available: true, canonicalProvider: "claudeAgent" },
  { value: "opencode", label: "OpenCode", available: true, canonicalProvider: "opencode" },
  { value: "droid", label: "Droid", available: true, canonicalProvider: "droid" },
];

function matchesClaudeCompatiblePreset(
  option: SelectableModelOption,
  key: "kimi" | "minimax",
): boolean {
  return getClaudeCompatibleRemoteModelPreset(option.slug)?.key === key;
}

export function getProviderPickerKind(
  provider: WebProviderKind,
  model: string | null | undefined,
): ProviderPickerKind {
  if (provider !== "claudeAgent") {
    return provider;
  }

  const preset = getClaudeCompatibleRemoteModelPreset(model);
  if (preset?.key === "kimi") {
    return "kimi";
  }
  if (preset?.key === "minimax") {
    return "minimax";
  }
  return "claudeAgent";
}

export function getProviderPickerModelOptions(
  kind: ProviderPickerKind,
  modelOptionsByProvider: Record<WebProviderKind, ReadonlyArray<SelectableModelOption>>,
): ReadonlyArray<SelectableModelOption> {
  switch (kind) {
    case "codex":
      return modelOptionsByProvider.codex;
    case "claudeAgent":
      return modelOptionsByProvider.claudeAgent.filter(
        (option) => getClaudeCompatibleRemoteModelPreset(option.slug) === null,
      );
    case "kimi": {
      const matches = modelOptionsByProvider.claudeAgent.filter((option) =>
        matchesClaudeCompatiblePreset(option, "kimi"),
      );
      return matches.length > 0 ? matches : [KIMI_MODEL_OPTION];
    }
    case "minimax": {
      const matches = modelOptionsByProvider.claudeAgent.filter((option) =>
        matchesClaudeCompatiblePreset(option, "minimax"),
      );
      return matches.length > 0 ? matches : [MINIMAX_MODEL_OPTION];
    }
    case "opencode":
    case "droid":
      return modelOptionsByProvider[kind] ?? [];
    default:
      return [];
  }
}

export function getCanonicalProviderForPickerKind(
  kind: ProviderPickerKind,
): WebProviderKind | null {
  return PROVIDER_OPTIONS.find((option) => option.value === kind)?.canonicalProvider ?? null;
}
