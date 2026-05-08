import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";
import {
  CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESETS,
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DroidModelOptions,
  OpenCodeModelOptions,
} from "./model";
import { ModelSelection } from "./orchestration";

export { CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESETS } from "./model";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const MIN_CHAT_FONT_SIZE_PX = 11;
export const MAX_CHAT_FONT_SIZE_PX = 18;
export const DEFAULT_CHAT_FONT_SIZE_PX = 12;

export function normalizeChatFontSizePx(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CHAT_FONT_SIZE_PX;
  }

  return Math.min(MAX_CHAT_FONT_SIZE_PX, Math.max(MIN_CHAT_FONT_SIZE_PX, Math.round(value)));
}

const ChatFontSizePx = Schema.Number.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transformOrFail({
      decode: (value) => Effect.succeed(normalizeChatFontSizePx(value)),
      encode: (value) => Effect.succeed(normalizeChatFontSizePx(value)),
    }),
  ),
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_CHAT_FONT_SIZE_PX)),
);

export const ClientSettingsSchema = Schema.Struct({
  chatCodeFontFamily: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  chatFontSizePx: ChatFontSizePx,
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
  ),
  timestampFormat: TimestampFormat.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  uiFontFamily: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodexSettings = typeof CodexSettings.Type;

const makeClaudeCompatibleModelEndpointSettings = (defaultBaseUrl: string) =>
  Schema.Struct({
    baseUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(defaultBaseUrl))),
    authToken: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  });

export const ClaudeCompatibleModelEndpointSettings = makeClaudeCompatibleModelEndpointSettings("");
export type ClaudeCompatibleModelEndpointSettings =
  typeof ClaudeCompatibleModelEndpointSettings.Type;

export const ClaudeTransport = Schema.Literals(["sdk", "cli-stream"]);
export type ClaudeTransport = typeof ClaudeTransport.Type;

type ClaudeCompatibleModelEndpointKey =
  (typeof CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESETS)[number]["key"];

function makeDefaultClaudeCompatibleModelEndpoints() {
  const defaults = {} as Record<
    ClaudeCompatibleModelEndpointKey,
    ClaudeCompatibleModelEndpointSettings
  >;
  for (const preset of CLAUDE_COMPATIBLE_REMOTE_MODEL_PRESETS) {
    defaults[preset.key] = {
      baseUrl: preset.defaultBaseUrl,
      authToken: "",
    };
  }
  return defaults;
}

export const DEFAULT_CLAUDE_COMPATIBLE_MODEL_ENDPOINTS =
  makeDefaultClaudeCompatibleModelEndpoints();

const ClaudeCompatibleModelEndpoints = Schema.Record(
  Schema.String,
  ClaudeCompatibleModelEndpointSettings,
);

const ClaudeSettingsCurrent = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("claude"),
  transport: ClaudeTransport.pipe(Schema.withDecodingDefault(Effect.succeed("cli-stream"))),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  remoteEndpoints: ClaudeCompatibleModelEndpoints.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CLAUDE_COMPATIBLE_MODEL_ENDPOINTS)),
  ),
});

export const ClaudeSettings = ClaudeSettingsCurrent;
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const OpenCodeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("opencode"),
  serverUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  serverUsername: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  serverPassword: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type OpenCodeSettings = typeof OpenCodeSettings.Type;

export const DroidSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("droid"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type DroidSettings = typeof DroidSettings.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const satisfies ThreadEnvMode)),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        provider: "codex" as const,
        model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
      }),
    ),
  ),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    opencode: OpenCodeSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    droid: DroidSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const CodexModelOptionsPatch = Schema.Struct({
  reasoningEffort: Schema.optionalKey(CodexModelOptions.fields.reasoningEffort),
  fastMode: Schema.optionalKey(CodexModelOptions.fields.fastMode),
});

const ClaudeModelOptionsPatch = Schema.Struct({
  thinking: Schema.optionalKey(ClaudeModelOptions.fields.thinking),
  effort: Schema.optionalKey(ClaudeModelOptions.fields.effort),
  fastMode: Schema.optionalKey(ClaudeModelOptions.fields.fastMode),
  contextWindow: Schema.optionalKey(ClaudeModelOptions.fields.contextWindow),
});

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("codex")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(CodexModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ClaudeModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("opencode")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(
      Schema.Struct({
        ...OpenCodeModelOptions.fields,
      }),
    ),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("droid")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(
      Schema.Struct({
        ...DroidModelOptions.fields,
      }),
    ),
  }),
]);

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  homePath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  transport: Schema.optionalKey(ClaudeTransport),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
  remoteEndpoints: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        baseUrl: Schema.optionalKey(Schema.String),
        authToken: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});

const OpenCodeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  serverUrl: Schema.optionalKey(Schema.String),
  serverUsername: Schema.optionalKey(Schema.String),
  serverPassword: Schema.optionalKey(Schema.String),
});

const DroidSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(Schema.String),
      otlpMetricsUrl: Schema.optionalKey(Schema.String),
    }),
  ),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
      opencode: Schema.optionalKey(OpenCodeSettingsPatch),
      droid: Schema.optionalKey(DroidSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
