import type {
  DroidSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderState,
  ServerProviderModel,
} from "@wobex/contracts";
import { Cache, Duration, Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { DroidProvider } from "../Services/DroidProvider";
import { ServerSettingsService } from "../../serverSettings";
import { ServerSettingsError } from "@wobex/contracts";

const PROVIDER = "droid" as const;
const DEFAULT_DROID_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: DEFAULT_DROID_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    isCustom: false,
    capabilities: DEFAULT_DROID_MODEL_CAPABILITIES,
  },
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: DEFAULT_DROID_MODEL_CAPABILITIES,
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: DEFAULT_DROID_MODEL_CAPABILITIES,
  },
  {
    slug: "accounts/fireworks/routers/kimi-k2p5-turbo",
    name: "Kimi K2.5",
    isCustom: false,
    capabilities: DEFAULT_DROID_MODEL_CAPABILITIES,
  },
  {
    slug: "MiniMax-M2.7",
    name: "MiniMax M2.7",
    isCustom: false,
    capabilities: DEFAULT_DROID_MODEL_CAPABILITIES,
  },
];

export function parseDroidAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Droid CLI is not authenticated.",
    };
  }

  const trimmed = result.stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = extractAuthBoolean(JSON.parse(trimmed));
      if (parsed === true) {
        return { status: "ready", auth: { status: "authenticated" } };
      }
      if (parsed === false) {
        return {
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Droid CLI is not authenticated.",
        };
      }
    } catch {
      // fall through
    }
  }

  if (result.code === 0) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message: "Could not verify Droid authentication status from CLI output.",
    };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Droid authentication status. ${detail}`
      : "Could not verify Droid authentication status.",
  };
}

const runDroidCommand = Effect.fn("runDroidCommand")(function* (args: ReadonlyArray<string>) {
  const settings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((serverSettings) => serverSettings.providers.droid),
  );
  const command = ChildProcess.make(settings.binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(settings.binaryPath, command);
});

export const checkDroidProviderStatus = Effect.fn("checkDroidProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const settings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((serverSettings) => serverSettings.providers.droid),
    );
    const checkedAt = new Date().toISOString();
    const models = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      settings.customModels,
      DEFAULT_DROID_MODEL_CAPABILITIES,
    );

    if (!settings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Droid is disabled in Wobex settings.",
        },
      });
    }

    const versionProbe = yield* runDroidCommand(["--version"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Droid CLI (`droid`) is not installed or not on PATH."
            : `Failed to execute Droid CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(versionProbe.success)) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Droid CLI is installed but failed to run. Timed out while running command.",
        },
      });
    }

    const version = versionProbe.success.value;
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "error",
          auth: { status: "unknown" },
          message: detail
            ? `Droid CLI is installed but failed to run. ${detail}`
            : "Droid CLI is installed but failed to run.",
        },
      });
    }

    const authProbe = yield* runDroidCommand(["auth", "status"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(authProbe)) {
      const error = authProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "warning",
          auth: { status: "unknown" },
          message:
            error instanceof Error
              ? `Could not verify Droid authentication status: ${error.message}.`
              : "Could not verify Droid authentication status.",
        },
      });
    }
    if (Option.isNone(authProbe.success)) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "warning",
          auth: { status: "unknown" },
          message: "Could not verify Droid authentication status. Timed out while running command.",
        },
      });
    }

    const parsedAuth = parseDroidAuthStatusFromOutput(authProbe.success.value);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: parsedAuth.status,
        auth: parsedAuth.auth,
        ...(parsedAuth.message ? { message: parsedAuth.message } : {}),
      },
    });
  },
);

export const DroidProviderLive = Layer.effect(
  DroidProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const providerCheckCache = yield* Cache.make({
      capacity: 1,
      timeToLive: Duration.minutes(1),
      lookup: (_key: string) => checkDroidProviderStatus(),
    });

    const checkProvider = Cache.get(providerCheckCache, "droid").pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<DroidSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.droid),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.droid),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
