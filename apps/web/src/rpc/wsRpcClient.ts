import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type LocalApi,
  type ServerSettingsPatch,
  type ServerRefreshProviderUsageInput,
  type ServerRefreshProviderUsageResult,
  ORCHESTRATION_WS_METHODS,
  type ProviderListCommandsInput,
  type ProviderListCommandsResult,
  type ProviderListModelsInput,
  type ProviderListModelsResult,
  type ProviderListPluginsInput,
  type ProviderListPluginsResult,
  type ProviderListSkillsInput,
  type ProviderListSkillsResult,
  type ProviderReadPluginInput,
  type ProviderReadPluginResult,
  type ProviderGetComposerCapabilitiesInput,
  type ProviderComposerCapabilities,
  type ObservabilityLogQueryInput,
  type ObservabilityQueryLogsResult,
  type ObservabilitySpanQueryInput,
  type ObservabilityQuerySpansResult,
  type ObservabilityOverview,
  type ObservabilityThreadStatsInput,
  type ObservabilityThreadStats,
  type ObservabilityProviderStatsResult,
  type ObservabilityClearLocalDataResult,
  WS_METHODS,
} from "@wobex/contracts";
import { applyGitStatusStreamEvent } from "@wobex/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly listTree: RpcUnaryMethod<typeof WS_METHODS.projectsListTree>;
    readonly readFile: RpcUnaryMethod<typeof WS_METHODS.projectsReadFile>;
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly readWorkingTreeDiff: RpcUnaryMethod<typeof WS_METHODS.gitReadWorkingTreeDiff>;
    readonly summarizeDiff: RpcUnaryMethod<typeof WS_METHODS.gitSummarizeDiff>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly refreshProviderUsage: (
      input: ServerRefreshProviderUsageInput,
    ) => Promise<ServerRefreshProviderUsageResult>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly observability: {
    readonly getOverview: () => Promise<ObservabilityOverview>;
    readonly queryLogs: (
      input: ObservabilityLogQueryInput,
    ) => Promise<ObservabilityQueryLogsResult>;
    readonly querySpans: (
      input: ObservabilitySpanQueryInput,
    ) => Promise<ObservabilityQuerySpansResult>;
    readonly getThreadStats: (
      input: ObservabilityThreadStatsInput,
    ) => Promise<ObservabilityThreadStats>;
    readonly getProviderStats: () => Promise<ObservabilityProviderStatsResult>;
    readonly clearLocalData: () => Promise<ObservabilityClearLocalDataResult>;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
  readonly providerDiscovery: {
    readonly getComposerCapabilities: (
      input: ProviderGetComposerCapabilitiesInput,
    ) => Promise<ProviderComposerCapabilities>;
    readonly listCommands: (
      input: ProviderListCommandsInput,
    ) => Promise<ProviderListCommandsResult>;
    readonly listSkills: (input: ProviderListSkillsInput) => Promise<ProviderListSkillsResult>;
    readonly listPlugins: (input: ProviderListPluginsInput) => Promise<ProviderListPluginsResult>;
    readonly readPlugin: (input: ProviderReadPluginInput) => Promise<ProviderReadPluginResult>;
    readonly listModels: (input: ProviderListModelsInput) => Promise<ProviderListModelsResult>;
  };
  readonly devServers: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof WS_METHODS.devServersGetSnapshot>;
    readonly start: RpcUnaryMethod<typeof WS_METHODS.devServersStart>;
    readonly stop: RpcUnaryMethod<typeof WS_METHODS.devServersStop>;
    readonly subscribe: RpcStreamMethod<typeof WS_METHODS.subscribeDevServers>;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      listTree: (input) =>
        transport.request((client) => client[WS_METHODS.projectsListTree](input)),
      readFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsReadFile](input)),
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      readWorkingTreeDiff: (input) =>
        transport.request((client) => client[WS_METHODS.gitReadWorkingTreeDiff](input)),
      summarizeDiff: (input) =>
        transport.request((client) => client[WS_METHODS.gitSummarizeDiff](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      refreshProviderUsage: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviderUsage](input)),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          options,
        ),
    },
    observability: {
      getOverview: () =>
        transport.request((client) => client[WS_METHODS.observabilityGetOverview]({})),
      queryLogs: (input) =>
        transport.request((client) => client[WS_METHODS.observabilityQueryLogs](input)),
      querySpans: (input) =>
        transport.request((client) => client[WS_METHODS.observabilityQuerySpans](input)),
      getThreadStats: (input) =>
        transport.request((client) => client[WS_METHODS.observabilityGetThreadStats](input)),
      getProviderStats: () =>
        transport.request((client) => client[WS_METHODS.observabilityGetProviderStats]({})),
      clearLocalData: () =>
        transport.request((client) => client[WS_METHODS.observabilityClearLocalData]({})),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
    providerDiscovery: {
      getComposerCapabilities: (input) =>
        transport.request((client) =>
          client[WS_METHODS.providerDiscoveryGetComposerCapabilities](input),
        ),
      listCommands: (input) =>
        transport.request((client) => client[WS_METHODS.providerDiscoveryListCommands](input)),
      listSkills: (input) =>
        transport.request((client) => client[WS_METHODS.providerDiscoveryListSkills](input)),
      listPlugins: (input) =>
        transport.request((client) => client[WS_METHODS.providerDiscoveryListPlugins](input)),
      readPlugin: (input) =>
        transport.request((client) => client[WS_METHODS.providerDiscoveryReadPlugin](input)),
      listModels: (input) =>
        transport.request((client) => client[WS_METHODS.providerDiscoveryListModels](input)),
    },
    devServers: {
      getSnapshot: () =>
        transport.request((client) => client[WS_METHODS.devServersGetSnapshot]({})),
      start: (input) => transport.request((client) => client[WS_METHODS.devServersStart](input)),
      stop: (input) => transport.request((client) => client[WS_METHODS.devServersStop](input)),
      subscribe: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeDevServers]({}),
          listener,
          options,
        ),
    },
  };
}
