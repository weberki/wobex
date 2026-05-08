/**
 * ProviderDiscoveryServiceLive - Discovery surface for providers.
 *
 * This layer exposes typed discovery RPCs backed by the same provider-specific
 * config folders the headless CLIs read.
 *
 * @module ProviderDiscoveryServiceLive
 */
import {
  ProviderDiscoveryUnsupportedError,
  type ProviderComposerCapabilities,
  type ProviderGetComposerCapabilitiesInput,
  type ProviderListCommandsInput,
  type ProviderListModelsInput,
  type ProviderListModelsResult,
  type ProviderListPluginsInput,
  type ProviderListSkillsInput,
  type ProviderReadPluginInput,
  type ProviderKind,
} from "@wobex/contracts";
import { Effect, Layer } from "effect";

import {
  discoverProviderCommands,
  discoverProviderPlugins,
  discoverProviderSkills,
} from "../providerDiscoveryFilesystem.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  ProviderDiscoveryService,
  type ProviderDiscoveryServiceShape,
} from "../Services/ProviderDiscoveryService.ts";

const unsupportedDiscoveryError = (provider: ProviderKind, message: string) =>
  new ProviderDiscoveryUnsupportedError({
    provider,
    detail: message,
  });

const emptyCapabilities = (
  provider: ProviderComposerCapabilities["provider"],
): ProviderComposerCapabilities => ({
  provider,
  supportsSkillMentions: true,
  supportsSkillDiscovery: true,
  supportsNativeSlashCommandDiscovery: true,
  supportsPluginMentions: provider === "codex" || provider === "claudeAgent",
  supportsPluginDiscovery: true,
  supportsPluginRead: false,
  supportsRuntimeModelList: false,
});

const emptyModels = (): ProviderListModelsResult => ({
  models: [],
});

const makeProviderDiscoveryService = Effect.fn("makeProviderDiscoveryService")(function* () {
  const registry = yield* ProviderAdapterRegistry;

  const ensureProvider = (provider: ProviderKind) =>
    registry.getByProvider(provider).pipe(
      Effect.asVoid,
      Effect.catchTag("ProviderUnsupportedError", () =>
        Effect.fail(unsupportedDiscoveryError(provider, "Provider discovery is not available.")),
      ),
    );

  const getComposerCapabilities: ProviderDiscoveryServiceShape["getComposerCapabilities"] = (
    input: ProviderGetComposerCapabilitiesInput,
  ) => ensureProvider(input.provider).pipe(Effect.as(emptyCapabilities(input.provider)));

  const listCommands: ProviderDiscoveryServiceShape["listCommands"] = (
    input: ProviderListCommandsInput,
  ) =>
    ensureProvider(input.provider).pipe(
      Effect.flatMap(() =>
        Effect.promise(async () => ({ commands: await discoverProviderCommands(input.provider) })),
      ),
    );

  const listSkills: ProviderDiscoveryServiceShape["listSkills"] = (
    input: ProviderListSkillsInput,
  ) =>
    ensureProvider(input.provider).pipe(
      Effect.flatMap(() =>
        Effect.promise(async () => ({ skills: await discoverProviderSkills(input.provider) })),
      ),
    );

  const listPlugins: ProviderDiscoveryServiceShape["listPlugins"] = (
    input: ProviderListPluginsInput,
  ) =>
    ensureProvider(input.provider).pipe(
      Effect.flatMap(() =>
        Effect.promise(async () => ({ plugins: await discoverProviderPlugins(input.provider) })),
      ),
    );

  const readPlugin: ProviderDiscoveryServiceShape["readPlugin"] = (
    input: ProviderReadPluginInput,
  ) =>
    ensureProvider(input.provider).pipe(
      Effect.andThen(
        Effect.fail(
          unsupportedDiscoveryError(
            input.provider,
            `Plugin '${input.pluginId}' cannot be read yet.`,
          ),
        ),
      ),
    );

  const listModels: ProviderDiscoveryServiceShape["listModels"] = (
    input: ProviderListModelsInput,
  ) => ensureProvider(input.provider).pipe(Effect.as(emptyModels()));

  return {
    getComposerCapabilities,
    listCommands,
    listSkills,
    listPlugins,
    readPlugin,
    listModels,
  } satisfies ProviderDiscoveryServiceShape;
});

export const ProviderDiscoveryServiceLive = Layer.effect(
  ProviderDiscoveryService,
  makeProviderDiscoveryService(),
);
