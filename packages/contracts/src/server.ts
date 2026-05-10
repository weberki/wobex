import { Schema } from "effect";
import { ExecutionEnvironmentDescriptor } from "./environment";
import { ServerAuthDescriptor } from "./auth";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";
import { ServerSettings } from "./settings";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderAuth = typeof ServerProviderAuth.Type;

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  isCustom: Schema.Boolean,
  capabilities: Schema.NullOr(ModelCapabilities),
});
export type ServerProviderModel = typeof ServerProviderModel.Type;

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  models: Schema.Array(ServerProviderModel),
});
export type ServerProvider = typeof ServerProvider.Type;

export const ServerProviders = Schema.Array(ServerProvider);
export type ServerProviders = typeof ServerProviders.Type;

export const ServerObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type ServerObservability = typeof ServerObservability.Type;

export const ServerConfig = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  auth: ServerAuthDescriptor,
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  observability: ServerObservability,
  settings: ServerSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviders,
  settings: Schema.optional(ServerSettings),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;

export const ServerConfigKeybindingsUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
});
export type ServerConfigKeybindingsUpdatedPayload =
  typeof ServerConfigKeybindingsUpdatedPayload.Type;

export const ServerConfigProviderStatusesPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerConfigProviderStatusesPayload = typeof ServerConfigProviderStatusesPayload.Type;

export const ServerConfigSettingsUpdatedPayload = Schema.Struct({
  settings: ServerSettings,
});
export type ServerConfigSettingsUpdatedPayload = typeof ServerConfigSettingsUpdatedPayload.Type;

export const ServerConfigStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  config: ServerConfig,
});
export type ServerConfigStreamSnapshotEvent = typeof ServerConfigStreamSnapshotEvent.Type;

export const ServerConfigStreamKeybindingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("keybindingsUpdated"),
  payload: ServerConfigKeybindingsUpdatedPayload,
});
export type ServerConfigStreamKeybindingsUpdatedEvent =
  typeof ServerConfigStreamKeybindingsUpdatedEvent.Type;

export const ServerConfigStreamProviderStatusesEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("providerStatuses"),
  payload: ServerConfigProviderStatusesPayload,
});
export type ServerConfigStreamProviderStatusesEvent =
  typeof ServerConfigStreamProviderStatusesEvent.Type;

export const ServerConfigStreamSettingsUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("settingsUpdated"),
  payload: ServerConfigSettingsUpdatedPayload,
});
export type ServerConfigStreamSettingsUpdatedEvent =
  typeof ServerConfigStreamSettingsUpdatedEvent.Type;

export const ServerConfigStreamEvent = Schema.Union([
  ServerConfigStreamSnapshotEvent,
  ServerConfigStreamKeybindingsUpdatedEvent,
  ServerConfigStreamProviderStatusesEvent,
  ServerConfigStreamSettingsUpdatedEvent,
]);
export type ServerConfigStreamEvent = typeof ServerConfigStreamEvent.Type;

export const ServerLifecycleReadyPayload = Schema.Struct({
  at: IsoDateTime,
  environment: ExecutionEnvironmentDescriptor,
});
export type ServerLifecycleReadyPayload = typeof ServerLifecycleReadyPayload.Type;

export const ServerLifecycleWelcomePayload = Schema.Struct({
  environment: ExecutionEnvironmentDescriptor,
  cwd: TrimmedNonEmptyString,
  projectName: TrimmedNonEmptyString,
  bootstrapProjectId: Schema.optional(ProjectId),
  bootstrapThreadId: Schema.optional(ThreadId),
});
export type ServerLifecycleWelcomePayload = typeof ServerLifecycleWelcomePayload.Type;

export const ServerLifecycleStreamWelcomeEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("welcome"),
  payload: ServerLifecycleWelcomePayload,
});
export type ServerLifecycleStreamWelcomeEvent = typeof ServerLifecycleStreamWelcomeEvent.Type;

export const ServerLifecycleStreamReadyEvent = Schema.Struct({
  version: Schema.Literal(1),
  sequence: NonNegativeInt,
  type: Schema.Literal("ready"),
  payload: ServerLifecycleReadyPayload,
});
export type ServerLifecycleStreamReadyEvent = typeof ServerLifecycleStreamReadyEvent.Type;

export const ServerLifecycleStreamEvent = Schema.Union([
  ServerLifecycleStreamWelcomeEvent,
  ServerLifecycleStreamReadyEvent,
]);
export type ServerLifecycleStreamEvent = typeof ServerLifecycleStreamEvent.Type;

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export type ServerProviderUpdatedPayload = typeof ServerProviderUpdatedPayload.Type;

export const ServerRefreshProviderUsageInput = Schema.Struct({
  provider: ProviderKind,
  cwd: Schema.optional(TrimmedNonEmptyString),
  force: Schema.optional(Schema.Boolean),
});
export type ServerRefreshProviderUsageInput = typeof ServerRefreshProviderUsageInput.Type;

export const ServerProviderUsageWindow = Schema.Struct({
  label: TrimmedNonEmptyString,
  usedPercent: Schema.NullOr(Schema.Number),
  remainingPercent: Schema.NullOr(Schema.Number),
  resetsAt: Schema.NullOr(IsoDateTime),
  resetLabel: Schema.optional(TrimmedNonEmptyString),
  kind: Schema.optional(Schema.Literals(["session", "weekly", "other"])),
  windowMinutes: Schema.optional(PositiveInt),
  source: TrimmedNonEmptyString,
});
export type ServerProviderUsageWindow = typeof ServerProviderUsageWindow.Type;

export const ServerRefreshProviderUsageResult = Schema.Struct({
  provider: ProviderKind,
  refreshedAt: IsoDateTime,
  cached: Schema.Boolean,
  available: Schema.Boolean,
  error: Schema.optional(TrimmedNonEmptyString),
  rateLimits: Schema.Struct({
    windows: Schema.Array(ServerProviderUsageWindow),
  }),
});
export type ServerRefreshProviderUsageResult = typeof ServerRefreshProviderUsageResult.Type;

export const ServerImageGenerationFormat = Schema.Literals(["png", "webp", "jpg", "jpeg"]);
export type ServerImageGenerationFormat = typeof ServerImageGenerationFormat.Type;

export const ServerImageGenerationFit = Schema.Literals(["cover", "contain", "fill"]);
export type ServerImageGenerationFit = typeof ServerImageGenerationFit.Type;

const ImageDimension = PositiveInt.check(Schema.isLessThanOrEqualTo(8192));

export const ServerImageGenerationResize = Schema.Struct({
  width: ImageDimension,
  height: ImageDimension,
  fit: Schema.optional(ServerImageGenerationFit),
  background: Schema.optional(TrimmedNonEmptyString),
});
export type ServerImageGenerationResize = typeof ServerImageGenerationResize.Type;

export const ServerImageGenerationInput = Schema.Struct({
  prompt: TrimmedNonEmptyString,
  count: Schema.optional(PositiveInt),
  size: Schema.optional(TrimmedNonEmptyString),
  quality: Schema.optional(TrimmedNonEmptyString),
  format: Schema.optional(ServerImageGenerationFormat),
  resize: Schema.optional(ServerImageGenerationResize),
  outputBasename: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  cwd: Schema.optional(TrimmedNonEmptyString),
  timeoutMs: Schema.optional(PositiveInt),
});
export type ServerImageGenerationInput = typeof ServerImageGenerationInput.Type;

export const ServerGeneratedImage = Schema.Struct({
  path: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  sourcePath: Schema.optional(TrimmedNonEmptyString),
});
export type ServerGeneratedImage = typeof ServerGeneratedImage.Type;

export const ServerImageGenerationResult = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  generatedAt: IsoDateTime,
  durationMs: NonNegativeInt,
  images: Schema.Array(ServerGeneratedImage),
});
export type ServerImageGenerationResult = typeof ServerImageGenerationResult.Type;

export class ServerImageGenerationError extends Schema.TaggedErrorClass<ServerImageGenerationError>()(
  "ServerImageGenerationError",
  {
    message: TrimmedNonEmptyString,
  },
) {}

const DevServerPort = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
  Schema.isLessThanOrEqualTo(65535),
);
const DevServerId = TrimmedNonEmptyString.check(Schema.isMaxLength(160));
const DevServerScriptId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const DevServerEnvKey = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)).check(
  Schema.isMaxLength(128),
);
const DevServerEnvValue = Schema.String.check(Schema.isMaxLength(8_192));
const DevServerEnv = Schema.Record(DevServerEnvKey, DevServerEnvValue).check(
  Schema.isMaxProperties(128),
);

export const DevServerListener = Schema.Struct({
  pid: Schema.NullOr(PositiveInt),
  protocol: TrimmedNonEmptyString,
  port: DevServerPort,
  address: TrimmedNonEmptyString,
  processName: Schema.NullOr(TrimmedNonEmptyString),
});
export type DevServerListener = typeof DevServerListener.Type;

export const DevServerStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "exited",
  "error",
  "unknown",
]);
export type DevServerStatus = typeof DevServerStatus.Type;

export const ExternalDevServer = Schema.Struct({
  id: DevServerId,
  pid: Schema.NullOr(PositiveInt),
  label: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  port: Schema.NullOr(DevServerPort),
  workspacePath: Schema.NullOr(TrimmedNonEmptyString),
  status: DevServerStatus,
});
export type ExternalDevServer = typeof ExternalDevServer.Type;

export const ManagedDevServer = Schema.Struct({
  id: DevServerId,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  scriptId: DevServerScriptId,
  scriptName: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  pid: Schema.NullOr(PositiveInt),
  port: Schema.NullOr(DevServerPort),
  status: DevServerStatus,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  exitCode: Schema.NullOr(NonNegativeInt),
  exitSignal: Schema.NullOr(TrimmedNonEmptyString),
});
export type ManagedDevServer = typeof ManagedDevServer.Type;

export const DevServerSnapshot = Schema.Struct({
  recordedAt: IsoDateTime,
  supported: Schema.Boolean,
  unsupportedReason: Schema.optional(TrimmedNonEmptyString),
  listeners: Schema.Array(DevServerListener),
  externalDevServers: Schema.Array(ExternalDevServer),
  managedDevServers: Schema.Array(ManagedDevServer),
});
export type DevServerSnapshot = typeof DevServerSnapshot.Type;

export const DevServerStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  snapshot: DevServerSnapshot,
});
export type DevServerStreamSnapshotEvent = typeof DevServerStreamSnapshotEvent.Type;

export const DevServerStreamEvent = DevServerStreamSnapshotEvent;
export type DevServerStreamEvent = typeof DevServerStreamEvent.Type;

export const DevServerStartInput = Schema.Struct({
  projectId: ProjectId,
  scriptId: DevServerScriptId,
  cwd: Schema.optional(TrimmedNonEmptyString),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  env: Schema.optional(DevServerEnv),
});
export type DevServerStartInput = typeof DevServerStartInput.Type;

export const DevServerStopInput = Schema.Struct({
  id: DevServerId,
});
export type DevServerStopInput = typeof DevServerStopInput.Type;

export class DevServerError extends Schema.TaggedErrorClass<DevServerError>()("DevServerError", {
  message: TrimmedNonEmptyString,
  id: Schema.optional(DevServerId),
  cause: Schema.optional(Schema.Defect),
}) {}
