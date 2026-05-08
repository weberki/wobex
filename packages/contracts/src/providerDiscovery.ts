import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";

export const ProviderSkillInterface = Schema.Struct({
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSkillInterface = typeof ProviderSkillInterface.Type;

export const ProviderSkillDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  path: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  scope: Schema.optional(TrimmedNonEmptyString),
  interface: Schema.optional(ProviderSkillInterface),
  dependencies: Schema.optional(Schema.Unknown),
});
export type ProviderSkillDescriptor = typeof ProviderSkillDescriptor.Type;

export const ProviderNativeCommandDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderNativeCommandDescriptor = typeof ProviderNativeCommandDescriptor.Type;

export const ProviderPluginDescriptor = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  path: Schema.optional(TrimmedNonEmptyString),
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
  interface: Schema.optional(
    Schema.Struct({
      displayName: Schema.optional(TrimmedNonEmptyString),
      shortDescription: Schema.optional(TrimmedNonEmptyString),
      longDescription: Schema.optional(TrimmedNonEmptyString),
      developerName: Schema.optional(TrimmedNonEmptyString),
      category: Schema.optional(TrimmedNonEmptyString),
      brandColor: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
});
export type ProviderPluginDescriptor = typeof ProviderPluginDescriptor.Type;

export const ProviderModelDescriptor = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ProviderModelDescriptor = typeof ProviderModelDescriptor.Type;

export const ProviderPluginDetail = Schema.Struct({
  summary: ProviderPluginDescriptor,
  description: Schema.optional(TrimmedNonEmptyString),
  skills: Schema.Array(ProviderSkillDescriptor),
  commands: Schema.Array(ProviderNativeCommandDescriptor),
  models: Schema.Array(ProviderModelDescriptor),
});
export type ProviderPluginDetail = typeof ProviderPluginDetail.Type;

export const ProviderComposerCapabilities = Schema.Struct({
  provider: ProviderKind,
  supportsSkillMentions: Schema.Boolean,
  supportsSkillDiscovery: Schema.Boolean,
  supportsNativeSlashCommandDiscovery: Schema.Boolean,
  supportsPluginMentions: Schema.Boolean,
  supportsPluginDiscovery: Schema.Boolean,
  supportsPluginRead: Schema.Boolean,
  supportsRuntimeModelList: Schema.Boolean,
});
export type ProviderComposerCapabilities = typeof ProviderComposerCapabilities.Type;

export const ProviderGetComposerCapabilitiesInput = Schema.Struct({
  provider: ProviderKind,
});
export type ProviderGetComposerCapabilitiesInput = typeof ProviderGetComposerCapabilitiesInput.Type;

export const ProviderListSkillsInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(TrimmedNonEmptyString),
  forceReload: Schema.optional(Schema.Boolean),
});
export type ProviderListSkillsInput = typeof ProviderListSkillsInput.Type;

export const ProviderListSkillsResult = Schema.Struct({
  skills: Schema.Array(ProviderSkillDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListSkillsResult = typeof ProviderListSkillsResult.Type;

export const ProviderListCommandsInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(TrimmedNonEmptyString),
  forceReload: Schema.optional(Schema.Boolean),
});
export type ProviderListCommandsInput = typeof ProviderListCommandsInput.Type;

export const ProviderListCommandsResult = Schema.Struct({
  commands: Schema.Array(ProviderNativeCommandDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListCommandsResult = typeof ProviderListCommandsResult.Type;

export const ProviderListPluginsInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(TrimmedNonEmptyString),
  forceReload: Schema.optional(Schema.Boolean),
});
export type ProviderListPluginsInput = typeof ProviderListPluginsInput.Type;

export const ProviderListPluginsResult = Schema.Struct({
  plugins: Schema.Array(ProviderPluginDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListPluginsResult = typeof ProviderListPluginsResult.Type;

export const ProviderReadPluginInput = Schema.Struct({
  provider: ProviderKind,
  pluginId: TrimmedNonEmptyString,
  cwd: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderReadPluginInput = typeof ProviderReadPluginInput.Type;

export const ProviderReadPluginResult = Schema.Struct({
  plugin: ProviderPluginDetail,
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderReadPluginResult = typeof ProviderReadPluginResult.Type;

export const ProviderListModelsInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderListModelsInput = typeof ProviderListModelsInput.Type;

export const ProviderListModelsResult = Schema.Struct({
  models: Schema.Array(ProviderModelDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListModelsResult = typeof ProviderListModelsResult.Type;

export class ProviderDiscoveryUnsupportedError extends Schema.TaggedErrorClass<ProviderDiscoveryUnsupportedError>()(
  "ProviderDiscoveryUnsupportedError",
  {
    provider: ProviderKind,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Provider discovery is not available for '${this.provider}': ${this.detail}`;
  }
}
