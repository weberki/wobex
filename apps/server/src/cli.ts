import { NetService } from "@wobex/shared/Net";
import { parsePersistedServerObservabilitySettings } from "@wobex/shared/serverSettings";
import {
  AuthSessionId,
  CommandId,
  OrchestrationReadModel,
  ProjectId,
  type ClientOrchestrationCommand,
} from "@wobex/contracts";
import {
  Config,
  Console,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  LogLevel,
  Option,
  Path,
  References,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PORT,
  deriveServerPaths,
  ensureServerDirectories,
  resolveStaticDir,
  ServerConfig,
  RuntimeMode,
  type ServerConfigShape,
  type StartupPresentation,
} from "./config";
import { readBootstrapEnvelope } from "./bootstrap";
import { expandHomePath, resolveBaseDir } from "./os-jank";
import { runServer } from "./server";
import { AuthControlPlaneRuntimeLive } from "./auth/Layers/AuthControlPlane.ts";
import {
  formatIssuedPairingCredential,
  formatIssuedSession,
  formatPairingCredentialList,
  formatSessionList,
} from "./cliAuthFormat";
import { AuthControlPlane, AuthControlPlaneShape } from "./auth/Services/AuthControlPlane.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import { getAutoBootstrapDefaultModelSelection } from "./serverRuntimeStartup";
import {
  clearPersistedServerRuntimeState,
  readPersistedServerRuntimeState,
} from "./serverRuntimeState";
import {
  clearRelayHostConnection,
  formatRelayHostConnectionStatus,
  readRelayHostConnection,
  saveRelayHostConnection,
} from "./relayHostConfig";
import { ensureRelayHostConnectionEnrollment } from "./relayHostEnrollment";
import {
  pollRelayHostPairingIntent,
  resolveRelayHostLabel,
  revokeRelayHostRegistration,
  startRelayHostPairingIntent,
} from "./relayHostRegistration";
import { refreshClaudeUsage } from "./claudeUsageProbe";
import { refreshCodexUsage } from "./codexUsageProbe";
import { formatLocalUsageSummary, readLocalUsageSummary } from "./localUsageCost";
import {
  formatProviderUsageResult,
  formatProviderUsageResults,
  withUsageSpinner,
} from "./usageCli";
import { WorkspacePaths } from "./workspace/Services/WorkspacePaths";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths";

const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const BootstrapEnvelopeSchema = Schema.Struct({
  mode: Schema.optional(RuntimeMode),
  port: Schema.optional(PortSchema),
  host: Schema.optional(Schema.String),
  wobexHome: Schema.optional(Schema.String),
  devUrl: Schema.optional(Schema.URLFromString),
  noBrowser: Schema.optional(Schema.Boolean),
  desktopBootstrapToken: Schema.optional(Schema.String),
  autoBootstrapProjectFromCwd: Schema.optional(Schema.Boolean),
  logWebSocketEvents: Schema.optional(Schema.Boolean),
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
});

const modeFlag = Flag.choice("mode", RuntimeMode.literals).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const baseDirFlag = Flag.string("base-dir").pipe(
  Flag.withDescription("Base directory path (equivalent to WOBEX_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
const bootstrapFdFlag = Flag.integer("bootstrap-fd").pipe(
  Flag.withSchema(Schema.Int),
  Flag.withDescription("Read one-time bootstrap secrets from the given file descriptor."),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to WOBEX_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

const EnvServerConfig = Config.all({
  logLevel: Config.logLevel("WOBEX_LOG_LEVEL").pipe(Config.withDefault("Info")),
  traceMinLevel: Config.logLevel("WOBEX_TRACE_MIN_LEVEL").pipe(Config.withDefault("Info")),
  traceTimingEnabled: Config.boolean("WOBEX_TRACE_TIMING_ENABLED").pipe(Config.withDefault(true)),
  traceFile: Config.string("WOBEX_TRACE_FILE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  traceMaxBytes: Config.int("WOBEX_TRACE_MAX_BYTES").pipe(Config.withDefault(10 * 1024 * 1024)),
  traceMaxFiles: Config.int("WOBEX_TRACE_MAX_FILES").pipe(Config.withDefault(10)),
  traceBatchWindowMs: Config.int("WOBEX_TRACE_BATCH_WINDOW_MS").pipe(Config.withDefault(200)),
  otlpTracesUrl: Config.string("WOBEX_OTLP_TRACES_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  otlpMetricsUrl: Config.string("WOBEX_OTLP_METRICS_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  otlpExportIntervalMs: Config.int("WOBEX_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  otlpServiceName: Config.string("WOBEX_OTLP_SERVICE_NAME").pipe(
    Config.withDefault("wobex-server"),
  ),
  mode: Config.schema(RuntimeMode, "WOBEX_MODE").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  port: Config.port("WOBEX_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("WOBEX_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  wobexHome: Config.string("WOBEX_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean("WOBEX_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  bootstrapFd: Config.int("WOBEX_BOOTSTRAP_FD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("WOBEX_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("WOBEX_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

interface CliServerFlags {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly baseDir: Option.Option<string>;
  readonly cwd: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly bootstrapFd: Option.Option<number>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

interface CliAuthLocationFlags {
  readonly baseDir: Option.Option<string>;
  readonly devUrl?: Option.Option<URL>;
}

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values);

const loadPersistedObservabilitySettings = Effect.fn(function* (settingsPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }

  const raw = yield* fs.readFileString(settingsPath).pipe(Effect.orElseSucceed(() => ""));
  return parsePersistedServerObservabilitySettings(raw);
});

export const resolveServerConfig = (
  flags: CliServerFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const { findAvailablePort } = yield* NetService;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const env = yield* EnvServerConfig;
    const normalizedFlags = {
      mode: flags.mode ?? Option.none(),
      port: flags.port ?? Option.none(),
      host: flags.host ?? Option.none(),
      baseDir: flags.baseDir ?? Option.none(),
      cwd: flags.cwd ?? Option.none(),
      devUrl: flags.devUrl ?? Option.none(),
      noBrowser: flags.noBrowser ?? Option.none(),
      bootstrapFd: flags.bootstrapFd ?? Option.none(),
      autoBootstrapProjectFromCwd: flags.autoBootstrapProjectFromCwd ?? Option.none(),
      logWebSocketEvents: flags.logWebSocketEvents ?? Option.none(),
    } satisfies CliServerFlags;
    const bootstrapFd = Option.getOrUndefined(normalizedFlags.bootstrapFd) ?? env.bootstrapFd;
    const bootstrapEnvelope =
      bootstrapFd !== undefined
        ? yield* readBootstrapEnvelope(BootstrapEnvelopeSchema, bootstrapFd)
        : Option.none();
    const bootstrap = Option.getOrUndefined(bootstrapEnvelope);

    const mode: RuntimeMode = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.mode,
        Option.fromUndefinedOr(env.mode),
        Option.fromUndefinedOr(bootstrap?.mode),
      ),
      () => "web",
    );

    const port = yield* Option.match(
      resolveOptionPrecedence(
        normalizedFlags.port,
        Option.fromUndefinedOr(env.port),
        Option.fromUndefinedOr(bootstrap?.port),
      ),
      {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      },
    );
    const devUrl = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.devUrl,
        Option.fromUndefinedOr(env.devUrl),
        Option.fromUndefinedOr(bootstrap?.devUrl),
      ),
      () => undefined,
    );
    const baseDir = yield* resolveBaseDir(
      Option.getOrUndefined(
        resolveOptionPrecedence(
          normalizedFlags.baseDir,
          Option.fromUndefinedOr(env.wobexHome),
          Option.fromUndefinedOr(bootstrap?.wobexHome),
        ),
      ),
    );
    const rawCwd = Option.getOrElse(normalizedFlags.cwd, () => process.cwd());
    const cwd = path.resolve(yield* expandHomePath(rawCwd.trim()));
    yield* fs.makeDirectory(cwd, { recursive: true });
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
    yield* ensureServerDirectories(derivedPaths);
    const persistedObservabilitySettings = yield* loadPersistedObservabilitySettings(
      derivedPaths.settingsPath,
    );
    const serverTracePath = env.traceFile ?? derivedPaths.serverTracePath;
    yield* fs.makeDirectory(path.dirname(serverTracePath), { recursive: true });
    const startupPresentation = options?.startupPresentation ?? "browser";
    const isHeadlessStartup = startupPresentation === "headless";
    const noBrowser = Option.getOrElse(
      resolveOptionPrecedence(
        isHeadlessStartup ? Option.some(true) : Option.none(),
        normalizedFlags.noBrowser,
        Option.fromUndefinedOr(env.noBrowser),
        Option.fromUndefinedOr(bootstrap?.noBrowser),
      ),
      () => mode === "desktop",
    );
    const desktopBootstrapToken = bootstrap?.desktopBootstrapToken;
    const autoBootstrapProjectFromCwd = Option.getOrElse(
      resolveOptionPrecedence(
        Option.fromUndefinedOr(options?.forceAutoBootstrapProjectFromCwd),
        isHeadlessStartup ? Option.some(false) : Option.none(),
        normalizedFlags.autoBootstrapProjectFromCwd,
        Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd),
        Option.fromUndefinedOr(bootstrap?.autoBootstrapProjectFromCwd),
      ),
      () => mode === "web",
    );
    const logWebSocketEvents = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.logWebSocketEvents,
        Option.fromUndefinedOr(env.logWebSocketEvents),
        Option.fromUndefinedOr(bootstrap?.logWebSocketEvents),
      ),
      () => Boolean(devUrl),
    );
    const staticDir = devUrl ? undefined : yield* resolveStaticDir();
    const host = Option.getOrElse(
      resolveOptionPrecedence(
        normalizedFlags.host,
        Option.fromUndefinedOr(env.host),
        Option.fromUndefinedOr(bootstrap?.host),
      ),
      () => (mode === "desktop" ? "127.0.0.1" : undefined),
    );
    const logLevel = Option.getOrElse(cliLogLevel, () => env.logLevel);

    const config: ServerConfigShape = {
      logLevel,
      traceMinLevel: env.traceMinLevel,
      traceTimingEnabled: env.traceTimingEnabled,
      traceBatchWindowMs: env.traceBatchWindowMs,
      traceMaxBytes: env.traceMaxBytes,
      traceMaxFiles: env.traceMaxFiles,
      otlpTracesUrl:
        env.otlpTracesUrl ??
        bootstrap?.otlpTracesUrl ??
        persistedObservabilitySettings.otlpTracesUrl,
      otlpMetricsUrl:
        env.otlpMetricsUrl ??
        bootstrap?.otlpMetricsUrl ??
        persistedObservabilitySettings.otlpMetricsUrl,
      otlpExportIntervalMs: env.otlpExportIntervalMs,
      otlpServiceName: env.otlpServiceName,
      mode,
      port,
      cwd,
      baseDir,
      ...derivedPaths,
      serverTracePath,
      host,
      staticDir,
      devUrl,
      noBrowser,
      startupPresentation,
      desktopBootstrapToken,
      autoBootstrapProjectFromCwd,
      logWebSocketEvents,
    };

    return config;
  });

const resolveCliAuthConfig = (
  flags: CliAuthLocationFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
) =>
  resolveServerConfig(
    {
      mode: Option.none(),
      port: Option.none(),
      host: Option.none(),
      baseDir: flags.baseDir,
      cwd: Option.none(),
      devUrl: flags.devUrl ?? Option.none(),
      noBrowser: Option.none(),
      bootstrapFd: Option.none(),
      autoBootstrapProjectFromCwd: Option.none(),
      logWebSocketEvents: Option.none(),
    },
    cliLogLevel,
  );

const DurationShorthandPattern = /^(?<value>\d+)(?<unit>ms|s|m|h|d|w)$/i;

const parseDurationInput = (value: string): Duration.Duration | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const shorthand = DurationShorthandPattern.exec(trimmed);
  const normalizedInput = shorthand?.groups
    ? (() => {
        const amountText = shorthand.groups.value;
        const unitText = shorthand.groups.unit;
        if (typeof amountText !== "string" || typeof unitText !== "string") {
          return null;
        }

        const amount = Number.parseInt(amountText, 10);
        if (!Number.isFinite(amount)) return null;

        switch (unitText.toLowerCase()) {
          case "ms":
            return `${amount} millis`;
          case "s":
            return `${amount} seconds`;
          case "m":
            return `${amount} minutes`;
          case "h":
            return `${amount} hours`;
          case "d":
            return `${amount} days`;
          case "w":
            return `${amount} weeks`;
          default:
            return null;
        }
      })()
    : (trimmed as Duration.Input);

  if (normalizedInput === null) return null;

  const decoded = Duration.fromInput(normalizedInput as Duration.Input);
  return Option.isSome(decoded) ? decoded.value : null;
};

const DurationFromString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Duration,
    SchemaTransformation.transformOrFail({
      decode: (value) => {
        const duration = parseDurationInput(value);
        if (duration !== null) {
          return Effect.succeed(duration);
        }
        return Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(value), {
            message: "Invalid duration. Use values like 5m, 1h, 30d, or 15 minutes.",
          }),
        );
      },
      encode: (duration) => Effect.succeed(Duration.format(duration)),
    }),
  ),
);

const runWithAuthControlPlane = <A, E>(
  flags: CliAuthLocationFlags,
  run: (authControlPlane: AuthControlPlaneShape) => Effect.Effect<A, E>,
  options?: {
    readonly quietLogs?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const minimumLogLevel = options?.quietLogs ? "Error" : config.logLevel;
    return yield* Effect.gen(function* () {
      const authControlPlane = yield* AuthControlPlane;
      return yield* run(authControlPlane);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(AuthControlPlaneRuntimeLive).pipe(
          Layer.provide(Layer.succeed(ServerConfig, config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
        ),
      ),
    );
  });

type ProjectMutationTarget = {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
};

type ProjectCommandExecutionMode = "live" | "offline";
type ProjectCliDispatchCommand = Extract<
  ClientOrchestrationCommand,
  { type: "project.create" | "project.meta.update" | "project.delete" }
>;

const ProjectCliRuntimeLive = Layer.mergeAll(
  WorkspacePathsLive,
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolverLive),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  ),
);

const PROJECT_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(1);
const OrchestrationHttpErrorResponse = Schema.Struct({
  error: Schema.String,
});

const withProjectCliSessionToken = <A, E, R>(
  authControlPlane: AuthControlPlaneShape,
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    authControlPlane.issueSession({
      role: "owner",
      label: "wobex project cli",
    }),
    (issued) => run(issued.token),
    (issued) => authControlPlane.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const withProjectCliLiveServerTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeout(PROJECT_CLI_LIVE_SERVER_TIMEOUT));

const runLiveServerRequest = <A, E extends Error, R>(
  request: HttpClientRequest.HttpClientRequest,
  handle: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient.execute(request);
    return yield* handle(response);
  }).pipe(withProjectCliLiveServerTimeout);

const decodeOrchestrationReadModelResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(OrchestrationReadModel)(response);

const readErrorMessageFromResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(OrchestrationHttpErrorResponse)(response).pipe(
    Effect.map((body) => body.error),
    Effect.catch(() => Effect.succeed(null)),
    Effect.map((body) => {
      if (typeof body === "string" && body.trim().length > 0) {
        return body;
      }
      return `Server request failed with status ${response.status}.`;
    }),
  );

const normalizeWorkspaceRootForProjectCommand = Effect.fn(
  "normalizeWorkspaceRootForProjectCommand",
)(function* (workspaceRoot: string) {
  const workspacePaths = yield* WorkspacePaths;
  return yield* workspacePaths.normalizeWorkspaceRoot(workspaceRoot);
});

const resolveProjectTitle = Effect.fn("resolveProjectTitle")(function* (
  workspaceRoot: string,
  explicitTitle?: string,
) {
  if (explicitTitle !== undefined) {
    const trimmed = explicitTitle.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return yield* Effect.fail(new Error("Project title cannot be empty."));
  }

  const path = yield* Path.Path;
  const basename = path.basename(workspaceRoot).trim();
  return basename.length > 0 ? basename : "project";
});

const findActiveProjectTarget = Effect.fn("findActiveProjectTarget")(function* (input: {
  readonly snapshot: OrchestrationReadModel;
  readonly identifier: string;
}) {
  const trimmedIdentifier = input.identifier.trim();
  if (trimmedIdentifier.length === 0) {
    return yield* Effect.fail(new Error("Project identifier cannot be empty."));
  }

  const activeProjects = input.snapshot.projects.filter((project) => project.deletedAt === null);
  const exactIdMatch = activeProjects.find((project) => project.id === trimmedIdentifier);
  if (exactIdMatch) {
    return {
      id: exactIdMatch.id,
      title: exactIdMatch.title,
      workspaceRoot: exactIdMatch.workspaceRoot,
    } satisfies ProjectMutationTarget;
  }

  const normalizedWorkspaceRootResult = yield* Effect.exit(
    normalizeWorkspaceRootForProjectCommand(trimmedIdentifier),
  );
  const normalizedWorkspaceRoot = Exit.isSuccess(normalizedWorkspaceRootResult)
    ? normalizedWorkspaceRootResult.value
    : null;

  const exactWorkspaceMatch =
    normalizedWorkspaceRoot === null
      ? undefined
      : activeProjects.find((project) => project.workspaceRoot === normalizedWorkspaceRoot);

  const resolved = exactWorkspaceMatch;
  if (!resolved) {
    return yield* Effect.fail(new Error(`No active project found for '${trimmedIdentifier}'.`));
  }

  return {
    id: resolved.id,
    title: resolved.title,
    workspaceRoot: resolved.workspaceRoot,
  } satisfies ProjectMutationTarget;
});

const fetchLiveOrchestrationSnapshot = (origin: string, bearerToken: string) =>
  runLiveServerRequest(
    HttpClientRequest.get(`${origin}/api/orchestration/snapshot`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(bearerToken),
    ),
    HttpClientResponse.matchStatus({
      "2xx": decodeOrchestrationReadModelResponse,
      orElse: (response) =>
        readErrorMessageFromResponse(response).pipe(
          Effect.flatMap((message) => Effect.fail(new Error(message))),
        ),
    }),
  );

const dispatchLiveOrchestrationCommand = (
  origin: string,
  bearerToken: string,
  command: ProjectCliDispatchCommand,
) =>
  HttpClientRequest.post(`${origin}/api/orchestration/dispatch`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(bearerToken),
    HttpClientRequest.bodyJson(command),
    Effect.flatMap((request) =>
      runLiveServerRequest(
        request,
        HttpClientResponse.matchStatus({
          "2xx": () => Effect.void,
          orElse: (response) =>
            readErrorMessageFromResponse(response).pipe(
              Effect.flatMap((message) => Effect.fail(new Error(message))),
            ),
        }),
      ),
    ),
  );

const getOfflineSnapshot = Effect.fn("getOfflineSnapshot")(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  return yield* projectionSnapshotQuery.getSnapshot();
});

const tryResolveLiveProjectExecutionMode = Effect.fn("tryResolveLiveProjectExecutionMode")(
  function* (authControlPlane: AuthControlPlaneShape, config: ServerConfigShape) {
    const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) {
      return Option.none<{ readonly origin: string }>();
    }

    const attempt = withProjectCliSessionToken(authControlPlane, (token) =>
      fetchLiveOrchestrationSnapshot(runtimeState.value.origin, token).pipe(
        Effect.as({
          origin: runtimeState.value.origin,
        }),
      ),
    );

    const attempted = yield* Effect.exit(attempt);
    if (Exit.isSuccess(attempted)) {
      return Option.some(attempted.value);
    }

    yield* clearPersistedServerRuntimeState(config.serverRuntimeStatePath);
    return Option.none<{ readonly origin: string }>();
  },
);

const runProjectMutation = Effect.fn("runProjectMutation")(function* (
  flags: CliAuthLocationFlags,
  run: (input: {
    readonly snapshot: OrchestrationReadModel;
    readonly dispatch: (
      command: ProjectCliDispatchCommand,
    ) => Effect.Effect<void, Error, FileSystem.FileSystem | HttpClient.HttpClient | Path.Path>;
    readonly mode: ProjectCommandExecutionMode;
  }) => Effect.Effect<
    string,
    Error,
    FileSystem.FileSystem | HttpClient.HttpClient | Path.Path | WorkspacePaths
  >,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = config.logLevel;

  return yield* Effect.gen(function* () {
    const authControlPlane = yield* AuthControlPlane;
    const liveMode = yield* tryResolveLiveProjectExecutionMode(authControlPlane, config);

    if (Option.isSome(liveMode)) {
      return yield* withProjectCliSessionToken(authControlPlane, (token) =>
        Effect.gen(function* () {
          const snapshot = yield* fetchLiveOrchestrationSnapshot(liveMode.value.origin, token);
          const output = yield* run({
            snapshot,
            dispatch: (command) =>
              dispatchLiveOrchestrationCommand(liveMode.value.origin, token, command),
            mode: "live",
          });
          yield* Console.log(output);
        }),
      );
    }

    const offlineRuntimeLayer = ProjectCliRuntimeLive.pipe(
      Layer.provide(Layer.succeed(ServerConfig, config)),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
    );

    return yield* Effect.gen(function* () {
      const snapshot = yield* getOfflineSnapshot();
      const orchestrationEngine = yield* OrchestrationEngineService;
      const output = yield* run({
        snapshot,
        dispatch: (command) => orchestrationEngine.dispatch(command),
        mode: "offline",
      });
      yield* Console.log(output);
    }).pipe(Effect.provide(offlineRuntimeLayer));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(AuthControlPlaneRuntimeLive, WorkspacePathsLive).pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(ServerConfig, config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      ),
    ),
  );
});

const sharedServerLocationFlags = {
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
} as const;

const projectLocationFlags = {
  baseDir: baseDirFlag,
} as const;

const sharedServerCommandFlags = {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  baseDir: baseDirFlag,
  cwd: Argument.string("cwd").pipe(
    Argument.withDescription(
      "Working directory for provider sessions (defaults to the current directory).",
    ),
    Argument.optional,
  ),
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  bootstrapFd: bootstrapFdFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
} as const;

const authLocationFlags = sharedServerLocationFlags;

const ttlFlag = Flag.string("ttl").pipe(
  Flag.withSchema(DurationFromString),
  Flag.withDescription("TTL, for example `5m`, `1h`, `30d`, or `15 minutes`."),
  Flag.optional,
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const usageCwdFlag = Flag.string("cwd").pipe(
  Flag.withDescription("Working directory used to launch the temporary Claude tmux probe."),
  Flag.optional,
);

const usageCachedFlag = Flag.boolean("cached").pipe(
  Flag.withDescription(
    "Allow the in-process 10 minute usage cache instead of forcing a fresh probe.",
  ),
  Flag.withDefault(false),
);

const usageWatchFlag = Flag.string("watch").pipe(
  Flag.withDescription("Refresh usage repeatedly, for example `10m`, `600s`, or `600`."),
  Flag.optional,
);

const usageSinceDaysFlag = Flag.integer("since-days").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  Flag.withDescription("Lookback window for local session-file token totals."),
  Flag.withDefault(30),
);

function resolveDefaultClaudeUsageCwd(): string {
  const envCwd = process.env.WOBEX_CLAUDE_USAGE_CWD ?? process.env.WOBEX_USAGE_CWD;
  if (envCwd && envCwd.trim().length > 0) {
    return envCwd;
  }
  return dirname(fileURLToPath(import.meta.url));
}

const WatchDurationPattern = /^(?<value>\d+)(?<unit>ms|s|m|h)?$/i;

function parseUsageWatchMillis(value: string): number {
  const trimmed = value.trim();
  const match = WatchDurationPattern.exec(trimmed);
  if (!match?.groups) {
    throw new Error("Invalid --watch value. Use values like 10m, 600s, or 600.");
  }
  const amount = Number.parseInt(match.groups.value ?? "", 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid --watch value. Use a positive duration.");
  }
  switch ((match.groups.unit ?? "s").toLowerCase()) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 60 * 60_000;
    default:
      throw new Error("Invalid --watch value. Use values like 10m, 600s, or 600.");
  }
}

function localUsageSince(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function sleepUsageWatch(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const sessionRoleFlag = Flag.choice("role", ["owner", "client"]).pipe(
  Flag.withDescription("Role for the issued bearer session."),
  Flag.withDefault("client"),
);

const labelFlag = Flag.string("label").pipe(
  Flag.withDescription("Optional human-readable label."),
  Flag.optional,
);

const subjectFlag = Flag.string("subject").pipe(
  Flag.withDescription("Optional session subject."),
  Flag.optional,
);

const baseUrlFlag = Flag.string("base-url").pipe(
  Flag.withDescription("Optional public base URL used to print a ready `/pair#token=...` link."),
  Flag.optional,
);

const tokenOnlyFlag = Flag.boolean("token-only").pipe(
  Flag.withDescription("Print only the issued bearer token."),
  Flag.withDefault(false),
);

const pairingCreateCommand = Command.make("create", {
  ...authLocationFlags,
  ttl: ttlFlag,
  label: labelFlag,
  role: sessionRoleFlag,
  baseUrl: baseUrlFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Issue a new pairing token. Defaults to agent-control client access."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const issued = yield* authControlPlane.createPairingLink({
            role: flags.role,
            subject: flags.role === "owner" ? "owner-pairing-token" : "one-time-token",
            ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
            ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
          });
          const output = formatIssuedPairingCredential(issued, {
            json: flags.json,
            ...(Option.isSome(flags.baseUrl) ? { baseUrl: flags.baseUrl.value } : {}),
          });
          yield* Console.log(output);
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const pairingListCommand = Command.make("list", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List active pairing tokens without revealing their secrets."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const pairingLinks = yield* authControlPlane.listPairingLinks({
            excludeSubjects: ["owner-bootstrap"],
          });
          yield* Console.log(formatPairingCredentialList(pairingLinks, { json: flags.json }));
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const pairingRevokeCommand = Command.make("revoke", {
  ...authLocationFlags,
  id: Argument.string("id").pipe(Argument.withDescription("Pairing credential id to revoke.")),
}).pipe(
  Command.withDescription("Revoke an active client pairing token."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(flags, (authControlPlane) =>
      Effect.gen(function* () {
        const revoked = yield* authControlPlane.revokePairingLink(flags.id);
        yield* Console.log(
          revoked
            ? `Revoked pairing credential ${flags.id}.\n`
            : `No active pairing credential found for ${flags.id}.\n`,
        );
      }),
    ),
  ),
);

const pairingCommand = Command.make("pairing").pipe(
  Command.withDescription("Manage one-time pairing tokens."),
  Command.withSubcommands([pairingCreateCommand, pairingListCommand, pairingRevokeCommand]),
);

const sessionIssueCommand = Command.make("issue", {
  ...authLocationFlags,
  ttl: ttlFlag,
  role: sessionRoleFlag,
  label: labelFlag,
  subject: subjectFlag,
  tokenOnly: tokenOnlyFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Issue a bearer session token for headless or remote clients."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const issued = yield* authControlPlane.issueSession({
            role: flags.role,
            ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
            ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
            ...(Option.isSome(flags.subject) ? { subject: flags.subject.value } : {}),
          });
          yield* Console.log(
            formatIssuedSession(issued, {
              json: flags.json,
              tokenOnly: flags.tokenOnly,
            }),
          );
        }),
      {
        quietLogs: flags.json || flags.tokenOnly,
      },
    ),
  ),
);

const sessionListCommand = Command.make("list", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List active sessions without revealing bearer tokens."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(
      flags,
      (authControlPlane) =>
        Effect.gen(function* () {
          const sessions = yield* authControlPlane.listSessions();
          yield* Console.log(formatSessionList(sessions, { json: flags.json }));
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const sessionRevokeCommand = Command.make("revoke", {
  ...authLocationFlags,
  sessionId: Argument.string("session-id").pipe(
    Argument.withDescription("Session id to revoke."),
    Argument.withSchema(AuthSessionId),
  ),
}).pipe(
  Command.withDescription("Revoke an active session."),
  Command.withHandler((flags) =>
    runWithAuthControlPlane(flags, (authControlPlane) =>
      Effect.gen(function* () {
        const revoked = yield* authControlPlane.revokeSession(flags.sessionId);
        yield* Console.log(
          revoked
            ? `Revoked session ${flags.sessionId}.\n`
            : `No active session found for ${flags.sessionId}.\n`,
        );
      }),
    ),
  ),
);

const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Manage bearer sessions."),
  Command.withSubcommands([sessionIssueCommand, sessionListCommand, sessionRevokeCommand]),
);

const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage the local auth control plane for headless deployments."),
  Command.withSubcommands([pairingCommand, sessionCommand]),
);

const projectAddCommand = Command.make("add", {
  ...projectLocationFlags,
  workspaceRoot: Argument.string("path").pipe(
    Argument.withDescription("Workspace root to add as a project."),
  ),
  title: Flag.string("title").pipe(Flag.withDescription("Optional project title."), Flag.optional),
}).pipe(
  Command.withDescription("Add a project."),
  Command.withHandler((flags) =>
    runProjectMutation(
      flags,
      Effect.fn("projectAddMutation")(function* ({
        snapshot,
        dispatch,
      }: {
        readonly snapshot: OrchestrationReadModel;
        readonly dispatch: (
          command: ProjectCliDispatchCommand,
        ) => Effect.Effect<void, Error, FileSystem.FileSystem | HttpClient.HttpClient | Path.Path>;
      }) {
        const workspaceRoot = yield* normalizeWorkspaceRootForProjectCommand(flags.workspaceRoot);
        const existingProject = snapshot.projects.find(
          (project) => project.deletedAt === null && project.workspaceRoot === workspaceRoot,
        );
        if (existingProject) {
          return yield* Effect.fail(
            new Error(`An active project already exists for '${workspaceRoot}'.`),
          );
        }

        const title = yield* resolveProjectTitle(workspaceRoot, Option.getOrUndefined(flags.title));
        const projectId = ProjectId.make(crypto.randomUUID());
        yield* dispatch({
          type: "project.create",
          commandId: CommandId.make(crypto.randomUUID()),
          projectId,
          title,
          workspaceRoot,
          defaultModelSelection: getAutoBootstrapDefaultModelSelection(),
          createdAt: new Date().toISOString(),
        });
        return `Added project ${projectId} (${title}) at ${workspaceRoot}.`;
      }),
    ),
  ),
);

const projectRemoveCommand = Command.make("remove", {
  ...projectLocationFlags,
  project: Argument.string("project").pipe(
    Argument.withDescription("Project id or workspace root to remove."),
  ),
}).pipe(
  Command.withDescription("Remove a project."),
  Command.withHandler((flags) =>
    runProjectMutation(
      flags,
      Effect.fn("projectRemoveMutation")(function* ({
        snapshot,
        dispatch,
      }: {
        readonly snapshot: OrchestrationReadModel;
        readonly dispatch: (
          command: ProjectCliDispatchCommand,
        ) => Effect.Effect<void, Error, FileSystem.FileSystem | HttpClient.HttpClient | Path.Path>;
      }) {
        const project = yield* findActiveProjectTarget({
          snapshot,
          identifier: flags.project,
        });
        yield* dispatch({
          type: "project.delete",
          commandId: CommandId.make(crypto.randomUUID()),
          projectId: project.id,
        });
        return `Removed project ${project.id} (${project.title}).`;
      }),
    ),
  ),
);

const projectRenameCommand = Command.make("rename", {
  ...projectLocationFlags,
  project: Argument.string("project").pipe(
    Argument.withDescription("Project id or workspace root to rename."),
  ),
  title: Argument.string("title").pipe(Argument.withDescription("New project title.")),
}).pipe(
  Command.withDescription("Rename a project."),
  Command.withHandler((flags) =>
    runProjectMutation(
      flags,
      Effect.fn("projectRenameMutation")(function* ({
        snapshot,
        dispatch,
      }: {
        readonly snapshot: OrchestrationReadModel;
        readonly dispatch: (
          command: ProjectCliDispatchCommand,
        ) => Effect.Effect<void, Error, FileSystem.FileSystem | HttpClient.HttpClient | Path.Path>;
      }) {
        const project = yield* findActiveProjectTarget({
          snapshot,
          identifier: flags.project,
        });
        const nextTitle = yield* resolveProjectTitle(project.workspaceRoot, flags.title);
        if (nextTitle === project.title) {
          return `Project ${project.id} is already named ${nextTitle}.`;
        }

        yield* dispatch({
          type: "project.meta.update",
          commandId: CommandId.make(crypto.randomUUID()),
          projectId: project.id,
          title: nextTitle,
        });
        return `Renamed project ${project.id} to ${nextTitle}.`;
      }),
    ),
  ),
);

const projectCommand = Command.make("project").pipe(
  Command.withDescription("Manage projects."),
  Command.withSubcommands([projectAddCommand, projectRemoveCommand, projectRenameCommand]),
);

const relayUrlFlag = Flag.string("relay-url").pipe(
  Flag.withDescription("Public Relay URL, for example https://code.example.com."),
);
const relayHostIdFlag = Flag.string("host-id").pipe(
  Flag.withDescription("Relay-issued host id from host registration approval."),
  Flag.optional,
);
const relayRegistrationTokenFlag = Flag.string("registration-token").pipe(
  Flag.withDescription("Relay-issued host registration token. Stored locally and never printed."),
  Flag.optional,
);

const runCloudConfigCommand = <A>(
  flags: CliAuthLocationFlags,
  run: (config: ServerConfigShape) => Effect.Effect<A, Error>,
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    return yield* run(config);
  });

const cloudConnectCommand = Command.make("connect", {
  ...projectLocationFlags,
  relayUrl: relayUrlFlag,
  hostId: relayHostIdFlag,
  registrationToken: relayRegistrationTokenFlag,
}).pipe(
  Command.withDescription("Store Relay host registration settings for outbound cloud access."),
  Command.withHandler((flags) =>
    runCloudConfigCommand(flags, (config) =>
      Effect.gen(function* () {
        const hostId = Option.getOrUndefined(flags.hostId);
        const registrationToken = Option.getOrUndefined(flags.registrationToken);

        if ((registrationToken && !hostId) || (hostId && !registrationToken)) {
          return yield* Effect.fail(
            new Error("host-id and registration-token must be provided together."),
          );
        }

        if (hostId && registrationToken) {
          const saved = yield* Effect.promise(() =>
            saveRelayHostConnection({
              secretsDir: config.secretsDir,
              relayUrl: flags.relayUrl,
              hostId,
              registrationToken,
            }),
          );
          const enrolled = yield* Effect.promise(() =>
            ensureRelayHostConnectionEnrollment({
              secretsDir: config.secretsDir,
              connection: saved,
            }),
          );
          return yield* Console.log(
            [
              "Relay cloud connection saved.",
              `Relay: ${enrolled.relayUrl}`,
              `Host: ${enrolled.hostId}`,
              "Registration token: stored locally and hidden",
              "Host key: configured",
            ].join("\n"),
          );
        }

        const intent = yield* Effect.promise(() =>
          startRelayHostPairingIntent({
            relayUrl: flags.relayUrl,
            hostLabel: resolveRelayHostLabel(),
          }),
        );
        yield* Console.log(
          [
            "Relay pairing intent created.",
            `Device code: ${intent.deviceCode}`,
            `Approval URL: ${intent.approvalUrl}`,
          ].join("\n"),
        );
        const approved = yield* Effect.promise(() =>
          pollRelayHostPairingIntent({
            relayUrl: flags.relayUrl,
            intentId: intent.intent.id,
          }),
        );
        const saved = yield* Effect.promise(() =>
          saveRelayHostConnection({
            secretsDir: config.secretsDir,
            relayUrl: flags.relayUrl,
            hostId: approved.host.id,
            registrationToken: approved.registrationToken.token,
            ...(approved.trustedRelaySigningKeyId !== undefined
              ? { trustedRelaySigningKeyId: approved.trustedRelaySigningKeyId }
              : {}),
            ...(approved.trustedRelaySigningKey !== undefined
              ? { trustedRelaySigningKey: approved.trustedRelaySigningKey }
              : {}),
          }),
        );
        const enrolled = yield* Effect.promise(() =>
          ensureRelayHostConnectionEnrollment({
            secretsDir: config.secretsDir,
            connection: saved,
          }),
        );
        return yield* Console.log(
          [
            "Relay cloud connection saved.",
            `Relay: ${enrolled.relayUrl}`,
            `Host: ${enrolled.hostId}`,
            "Registration token: stored locally and hidden",
            "Host key: configured",
          ].join("\n"),
        );
      }),
    ),
  ),
);

const cloudStatusCommand = Command.make("status", {
  ...projectLocationFlags,
}).pipe(
  Command.withDescription("Show local Relay cloud connection status without revealing secrets."),
  Command.withHandler((flags) =>
    runCloudConfigCommand(flags, (config) =>
      Effect.promise(() => readRelayHostConnection(config.secretsDir)).pipe(
        Effect.flatMap((connection) => Console.log(formatRelayHostConnectionStatus(connection))),
      ),
    ),
  ),
);

const cloudDisconnectCommand = Command.make("disconnect", {
  ...projectLocationFlags,
  revoke: Flag.boolean("revoke").pipe(
    Flag.withDescription("Ask Relay to revoke the host before removing the local config."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Remove the local Relay host registration token."),
  Command.withHandler((flags) =>
    runCloudConfigCommand(flags, (config) =>
      Effect.gen(function* () {
        const connection = yield* Effect.promise(() => readRelayHostConnection(config.secretsDir));
        if (!connection) {
          return yield* Console.log("Relay cloud connection was not configured.");
        }

        if (Option.getOrElse(flags.revoke, () => false)) {
          yield* Effect.promise(() =>
            revokeRelayHostRegistration({
              relayUrl: connection.relayUrl,
              hostId: connection.hostId,
              registrationToken: connection.registrationToken,
            }),
          );
        }

        const removed = yield* Effect.promise(() => clearRelayHostConnection(config.secretsDir));
        return yield* Console.log(
          removed
            ? "Relay cloud connection removed."
            : "Relay cloud connection was not configured.",
        );
      }),
    ),
  ),
);

const cloudCommand = Command.make("cloud").pipe(
  Command.withDescription("Manage outbound Relay cloud access for this host."),
  Command.withSubcommands([cloudConnectCommand, cloudStatusCommand, cloudDisconnectCommand]),
);

const usageClaudeCommand = Command.make("claude", {
  cwd: usageCwdFlag,
  json: jsonFlag,
  cached: usageCachedFlag,
}).pipe(
  Command.withDescription("Read Claude /usage through a temporary tmux session."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        withUsageSpinner(
          "Loading Usage",
          () =>
            refreshClaudeUsage({
              provider: "claudeAgent",
              cwd: Option.getOrUndefined(flags.cwd) ?? resolveDefaultClaudeUsageCwd(),
              force: !flags.cached,
            }),
          !flags.json,
        ),
      );
      yield* Console.log(
        flags.json ? JSON.stringify(result, null, 2) : formatProviderUsageResult(result),
      );
    }),
  ),
);

const usageCodexCommand = Command.make("codex", {
  json: jsonFlag,
  cached: usageCachedFlag,
}).pipe(
  Command.withDescription("Read Codex rate limits through the local app-server."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        withUsageSpinner(
          "Loading Usage",
          () =>
            refreshCodexUsage({
              provider: "codex",
              force: !flags.cached,
            }),
          !flags.json,
        ),
      );
      yield* Console.log(
        flags.json ? JSON.stringify(result, null, 2) : formatProviderUsageResult(result),
      );
    }),
  ),
);

const usageLocalCommand = Command.make("local", {
  json: jsonFlag,
  sinceDays: usageSinceDaysFlag,
}).pipe(
  Command.withDescription("Compare local Codex and Claude token totals from session files."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const summary = yield* Effect.promise(() =>
        readLocalUsageSummary({
          since: localUsageSince(flags.sinceDays),
        }),
      );
      yield* Console.log(
        flags.json ? JSON.stringify(summary, null, 2) : formatLocalUsageSummary(summary),
      );
    }),
  ),
);

const usageAllCommand = Command.make("all", {
  cwd: usageCwdFlag,
  json: jsonFlag,
  cached: usageCachedFlag,
  watch: usageWatchFlag,
  sinceDays: usageSinceDaysFlag,
}).pipe(
  Command.withDescription("Read Claude, Codex, and local usage comparison in one view."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const watchValue = Option.getOrUndefined(flags.watch);
      const watchMs = watchValue ? parseUsageWatchMillis(watchValue) : null;
      const renderOnce = async () => {
        const [claude, codex, local] = await withUsageSpinner(
          "Loading Usage",
          () =>
            Promise.all([
              refreshClaudeUsage({
                provider: "claudeAgent",
                cwd: Option.getOrUndefined(flags.cwd) ?? resolveDefaultClaudeUsageCwd(),
                force: !flags.cached,
              }),
              refreshCodexUsage({
                provider: "codex",
                force: !flags.cached,
              }),
              readLocalUsageSummary({
                since: localUsageSince(flags.sinceDays),
              }),
            ]),
          !flags.json,
        );

        if (flags.json) {
          return JSON.stringify(
            {
              providers: [claude, codex],
              localUsage: local,
            },
            null,
            2,
          );
        }

        return `${formatProviderUsageResults([claude, codex])}\n\n${formatLocalUsageSummary(local)}`;
      };

      if (watchMs === null) {
        yield* Console.log(yield* Effect.promise(renderOnce));
        return;
      }

      return yield* Effect.promise(async () => {
        for (;;) {
          const output = await renderOnce();
          process.stdout.write(
            `\u001b[2J\u001b[H${output}\n\nNext refresh in ${Math.round(watchMs / 1000)}s. Press Ctrl-C to stop.\n`,
          );
          await sleepUsageWatch(watchMs);
        }
      });
    }),
  ),
);

const usageCommand = Command.make("usage").pipe(
  Command.withDescription("Read provider usage without provider API calls."),
  Command.withSubcommands([
    usageClaudeCommand,
    usageCodexCommand,
    usageLocalCommand,
    usageAllCommand,
  ]),
);

const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveServerConfig(flags, logLevel, options);
    return yield* runServer.pipe(Effect.provideService(ServerConfig, config));
  });

const startCommand = Command.make("start", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the Wobex server."),
  Command.withHandler((flags) => runServerCommand(flags)),
);

const serveCommand = Command.make("serve", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription(
    "Run the Wobex server without opening a browser and print headless pairing details.",
  ),
  Command.withHandler((flags) =>
    runServerCommand(flags, {
      startupPresentation: "headless",
      forceAutoBootstrapProjectFromCwd: false,
    }),
  ),
);

export const makeCli = (commandName = "wobex") =>
  Command.make(commandName, { ...sharedServerCommandFlags }).pipe(
    Command.withDescription("Run the Wobex server."),
    Command.withHandler((flags) => runServerCommand(flags)),
    Command.withSubcommands([
      startCommand,
      serveCommand,
      authCommand,
      projectCommand,
      cloudCommand,
      usageCommand,
    ]),
  );

export const cli = makeCli("wobex");
