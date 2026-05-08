import type { ProviderKind } from "@wobex/contracts";

export type WebProviderKind = ProviderKind | "opencode" | "droid";

export const WEB_PROVIDER_KINDS: readonly WebProviderKind[] = [
  "codex",
  "claudeAgent",
  "opencode",
  "droid",
] as const;

export const WEB_PROVIDER_DISPLAY_NAMES: Record<WebProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  opencode: "OpenCode",
  droid: "Droid",
};

export const WEB_DEFAULT_MODEL_BY_PROVIDER: Record<WebProviderKind, string> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  opencode: "opencode",
  droid: "droid",
};

export function isWebProviderKind(value: string | null | undefined): value is WebProviderKind {
  return value === "codex" || value === "claudeAgent" || value === "opencode" || value === "droid";
}
