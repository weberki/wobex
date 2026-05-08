import {
  getClaudeCompatibleRemoteModelPreset,
  type ModelCapabilities,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@wobex/contracts";
import { normalizeModelSlug } from "@wobex/shared/model";
import {
  WEB_DEFAULT_MODEL_BY_PROVIDER,
  WEB_PROVIDER_DISPLAY_NAMES,
  type WebProviderKind,
} from "./webProviders";

const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

export interface ProviderRuntimeMetadata {
  providerLabel: string;
  backendLabel: string;
  modelLabel: string;
  modelSlug: string;
}

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: WebProviderKind,
): ReadonlyArray<ServerProviderModel> {
  return providers.find((candidate) => candidate.provider === provider)?.models ?? [];
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: WebProviderKind,
): ServerProvider | undefined {
  return providers.find((candidate) => candidate.provider === provider);
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: WebProviderKind,
): boolean {
  return getProviderSnapshot(providers, provider)?.enabled ?? true;
}

export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: WebProviderKind | null | undefined,
): WebProviderKind {
  const requested = provider ?? "codex";
  if (isProviderEnabled(providers, requested)) {
    return requested;
  }
  return providers.find((candidate) => candidate.enabled)?.provider ?? requested;
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: WebProviderKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider as ProviderKind);
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: WebProviderKind,
): string {
  const models = getProviderModels(providers, provider);
  return (
    models.find((model) => !model.isCustom)?.slug ??
    models[0]?.slug ??
    WEB_DEFAULT_MODEL_BY_PROVIDER[provider]
  );
}

export function getProviderRuntimeMetadata(
  providers: ReadonlyArray<ServerProvider>,
  provider: WebProviderKind,
  model: string | null | undefined,
): ProviderRuntimeMetadata {
  const normalizedModel = normalizeModelSlug(model, provider as ProviderKind);
  const modelSlug =
    (typeof normalizedModel === "string" && normalizedModel.trim().length > 0
      ? normalizedModel
      : typeof model === "string" && model.trim().length > 0
        ? model.trim()
        : WEB_DEFAULT_MODEL_BY_PROVIDER[provider]) ?? WEB_DEFAULT_MODEL_BY_PROVIDER[provider];
  const modelLabel =
    getProviderModels(providers, provider).find((candidate) => candidate.slug === modelSlug)
      ?.name ?? modelSlug;

  if (provider === "claudeAgent") {
    const preset = getClaudeCompatibleRemoteModelPreset(modelSlug);
    if (preset?.key === "kimi") {
      return {
        providerLabel: "Kimi",
        backendLabel: "Fireworks",
        modelLabel,
        modelSlug,
      };
    }
    if (preset?.key === "minimax") {
      return {
        providerLabel: "MiniMax",
        backendLabel: "MiniMax API",
        modelLabel,
        modelSlug,
      };
    }
    return {
      providerLabel: WEB_PROVIDER_DISPLAY_NAMES.claudeAgent,
      backendLabel: "Anthropic",
      modelLabel,
      modelSlug,
    };
  }

  return {
    providerLabel: WEB_PROVIDER_DISPLAY_NAMES[provider],
    backendLabel: provider === "codex" ? "OpenAI" : provider === "opencode" ? "OpenCode" : "Droid",
    modelLabel,
    modelSlug,
  };
}
