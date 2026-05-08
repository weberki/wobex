import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { OpenError, OpenInEditorInput } from "./editor";
import { AuthAccessStreamEvent, AuthCapabilityError } from "./auth";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCheckoutResult,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
  GitSummarizeDiffInput,
  GitSummarizeDiffResult,
} from "./git";
import { KeybindingsConfigError } from "./keybindings";
import {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration";
import { ObservabilityQueryError, ObservabilityRpcSchemas } from "./observability";
import {
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
} from "./providerDiscovery";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectListTreeError,
  ProjectListTreeInput,
  ProjectListTreeResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  DevServerError,
  DevServerSnapshot,
  DevServerStartInput,
  DevServerStopInput,
  DevServerStreamEvent,
  ManagedDevServer,
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerRefreshProviderUsageInput,
  ServerRefreshProviderUsageResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";

const withAuthCapabilityError = <A extends Schema.Schema<unknown>>(error: A) =>
  Schema.Union([error, AuthCapabilityError]);

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListTree: "projects.listTree",
  projectsSearchEntries: "projects.searchEntries",
  projectsReadFile: "projects.readFile",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitReadWorkingTreeDiff: "git.readWorkingTreeDiff",
  gitSummarizeDiff: "git.summarizeDiff",
  gitRefreshStatus: "git.refreshStatus",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverRefreshProviderUsage: "server.refreshProviderUsage",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",

  // Observability methods
  observabilityGetOverview: "observability.getOverview",
  observabilityQueryLogs: "observability.queryLogs",
  observabilityQuerySpans: "observability.querySpans",
  observabilityGetThreadStats: "observability.getThreadStats",
  observabilityGetProviderStats: "observability.getProviderStats",
  observabilityClearLocalData: "observability.clearLocalData",

  // Dev-server control methods
  devServersGetSnapshot: "devServers.getSnapshot",
  devServersStart: "devServers.start",
  devServersStop: "devServers.stop",

  // Provider discovery methods
  providerDiscoveryGetComposerCapabilities: "providerDiscovery.getComposerCapabilities",
  providerDiscoveryListCommands: "providerDiscovery.listCommands",
  providerDiscoveryListSkills: "providerDiscovery.listSkills",
  providerDiscoveryListPlugins: "providerDiscovery.listPlugins",
  providerDiscoveryReadPlugin: "providerDiscovery.readPlugin",
  providerDiscoveryListModels: "providerDiscovery.listModels",

  // Streaming subscriptions
  subscribeGitStatus: "subscribeGitStatus",
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeDevServers: "subscribeDevServers",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: withAuthCapabilityError(KeybindingsConfigError),
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, AuthCapabilityError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
  error: AuthCapabilityError,
});

export const WsServerRefreshProviderUsageRpc = Rpc.make(WS_METHODS.serverRefreshProviderUsage, {
  payload: ServerRefreshProviderUsageInput,
  success: ServerRefreshProviderUsageResult,
  error: AuthCapabilityError,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: withAuthCapabilityError(ServerSettingsError),
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: withAuthCapabilityError(ServerSettingsError),
});

export const WsObservabilityGetOverviewRpc = Rpc.make(WS_METHODS.observabilityGetOverview, {
  payload: ObservabilityRpcSchemas.getOverview.input,
  success: ObservabilityRpcSchemas.getOverview.output,
  error: withAuthCapabilityError(ObservabilityQueryError),
});

export const WsObservabilityQueryLogsRpc = Rpc.make(WS_METHODS.observabilityQueryLogs, {
  payload: ObservabilityRpcSchemas.queryLogs.input,
  success: ObservabilityRpcSchemas.queryLogs.output,
  error: withAuthCapabilityError(ObservabilityQueryError),
});

export const WsObservabilityQuerySpansRpc = Rpc.make(WS_METHODS.observabilityQuerySpans, {
  payload: ObservabilityRpcSchemas.querySpans.input,
  success: ObservabilityRpcSchemas.querySpans.output,
  error: withAuthCapabilityError(ObservabilityQueryError),
});

export const WsObservabilityGetThreadStatsRpc = Rpc.make(WS_METHODS.observabilityGetThreadStats, {
  payload: ObservabilityRpcSchemas.getThreadStats.input,
  success: ObservabilityRpcSchemas.getThreadStats.output,
  error: withAuthCapabilityError(ObservabilityQueryError),
});

export const WsObservabilityGetProviderStatsRpc = Rpc.make(
  WS_METHODS.observabilityGetProviderStats,
  {
    payload: ObservabilityRpcSchemas.getProviderStats.input,
    success: ObservabilityRpcSchemas.getProviderStats.output,
    error: withAuthCapabilityError(ObservabilityQueryError),
  },
);

export const WsObservabilityClearLocalDataRpc = Rpc.make(WS_METHODS.observabilityClearLocalData, {
  payload: ObservabilityRpcSchemas.clearLocalData.input,
  success: ObservabilityRpcSchemas.clearLocalData.output,
  error: withAuthCapabilityError(ObservabilityQueryError),
});

export const WsDevServersGetSnapshotRpc = Rpc.make(WS_METHODS.devServersGetSnapshot, {
  payload: Schema.Struct({}),
  success: DevServerSnapshot,
  error: withAuthCapabilityError(DevServerError),
});

export const WsDevServersStartRpc = Rpc.make(WS_METHODS.devServersStart, {
  payload: DevServerStartInput,
  success: ManagedDevServer,
  error: withAuthCapabilityError(DevServerError),
});

export const WsDevServersStopRpc = Rpc.make(WS_METHODS.devServersStop, {
  payload: DevServerStopInput,
  success: ManagedDevServer,
  error: withAuthCapabilityError(DevServerError),
});

export const WsProviderDiscoveryGetComposerCapabilitiesRpc = Rpc.make(
  WS_METHODS.providerDiscoveryGetComposerCapabilities,
  {
    payload: ProviderGetComposerCapabilitiesInput,
    success: ProviderComposerCapabilities,
    error: withAuthCapabilityError(ProviderDiscoveryUnsupportedError),
  },
);

export const WsProviderDiscoveryListCommandsRpc = Rpc.make(
  WS_METHODS.providerDiscoveryListCommands,
  {
    payload: ProviderListCommandsInput,
    success: ProviderListCommandsResult,
    error: withAuthCapabilityError(ProviderDiscoveryUnsupportedError),
  },
);

export const WsProviderDiscoveryListSkillsRpc = Rpc.make(WS_METHODS.providerDiscoveryListSkills, {
  payload: ProviderListSkillsInput,
  success: ProviderListSkillsResult,
  error: withAuthCapabilityError(ProviderDiscoveryUnsupportedError),
});

export const WsProviderDiscoveryListPluginsRpc = Rpc.make(WS_METHODS.providerDiscoveryListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
  error: withAuthCapabilityError(ProviderDiscoveryUnsupportedError),
});

export const WsProviderDiscoveryReadPluginRpc = Rpc.make(WS_METHODS.providerDiscoveryReadPlugin, {
  payload: ProviderReadPluginInput,
  success: ProviderReadPluginResult,
  error: withAuthCapabilityError(ProviderDiscoveryUnsupportedError),
});

export const WsProviderDiscoveryListModelsRpc = Rpc.make(WS_METHODS.providerDiscoveryListModels, {
  payload: ProviderListModelsInput,
  success: ProviderListModelsResult,
  error: withAuthCapabilityError(ProviderDiscoveryUnsupportedError),
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: withAuthCapabilityError(ProjectSearchEntriesError),
});

export const WsProjectsListTreeRpc = Rpc.make(WS_METHODS.projectsListTree, {
  payload: ProjectListTreeInput,
  success: ProjectListTreeResult,
  error: withAuthCapabilityError(ProjectListTreeError),
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: withAuthCapabilityError(ProjectReadFileError),
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: withAuthCapabilityError(ProjectWriteFileError),
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: withAuthCapabilityError(OpenError),
});

export const WsSubscribeGitStatusRpc = Rpc.make(WS_METHODS.subscribeGitStatus, {
  payload: GitStatusInput,
  success: GitStatusStreamEvent,
  error: withAuthCapabilityError(GitManagerServiceError),
  stream: true,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsGitRefreshStatusRpc = Rpc.make(WS_METHODS.gitRefreshStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: withAuthCapabilityError(GitManagerServiceError),
});

export const WsGitReadWorkingTreeDiffRpc = Rpc.make(WS_METHODS.gitReadWorkingTreeDiff, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitReadWorkingTreeDiffResult,
  error: withAuthCapabilityError(GitManagerServiceError),
});

export const WsGitSummarizeDiffRpc = Rpc.make(WS_METHODS.gitSummarizeDiff, {
  payload: GitSummarizeDiffInput,
  success: GitSummarizeDiffResult,
  error: withAuthCapabilityError(GitManagerServiceError),
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: withAuthCapabilityError(GitManagerServiceError),
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: withAuthCapabilityError(GitManagerServiceError),
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: withAuthCapabilityError(GitManagerServiceError),
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: GitCreateBranchResult,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: GitCheckoutResult,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: withAuthCapabilityError(GitCommandError),
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: withAuthCapabilityError(TerminalError),
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: withAuthCapabilityError(TerminalError),
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: withAuthCapabilityError(TerminalError),
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: withAuthCapabilityError(TerminalError),
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: withAuthCapabilityError(TerminalError),
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: withAuthCapabilityError(TerminalError),
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: withAuthCapabilityError(OrchestrationGetSnapshotError),
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: withAuthCapabilityError(OrchestrationDispatchCommandError),
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: withAuthCapabilityError(OrchestrationGetTurnDiffError),
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: withAuthCapabilityError(OrchestrationGetFullThreadDiffError),
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: withAuthCapabilityError(OrchestrationReplayEventsError),
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    error: AuthCapabilityError,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: AuthCapabilityError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, AuthCapabilityError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: AuthCapabilityError,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: AuthCapabilityError,
  stream: true,
});

export const WsSubscribeDevServersRpc = Rpc.make(WS_METHODS.subscribeDevServers, {
  payload: Schema.Struct({}),
  success: DevServerStreamEvent,
  error: withAuthCapabilityError(DevServerError),
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerRefreshProviderUsageRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsObservabilityGetOverviewRpc,
  WsObservabilityQueryLogsRpc,
  WsObservabilityQuerySpansRpc,
  WsObservabilityGetThreadStatsRpc,
  WsObservabilityGetProviderStatsRpc,
  WsObservabilityClearLocalDataRpc,
  WsDevServersGetSnapshotRpc,
  WsDevServersStartRpc,
  WsDevServersStopRpc,
  WsProviderDiscoveryGetComposerCapabilitiesRpc,
  WsProviderDiscoveryListCommandsRpc,
  WsProviderDiscoveryListSkillsRpc,
  WsProviderDiscoveryListPluginsRpc,
  WsProviderDiscoveryReadPluginRpc,
  WsProviderDiscoveryListModelsRpc,
  WsProjectsListTreeRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsSubscribeGitStatusRpc,
  WsGitPullRpc,
  WsGitRefreshStatusRpc,
  WsGitReadWorkingTreeDiffRpc,
  WsGitSummarizeDiffRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeDevServersRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
);
