import {
  type ProviderKind,
  type ProviderModelOptions,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@wobex/contracts";
import { isClaudeUltrathinkPrompt, resolveEffort } from "@wobex/shared/model";
import type { ReactNode } from "react";
import type { DraftId } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import {
  normalizeClaudeModelOptionsWithCapabilities,
  normalizeCodexModelOptionsWithCapabilities,
} from "@wobex/shared/model";
import type { WebProviderKind } from "../../webProviders";

export type ComposerProviderStateInput = {
  provider: WebProviderKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  prompt: string;
  modelOptions: ProviderModelOptions | null | undefined;
};

export type ComposerProviderState = {
  provider: WebProviderKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ProviderModelOptions[ProviderKind] | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type ProviderRegistryEntry = {
  getState: (input: ComposerProviderStateInput) => ComposerProviderState;
  renderTraitsMenuContent: (input: {
    threadRef?: ScopedThreadRef;
    draftId?: DraftId;
    model: string;
    models: ReadonlyArray<ServerProviderModel>;
    modelOptions: ProviderModelOptions[ProviderKind] | undefined;
    prompt: string;
    onPromptChange: (prompt: string) => void;
  }) => ReactNode;
  renderTraitsPicker: (input: {
    threadRef?: ScopedThreadRef;
    draftId?: DraftId;
    model: string;
    models: ReadonlyArray<ServerProviderModel>;
    modelOptions: ProviderModelOptions[ProviderKind] | undefined;
    prompt: string;
    onPromptChange: (prompt: string) => void;
  }) => ReactNode;
};

const renderNoTraits = (_input: unknown): ReactNode => null;

function getProviderStateFromCapabilities(
  input: ComposerProviderStateInput,
): ComposerProviderState {
  const { provider, model, models, prompt, modelOptions } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const providerOptions =
    provider === "codex" || provider === "claudeAgent" ? modelOptions?.[provider] : undefined;

  // Resolve effort
  const rawEffort = providerOptions
    ? "effort" in providerOptions
      ? providerOptions.effort
      : "reasoningEffort" in providerOptions
        ? providerOptions.reasoningEffort
        : null
    : null;

  const promptEffort = resolveEffort(caps, rawEffort) ?? null;

  // Normalize options for dispatch
  const normalizedOptions =
    provider === "codex"
      ? normalizeCodexModelOptionsWithCapabilities(caps, providerOptions)
      : provider === "claudeAgent"
        ? normalizeClaudeModelOptionsWithCapabilities(caps, providerOptions)
        : undefined;

  // Ultrathink styling (driven by capabilities data, not provider identity)
  const ultrathinkActive =
    caps.promptInjectedEffortLevels.length > 0 && isClaudeUltrathinkPrompt(prompt);

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: normalizedOptions,
    ...(ultrathinkActive ? { composerFrameClassName: "ultrathink-frame" } : {}),
    ...(ultrathinkActive
      ? { composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]" }
      : {}),
    ...(ultrathinkActive ? { modelPickerIconClassName: "ultrathink-chroma" } : {}),
  };
}

const composerProviderRegistry: Record<WebProviderKind, ProviderRegistryEntry> = {
  codex: {
    getState: (input) => getProviderStateFromCapabilities(input),
    renderTraitsMenuContent: renderNoTraits,
    renderTraitsPicker: renderNoTraits,
  },
  claudeAgent: {
    getState: (input) => getProviderStateFromCapabilities(input),
    renderTraitsMenuContent: renderNoTraits,
    renderTraitsPicker: renderNoTraits,
  },
  opencode: {
    getState: (input) => getProviderStateFromCapabilities(input),
    renderTraitsMenuContent: renderNoTraits,
    renderTraitsPicker: renderNoTraits,
  },
  droid: {
    getState: (input) => getProviderStateFromCapabilities(input),
    renderTraitsMenuContent: renderNoTraits,
    renderTraitsPicker: renderNoTraits,
  },
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  return composerProviderRegistry[input.provider].getState(input);
}

export function renderProviderTraitsMenuContent(input: {
  provider: WebProviderKind;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ProviderModelOptions[ProviderKind] | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  return composerProviderRegistry[input.provider].renderTraitsMenuContent({
    ...(input.threadRef ? { threadRef: input.threadRef } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
    model: input.model,
    models: input.models,
    modelOptions: input.modelOptions,
    prompt: input.prompt,
    onPromptChange: input.onPromptChange,
  });
}

export function renderProviderTraitsPicker(input: {
  provider: WebProviderKind;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ProviderModelOptions[ProviderKind] | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}): ReactNode {
  return composerProviderRegistry[input.provider].renderTraitsPicker({
    ...(input.threadRef ? { threadRef: input.threadRef } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
    model: input.model,
    models: input.models,
    modelOptions: input.modelOptions,
    prompt: input.prompt,
    onPromptChange: input.onPromptChange,
  });
}
