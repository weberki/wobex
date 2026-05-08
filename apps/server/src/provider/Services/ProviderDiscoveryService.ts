import type {
  ProviderComposerCapabilities,
  ProviderDiscoveryUnsupportedError,
  ProviderGetComposerCapabilitiesInput,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
} from "@wobex/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export type ProviderDiscoveryError = ProviderDiscoveryUnsupportedError;

export interface ProviderDiscoveryServiceShape {
  readonly getComposerCapabilities: (
    input: ProviderGetComposerCapabilitiesInput,
  ) => Effect.Effect<ProviderComposerCapabilities, ProviderDiscoveryError>;
  readonly listCommands: (
    input: ProviderListCommandsInput,
  ) => Effect.Effect<ProviderListCommandsResult, ProviderDiscoveryError>;
  readonly listSkills: (
    input: ProviderListSkillsInput,
  ) => Effect.Effect<ProviderListSkillsResult, ProviderDiscoveryError>;
  readonly listPlugins: (
    input: ProviderListPluginsInput,
  ) => Effect.Effect<ProviderListPluginsResult, ProviderDiscoveryError>;
  readonly readPlugin: (
    input: ProviderReadPluginInput,
  ) => Effect.Effect<ProviderReadPluginResult, ProviderDiscoveryError>;
  readonly listModels: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ProviderListModelsResult, ProviderDiscoveryError>;
}

export class ProviderDiscoveryService extends Context.Service<
  ProviderDiscoveryService,
  ProviderDiscoveryServiceShape
>()("wobex/provider/Services/ProviderDiscoveryService") {}
