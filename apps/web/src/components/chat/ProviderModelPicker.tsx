import { type VariantProps } from "class-variance-authority";
import { memo, useState } from "react";

import { type ProviderKind, type ServerProvider } from "@wobex/contracts";
import { resolveSelectableModel } from "@wobex/shared/model";
import { buttonVariants } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  ClaudeAI,
  type Icon,
  DroidIcon,
  KimiIcon,
  MiniMaxIcon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";
import { cn } from "~/lib/utils";
import { getProviderSnapshot } from "../../providerModels";
import {
  getCanonicalProviderForPickerKind,
  getProviderPickerKind,
  getProviderPickerModelOptions,
  type ProviderPickerKind,
  PROVIDER_OPTIONS,
} from "../../providerPicker";
import type { WebProviderKind } from "../../webProviders";
import { PickerTriggerButton } from "./PickerTriggerButton";

type ProviderModelOption = { slug: string; name: string };

function isAvailableProviderOption(
  option: (typeof PROVIDER_OPTIONS)[number],
): option is (typeof PROVIDER_OPTIONS)[number] & { available: true } {
  return option.available;
}

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  kimi: KimiIcon,
  minimax: MiniMaxIcon,
  opencode: OpenCodeIcon,
  droid: DroidIcon,
};

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);

function providerIconClassName(provider: ProviderPickerKind, fallbackClassName: string): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

type ProviderModelPickerProps = {
  provider: WebProviderKind;
  model: string;
  lockedProvider: WebProviderKind | null;
  providers: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<WebProviderKind, ReadonlyArray<ProviderModelOption>>;
  compact?: boolean;
  activeProviderIconClassName?: string;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: WebProviderKind, model: string) => void;
};

export const ProviderModelPicker = memo(function ProviderModelPicker({
  provider,
  model,
  lockedProvider,
  providers,
  modelOptionsByProvider,
  compact = false,
  activeProviderIconClassName,
  triggerVariant = "ghost",
  triggerClassName,
  onProviderModelChange,
}: ProviderModelPickerProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeProvider = lockedProvider ?? provider;
  const activePickerKind = getProviderPickerKind(activeProvider, model);
  const activeOptions = getProviderPickerModelOptions(activePickerKind, modelOptionsByProvider);
  const activeModelLabel = activeOptions.find((option) => option.slug === model)?.name ?? model;
  const ActiveIcon = PROVIDER_ICON_BY_PROVIDER[activePickerKind];

  const visibleProviders = AVAILABLE_PROVIDER_OPTIONS.filter(
    (option) => lockedProvider === null || option.canonicalProvider === lockedProvider,
  );

  const handleModelChange = (pickerKind: ProviderPickerKind, value: string) => {
    const canonicalProvider = getCanonicalProviderForPickerKind(pickerKind);
    if (!canonicalProvider || !value) return;
    const resolvedModel = resolveSelectableModel(
      canonicalProvider as ProviderKind,
      value,
      getProviderPickerModelOptions(pickerKind, modelOptionsByProvider),
    );
    if (!resolvedModel) return;
    onProviderModelChange(canonicalProvider, resolvedModel);
    setIsMenuOpen(false);
  };

  return (
    <Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <MenuTrigger
        render={
          <PickerTriggerButton
            variant={triggerVariant}
            data-chat-provider-model-picker="true"
            compact={compact}
            className={triggerClassName}
            icon={
              <ActiveIcon
                aria-hidden="true"
                className={cn(
                  "size-4",
                  providerIconClassName(activePickerKind, "text-muted-foreground/70"),
                  activeProviderIconClassName,
                )}
              />
            }
            label={activeModelLabel}
          />
        }
      />
      <MenuPopup align="start">
        {lockedProvider !== null ? (
          <MenuRadioGroup
            value={model}
            onValueChange={(value) => handleModelChange(activePickerKind, value)}
          >
            {activeOptions.map((candidate) => (
              <MenuRadioItem
                key={`${activePickerKind}:${candidate.slug}`}
                value={candidate.slug}
                onClick={() => setIsMenuOpen(false)}
              >
                {candidate.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        ) : (
          <>
            {visibleProviders.map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              const liveProvider = option.canonicalProvider
                ? getProviderSnapshot(providers, option.canonicalProvider)
                : undefined;
              const optionModels = getProviderPickerModelOptions(
                option.value,
                modelOptionsByProvider,
              );

              if (liveProvider && liveProvider.status !== "ready") {
                const unavailableLabel = !liveProvider.enabled
                  ? "Disabled"
                  : !liveProvider.installed
                    ? "Not installed"
                    : "Unavailable";
                return (
                  <MenuItem key={option.value} disabled>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 opacity-80",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    <span>{option.label}</span>
                    <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                      {unavailableLabel}
                    </span>
                  </MenuItem>
                );
              }

              return (
                <MenuSub key={option.value}>
                  <MenuSubTrigger>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    {option.label}
                  </MenuSubTrigger>
                  <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
                    {optionModels.length > 0 ? (
                      <MenuRadioGroup
                        value={activePickerKind === option.value ? model : ""}
                        onValueChange={(value) => handleModelChange(option.value, value)}
                      >
                        {optionModels.map((candidate) => (
                          <MenuRadioItem
                            key={`${option.value}:${candidate.slug}`}
                            value={candidate.slug}
                            onClick={() => setIsMenuOpen(false)}
                          >
                            {candidate.name}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    ) : (
                      <MenuItem disabled>No models available</MenuItem>
                    )}
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
            <MenuSeparator />
            {PROVIDER_OPTIONS.filter((option) => !option.available).map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              return (
                <MenuItem key={option.value} disabled>
                  <OptionIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
});
