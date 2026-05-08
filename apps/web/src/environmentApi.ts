import type { EnvironmentId, EnvironmentApi } from "@wobex/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      listTree: rpcClient.projects.listTree,
      readFile: rpcClient.projects.readFile,
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
    },
    git: {
      pull: rpcClient.git.pull,
      readWorkingTreeDiff: rpcClient.git.readWorkingTreeDiff,
      summarizeDiff: rpcClient.git.summarizeDiff,
      refreshStatus: rpcClient.git.refreshStatus,
      onStatus: (input, callback, options) => rpcClient.git.onStatus(input, callback, options),
      listBranches: rpcClient.git.listBranches,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
    },
    orchestration: {
      getSnapshot: rpcClient.orchestration.getSnapshot,
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      replayEvents: (fromSequenceExclusive) =>
        rpcClient.orchestration
          .replayEvents({ fromSequenceExclusive })
          .then((events) => [...events]),
      onDomainEvent: (callback, options) =>
        rpcClient.orchestration.onDomainEvent(callback, options),
    },
    providerDiscovery: {
      getComposerCapabilities: rpcClient.providerDiscovery.getComposerCapabilities,
      listCommands: rpcClient.providerDiscovery.listCommands,
      listSkills: rpcClient.providerDiscovery.listSkills,
      listPlugins: rpcClient.providerDiscovery.listPlugins,
      readPlugin: rpcClient.providerDiscovery.readPlugin,
      listModels: rpcClient.providerDiscovery.listModels,
    },
    providerUsage: {
      refresh: rpcClient.server.refreshProviderUsage,
    },
    devServers: {
      getSnapshot: rpcClient.devServers.getSnapshot,
      start: rpcClient.devServers.start,
      stop: rpcClient.devServers.stop,
      subscribe: rpcClient.devServers.subscribe,
    },
    observability: {
      getOverview: rpcClient.observability.getOverview,
      queryLogs: rpcClient.observability.queryLogs,
      querySpans: rpcClient.observability.querySpans,
      getThreadStats: rpcClient.observability.getThreadStats,
      getProviderStats: rpcClient.observability.getProviderStats,
      clearLocalData: rpcClient.observability.clearLocalData,
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}
