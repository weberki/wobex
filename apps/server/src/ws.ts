import { Cause, Effect, Layer, Queue, Ref, Schema, Stream } from "effect";
import {
  type AuthAccessStreamEvent,
  AuthCapabilityError,
  type AuthSessionCapability,
  AuthSessionId,
  CommandId,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectListTreeError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ServerImageGenerationError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@wobex/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ObservabilityService } from "./observability/Services/ObservabilityService";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ProviderDiscoveryService } from "./provider/Services/ProviderDiscoveryService";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
} from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment";
import { ServerAuth } from "./auth/Services/ServerAuth";
import type { AuthenticatedSession } from "./auth/Services/ServerAuth";
import { DevServerManager } from "./devServers/Services/DevServerManager";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService";
import { refreshClaudeUsage } from "./claudeUsageProbe";
import { respondToAuthError } from "./auth/http";
import { requiredCapabilityForWsOrchestrationCommand } from "./wsAuthorization";
import { runCodexImagegenServerTool } from "./devTools/codexImagegen";

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const makeWsRpcLayer = (session: AuthenticatedSession) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = session.sessionId;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const gitManager = yield* GitManager;
      const git = yield* GitCore;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment;
      const providerDiscovery = yield* ProviderDiscoveryService;
      const serverAuth = yield* ServerAuth;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const devServerManager = yield* DevServerManager;
      const observability = yield* ObservabilityService;
      const serverCommandId = (tag: string) =>
        CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

      const authCapabilityError = (method: string, requiredCapability: AuthSessionCapability) =>
        new AuthCapabilityError({
          message: `Session is missing required capability: ${requiredCapability}`,
          method,
          requiredCapability,
        });

      const hasCapability = (capability: AuthSessionCapability) =>
        session.capabilities.includes(capability);

      const requireCapability = (
        method: string,
        capability: AuthSessionCapability,
      ): Effect.Effect<void, AuthCapabilityError> =>
        hasCapability(capability)
          ? Effect.void
          : Effect.fail(authCapabilityError(method, capability));

      const authorizeEffect = <A, E, R>(
        method: string,
        capability: AuthSessionCapability,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | AuthCapabilityError, R> =>
        requireCapability(method, capability).pipe(Effect.flatMap(() => effect));

      const authorizeStream = <A, E, R>(
        method: string,
        capability: AuthSessionCapability,
        stream: Stream.Stream<A, E, R>,
      ): Stream.Stream<A, E | AuthCapabilityError, R> =>
        hasCapability(capability) ? stream : Stream.fail(authCapabilityError(method, capability));

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                (yield* orchestrationEngine.getReadModel()).projects.find(
                  (project) => project.id === event.payload.projectId,
                )?.workspaceRoot ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            });
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: new Date().toISOString(),
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail:
                      error instanceof Error
                        ? error.message
                        : "Unknown setup activity dispatch failure.",
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* git.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                branch: bootstrap.prepareWorktree.baseBranch,
                newBranch: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.branch,
                worktreePath: targetWorktreePath,
              });
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = yield* serverSettings.getSettings;
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        gitStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getSnapshot,
            authorizeEffect(
              ORCHESTRATION_WS_METHODS.getSnapshot,
              "chat:read",
              projectionSnapshotQuery.getBoundedSnapshot().pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration snapshot",
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              yield* requireCapability(
                ORCHESTRATION_WS_METHODS.dispatchCommand,
                requiredCapabilityForWsOrchestrationCommand(command),
              );
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationDispatchCommandError)(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            authorizeEffect(
              ORCHESTRATION_WS_METHODS.getTurnDiff,
              "chat:read",
              checkpointDiffQuery.getTurnDiff(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetTurnDiffError({
                      message: "Failed to load turn diff",
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            authorizeEffect(
              ORCHESTRATION_WS_METHODS.getFullThreadDiff,
              "chat:read",
              checkpointDiffQuery.getFullThreadDiff(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetFullThreadDiffError({
                      message: "Failed to load full thread diff",
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            authorizeEffect(
              ORCHESTRATION_WS_METHODS.replayEvents,
              "chat:read",
              Stream.runCollect(
                orchestrationEngine.readEvents(
                  clamp(input.fromSequenceExclusive, {
                    maximum: Number.MAX_SAFE_INTEGER,
                    minimum: 0,
                  }),
                ),
              ).pipe(
                Effect.map((events) => Array.from(events)),
                Effect.flatMap(enrichOrchestrationEvents),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationReplayEventsError({
                      message: "Failed to replay orchestration events",
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeOrchestrationDomainEvents,
            requireCapability(WS_METHODS.subscribeOrchestrationDomainEvents, "chat:read").pipe(
              Effect.flatMap(() =>
                Effect.gen(function* () {
                  const snapshot = yield* orchestrationEngine.getReadModel();
                  const fromSequenceExclusive = snapshot.snapshotSequence;
                  const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
                    orchestrationEngine.readEvents(fromSequenceExclusive),
                  ).pipe(
                    Effect.map((events) => Array.from(events)),
                    Effect.flatMap(enrichOrchestrationEvents),
                    Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
                  );
                  const replayStream = Stream.fromIterable(replayEvents);
                  const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                    Stream.mapEffect(enrichProjectEvent),
                  );
                  const source = Stream.merge(replayStream, liveStream);
                  type SequenceState = {
                    readonly nextSequence: number;
                    readonly pendingBySequence: Map<number, OrchestrationEvent>;
                  };
                  const state = yield* Ref.make<SequenceState>({
                    nextSequence: fromSequenceExclusive + 1,
                    pendingBySequence: new Map<number, OrchestrationEvent>(),
                  });

                  return source.pipe(
                    Stream.mapEffect((event) =>
                      Ref.modify(
                        state,
                        ({
                          nextSequence,
                          pendingBySequence,
                        }): [Array<OrchestrationEvent>, SequenceState] => {
                          if (
                            event.sequence < nextSequence ||
                            pendingBySequence.has(event.sequence)
                          ) {
                            return [[], { nextSequence, pendingBySequence }];
                          }

                          const updatedPending = new Map(pendingBySequence);
                          updatedPending.set(event.sequence, event);

                          const emit: Array<OrchestrationEvent> = [];
                          let expected = nextSequence;
                          for (;;) {
                            const expectedEvent = updatedPending.get(expected);
                            if (!expectedEvent) {
                              break;
                            }
                            emit.push(expectedEvent);
                            updatedPending.delete(expected);
                            expected += 1;
                          }

                          return [
                            emit,
                            { nextSequence: expected, pendingBySequence: updatedPending },
                          ];
                        },
                      ),
                    ),
                    Stream.flatMap((events) => Stream.fromIterable(events)),
                  );
                }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetConfig,
            authorizeEffect(WS_METHODS.serverGetConfig, "chat:read", loadServerConfig),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverRefreshProviders]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            authorizeEffect(
              WS_METHODS.serverRefreshProviders,
              "chat:read",
              providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverRefreshProviderUsage]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviderUsage,
            authorizeEffect(
              WS_METHODS.serverRefreshProviderUsage,
              "chat:read",
              Effect.promise(() => refreshClaudeUsage(input)),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGenerateImage]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGenerateImage,
            authorizeEffect(
              WS_METHODS.serverGenerateImage,
              "chat:write",
              Effect.tryPromise({
                try: () =>
                  runCodexImagegenServerTool({
                    request: input,
                    attachmentsDir: config.attachmentsDir,
                  }),
                catch: (error) =>
                  new ServerImageGenerationError({
                    message: error instanceof Error ? error.message : "Image generation failed.",
                  }),
              }),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            authorizeEffect(
              WS_METHODS.serverUpsertKeybinding,
              "settings:admin",
              Effect.gen(function* () {
                const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
                return { keybindings: keybindingsConfig, issues: [] };
              }),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSettings,
            authorizeEffect(WS_METHODS.serverGetSettings, "chat:read", serverSettings.getSettings),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSettings,
            authorizeEffect(
              WS_METHODS.serverUpdateSettings,
              "settings:admin",
              serverSettings.updateSettings(patch),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.observabilityGetOverview]: (_input) =>
          observeRpcEffect(
            WS_METHODS.observabilityGetOverview,
            authorizeEffect(
              WS_METHODS.observabilityGetOverview,
              "settings:admin",
              observability.getOverview(),
            ),
            {
              "rpc.aggregate": "observability",
            },
          ),
        [WS_METHODS.observabilityQueryLogs]: (input) =>
          observeRpcEffect(
            WS_METHODS.observabilityQueryLogs,
            authorizeEffect(
              WS_METHODS.observabilityQueryLogs,
              "settings:admin",
              observability.queryLogs(input),
            ),
            {
              "rpc.aggregate": "observability",
            },
          ),
        [WS_METHODS.observabilityQuerySpans]: (input) =>
          observeRpcEffect(
            WS_METHODS.observabilityQuerySpans,
            authorizeEffect(
              WS_METHODS.observabilityQuerySpans,
              "settings:admin",
              observability.querySpans(input),
            ),
            {
              "rpc.aggregate": "observability",
            },
          ),
        [WS_METHODS.observabilityGetThreadStats]: (input) =>
          observeRpcEffect(
            WS_METHODS.observabilityGetThreadStats,
            authorizeEffect(
              WS_METHODS.observabilityGetThreadStats,
              "settings:admin",
              observability.getThreadStats(input),
            ),
            {
              "rpc.aggregate": "observability",
            },
          ),
        [WS_METHODS.observabilityGetProviderStats]: (_input) =>
          observeRpcEffect(
            WS_METHODS.observabilityGetProviderStats,
            authorizeEffect(
              WS_METHODS.observabilityGetProviderStats,
              "settings:admin",
              observability.getProviderStats(),
            ),
            {
              "rpc.aggregate": "observability",
            },
          ),
        [WS_METHODS.observabilityClearLocalData]: (_input) =>
          observeRpcEffect(
            WS_METHODS.observabilityClearLocalData,
            authorizeEffect(
              WS_METHODS.observabilityClearLocalData,
              "settings:admin",
              observability.clearLocalData(),
            ),
            {
              "rpc.aggregate": "observability",
            },
          ),
        [WS_METHODS.devServersGetSnapshot]: (_input) =>
          observeRpcEffect(
            WS_METHODS.devServersGetSnapshot,
            authorizeEffect(
              WS_METHODS.devServersGetSnapshot,
              "terminal:read",
              devServerManager.getSnapshot(),
            ),
            {
              "rpc.aggregate": "dev-servers",
            },
          ),
        [WS_METHODS.devServersStart]: (input) =>
          observeRpcEffect(
            WS_METHODS.devServersStart,
            authorizeEffect(
              WS_METHODS.devServersStart,
              "terminal:write",
              devServerManager.start(input),
            ),
            {
              "rpc.aggregate": "dev-servers",
            },
          ),
        [WS_METHODS.devServersStop]: (input) =>
          observeRpcEffect(
            WS_METHODS.devServersStop,
            authorizeEffect(
              WS_METHODS.devServersStop,
              "terminal:write",
              devServerManager.stop(input),
            ),
            {
              "rpc.aggregate": "dev-servers",
            },
          ),
        [WS_METHODS.providerDiscoveryGetComposerCapabilities]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerDiscoveryGetComposerCapabilities,
            authorizeEffect(
              WS_METHODS.providerDiscoveryGetComposerCapabilities,
              "chat:read",
              providerDiscovery.getComposerCapabilities(input),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.providerDiscoveryListCommands]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerDiscoveryListCommands,
            authorizeEffect(
              WS_METHODS.providerDiscoveryListCommands,
              "chat:read",
              providerDiscovery.listCommands(input),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.providerDiscoveryListSkills]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerDiscoveryListSkills,
            authorizeEffect(
              WS_METHODS.providerDiscoveryListSkills,
              "chat:read",
              providerDiscovery.listSkills(input),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.providerDiscoveryListPlugins]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerDiscoveryListPlugins,
            authorizeEffect(
              WS_METHODS.providerDiscoveryListPlugins,
              "chat:read",
              providerDiscovery.listPlugins(input),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.providerDiscoveryReadPlugin]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerDiscoveryReadPlugin,
            authorizeEffect(
              WS_METHODS.providerDiscoveryReadPlugin,
              "chat:read",
              providerDiscovery.readPlugin(input),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.providerDiscoveryListModels]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerDiscoveryListModels,
            authorizeEffect(
              WS_METHODS.providerDiscoveryListModels,
              "chat:read",
              providerDiscovery.listModels(input),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            authorizeEffect(
              WS_METHODS.projectsSearchEntries,
              "files:read",
              workspaceEntries.search(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProjectSearchEntriesError({
                      message: `Failed to search workspace entries: ${cause.detail}`,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsListTree]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsListTree,
            authorizeEffect(
              WS_METHODS.projectsListTree,
              "files:read",
              workspaceEntries.listTree(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProjectListTreeError({
                      message: `Failed to list workspace tree: ${cause.detail}`,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsReadFile,
            authorizeEffect(
              WS_METHODS.projectsReadFile,
              "files:read",
              workspaceFileSystem.readFile(input).pipe(
                Effect.mapError((cause) =>
                  Schema.is(WorkspacePathOutsideRootError)(cause)
                    ? new ProjectReadFileError({
                        message: "Workspace file path must stay within the project root.",
                        cause,
                      })
                    : new ProjectReadFileError({
                        message: Schema.is(WorkspaceFileSystemError)(cause)
                          ? `Failed to read workspace file: ${cause.detail}`
                          : "Failed to read workspace file",
                        cause,
                      }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            authorizeEffect(
              WS_METHODS.projectsWriteFile,
              "files:write",
              workspaceFileSystem.writeFile(input).pipe(
                Effect.mapError((cause) => {
                  const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                    ? "Workspace file path must stay within the project root."
                    : "Failed to write workspace file";
                  return new ProjectWriteFileError({
                    message,
                    cause,
                  });
                }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(
            WS_METHODS.shellOpenInEditor,
            authorizeEffect(WS_METHODS.shellOpenInEditor, "files:read", open.openInEditor(input)),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.subscribeGitStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeGitStatus,
            authorizeStream(
              WS_METHODS.subscribeGitStatus,
              "git:read",
              gitStatusBroadcaster.streamStatus(input),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRefreshStatus,
            authorizeEffect(
              WS_METHODS.gitRefreshStatus,
              "git:read",
              gitStatusBroadcaster.refreshStatus(input.cwd),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitReadWorkingTreeDiff]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitReadWorkingTreeDiff,
            authorizeEffect(
              WS_METHODS.gitReadWorkingTreeDiff,
              "git:read",
              gitManager.readWorkingTreeDiff(input),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitSummarizeDiff]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitSummarizeDiff,
            authorizeEffect(
              WS_METHODS.gitSummarizeDiff,
              "git:read",
              gitManager.summarizeDiff(input),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPull,
            authorizeEffect(
              WS_METHODS.gitPull,
              "git:write",
              git.pullCurrentBranch(input.cwd).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Effect.failCause(cause),
                  onSuccess: (result) =>
                    refreshGitStatus(input.cwd).pipe(
                      Effect.ignore({ log: true }),
                      Effect.as(result),
                    ),
                }),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            authorizeStream(
              WS_METHODS.gitRunStackedAction,
              "git:write",
              Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
                gitManager
                  .runStackedAction(input, {
                    actionId: input.actionId,
                    progressReporter: {
                      publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                    },
                  })
                  .pipe(
                    Effect.matchCauseEffect({
                      onFailure: (cause) => Queue.failCause(queue, cause),
                      onSuccess: () =>
                        refreshGitStatus(input.cwd).pipe(
                          Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                        ),
                    }),
                  ),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            authorizeEffect(
              WS_METHODS.gitResolvePullRequest,
              "git:read",
              gitManager.resolvePullRequest(input),
            ),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            authorizeEffect(
              WS_METHODS.gitPreparePullRequestThread,
              "git:write",
              gitManager
                .preparePullRequestThread(input)
                .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitListBranches,
            authorizeEffect(WS_METHODS.gitListBranches, "git:read", git.listBranches(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktree,
            authorizeEffect(
              WS_METHODS.gitCreateWorktree,
              "git:write",
              git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRemoveWorktree,
            authorizeEffect(
              WS_METHODS.gitRemoveWorktree,
              "git:write",
              git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateBranch,
            authorizeEffect(
              WS_METHODS.gitCreateBranch,
              "git:write",
              git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCheckout,
            authorizeEffect(
              WS_METHODS.gitCheckout,
              "git:write",
              Effect.scoped(git.checkoutBranch(input)).pipe(
                Effect.tap(() => refreshGitStatus(input.cwd)),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitInit,
            authorizeEffect(
              WS_METHODS.gitInit,
              "git:write",
              git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalOpen,
            authorizeEffect(WS_METHODS.terminalOpen, "terminal:write", terminalManager.open(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalWrite,
            authorizeEffect(
              WS_METHODS.terminalWrite,
              "terminal:write",
              terminalManager.write(input),
            ),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalResize,
            authorizeEffect(
              WS_METHODS.terminalResize,
              "terminal:write",
              terminalManager.resize(input),
            ),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalClear,
            authorizeEffect(
              WS_METHODS.terminalClear,
              "terminal:write",
              terminalManager.clear(input),
            ),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalRestart,
            authorizeEffect(
              WS_METHODS.terminalRestart,
              "terminal:write",
              terminalManager.restart(input),
            ),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalClose,
            authorizeEffect(
              WS_METHODS.terminalClose,
              "terminal:write",
              terminalManager.close(input),
            ),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            authorizeStream(
              WS_METHODS.subscribeTerminalEvents,
              "terminal:read",
              Stream.callback<TerminalEvent>((queue) =>
                Effect.acquireRelease(
                  terminalManager.subscribe((event) => Queue.offer(queue, event)),
                  (unsubscribe) => Effect.sync(unsubscribe),
                ),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            requireCapability(WS_METHODS.subscribeServerConfig, "chat:read").pipe(
              Effect.flatMap(() =>
                Effect.gen(function* () {
                  const keybindingsUpdates = keybindings.streamChanges.pipe(
                    Stream.map((event) => ({
                      version: 1 as const,
                      type: "keybindingsUpdated" as const,
                      payload: {
                        issues: event.issues,
                      },
                    })),
                  );
                  const providerStatuses = providerRegistry.streamChanges.pipe(
                    Stream.map((providers) => ({
                      version: 1 as const,
                      type: "providerStatuses" as const,
                      payload: { providers },
                    })),
                  );
                  const settingsUpdates = serverSettings.streamChanges.pipe(
                    Stream.map((settings) => ({
                      version: 1 as const,
                      type: "settingsUpdated" as const,
                      payload: { settings },
                    })),
                  );

                  return Stream.concat(
                    Stream.make({
                      version: 1 as const,
                      type: "snapshot" as const,
                      config: yield* loadServerConfig,
                    }),
                    Stream.merge(
                      keybindingsUpdates,
                      Stream.merge(providerStatuses, settingsUpdates),
                    ),
                  );
                }),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            requireCapability(WS_METHODS.subscribeServerLifecycle, "chat:read").pipe(
              Effect.flatMap(() =>
                Effect.gen(function* () {
                  const snapshot = yield* lifecycleEvents.snapshot;
                  const snapshotEvents = Array.from(snapshot.events).toSorted(
                    (left, right) => left.sequence - right.sequence,
                  );
                  const liveEvents = lifecycleEvents.stream.pipe(
                    Stream.filter((event) => event.sequence > snapshot.sequence),
                  );
                  return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
                }),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            requireCapability(WS_METHODS.subscribeAuthAccess, "auth:admin").pipe(
              Effect.flatMap(() =>
                Effect.gen(function* () {
                  const initialSnapshot = yield* loadAuthAccessSnapshot();
                  const revisionRef = yield* Ref.make(1);
                  const accessChanges: Stream.Stream<
                    BootstrapCredentialChange | SessionCredentialChange
                  > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

                  const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                    Stream.mapEffect((change) =>
                      Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                        Effect.map((revision) =>
                          toAuthAccessStreamEvent(change, revision, currentSessionId),
                        ),
                      ),
                    ),
                  );

                  return Stream.concat(
                    Stream.make({
                      version: 1 as const,
                      revision: 1,
                      type: "snapshot" as const,
                      payload: initialSnapshot,
                    }),
                    liveEvents,
                  );
                }),
              ),
            ),
            { "rpc.aggregate": "auth" },
          ),
        [WS_METHODS.subscribeDevServers]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeDevServers,
            authorizeStream(
              WS_METHODS.subscribeDevServers,
              "terminal:read",
              devServerManager.stream,
            ),
            {
              "rpc.aggregate": "dev-servers",
            },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
