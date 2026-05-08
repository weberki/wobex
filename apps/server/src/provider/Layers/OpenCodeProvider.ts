import type {
  ModelCapabilities,
  OpenCodeSettings,
  ServerProvider,
  ServerProviderModel,
} from "@wobex/contracts";
import { Cache, Duration, Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { OpenCodeProvider } from "../Services/OpenCodeProvider";
import { ServerSettingsService } from "../../serverSettings";
import { ServerSettingsError } from "@wobex/contracts";

const PROVIDER = "opencode" as const;
const DEFAULT_OPENCODE_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    isCustom: false,
    capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  },
];

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function openCodeAuthHeaders(
  settings: Pick<OpenCodeSettings, "serverUsername" | "serverPassword">,
) {
  const username = trimOrUndefined(settings.serverUsername);
  const password = trimOrUndefined(settings.serverPassword);
  if (!username || !password) {
    return {} satisfies Record<string, string>;
  }

  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
  } satisfies Record<string, string>;
}

interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

class OpenCodeFetchError {
  readonly _tag = "OpenCodeFetchError";

  constructor(
    readonly url: string,
    readonly cause: unknown,
    readonly message = cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : String(cause),
  ) {}
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<JsonResponse> {
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is not available.");
  }
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function fetchJsonEffect(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  return Effect.tryPromise({
    try: () => fetchJson(url, init, fetchImpl),
    catch: (error) => new OpenCodeFetchError(url, error),
  });
}

function serverModelsFromBody(body: unknown): ReadonlyArray<ServerProviderModel> {
  const rawModels = Array.isArray(body)
    ? body
    : body && typeof body === "object" && "models" in body
      ? body.models
      : null;
  if (!Array.isArray(rawModels)) {
    return [];
  }

  const models: ServerProviderModel[] = [];
  for (const rawModel of rawModels) {
    if (typeof rawModel === "string" && rawModel.trim().length > 0) {
      models.push({
        slug: rawModel.trim(),
        name: rawModel.trim(),
        isCustom: false,
        capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      });
      continue;
    }
    if (!rawModel || typeof rawModel !== "object") {
      continue;
    }
    const slug =
      typeof rawModel === "object" && rawModel !== null
        ? ["slug", "id", "model"]
            .map((key) => (key in rawModel ? rawModel[key as keyof typeof rawModel] : undefined))
            .find((value) => typeof value === "string" && value.trim().length > 0)
        : undefined;
    if (typeof slug !== "string") {
      continue;
    }
    const name =
      "name" in rawModel && typeof rawModel.name === "string" && rawModel.name.trim().length > 0
        ? rawModel.name.trim()
        : slug.trim();
    models.push({
      slug: slug.trim(),
      name,
      isCustom: false,
      capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
    });
  }
  return models;
}

const runOpenCodeCommand = Effect.fn("runOpenCodeCommand")(function* (args: ReadonlyArray<string>) {
  const settings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((serverSettings) => serverSettings.providers.opencode),
  );
  const command = ChildProcess.make(settings.binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(settings.binaryPath, command);
});

export const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(function* (
  fetchImpl: typeof fetch = globalThis.fetch,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const settings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((serverSettings) => serverSettings.providers.opencode),
  );
  const checkedAt = new Date().toISOString();
  const builtInModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    [],
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );

  if (!settings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models: builtInModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "OpenCode is disabled in Wobex settings.",
      },
    });
  }

  const serverUrl = trimOrUndefined(settings.serverUrl);
  if (serverUrl) {
    const baseUrl = normalizeBaseUrl(serverUrl);
    const headers = {
      Accept: "application/json",
      ...openCodeAuthHeaders(settings),
    };
    const healthResult = yield* fetchJsonEffect(`${baseUrl}/health`, { headers }, fetchImpl).pipe(
      Effect.result,
    );

    if (Result.isFailure(healthResult)) {
      const error = healthResult.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models: builtInModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: `Failed to reach OpenCode server at ${baseUrl}: ${error.message}.`,
        },
      });
    }

    const health = healthResult.success;
    if (health.status === 401 || health.status === 403) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models: builtInModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unauthenticated" },
          message: "OpenCode server rejected the configured credentials.",
        },
      });
    }
    if (health.status < 200 || health.status >= 300) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models: builtInModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: `OpenCode server health check failed with status ${health.status}.`,
        },
      });
    }

    const modelsResult = yield* fetchJsonEffect(
      `${baseUrl}/api/models`,
      { headers },
      fetchImpl,
    ).pipe(Effect.result);
    const serverModels =
      Result.isSuccess(modelsResult) &&
      modelsResult.success.status >= 200 &&
      modelsResult.success.status < 300
        ? serverModelsFromBody(modelsResult.success.body)
        : [];

    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models: serverModels.length > 0 ? serverModels : builtInModels,
      probe: {
        installed: true,
        version:
          health.body &&
          typeof health.body === "object" &&
          "version" in health.body &&
          typeof health.body.version === "string"
            ? health.body.version
            : null,
        status: "ready",
        auth: { status: "authenticated" },
        message: "Using external OpenCode server.",
      },
    });
  }

  const versionProbe = yield* runOpenCodeCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models: builtInModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "OpenCode CLI (`opencode`) is not installed or not on PATH."
          : `Failed to execute OpenCode CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Result.isSuccess(versionProbe) && Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models: builtInModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "OpenCode CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version =
    Result.isSuccess(versionProbe) && Option.isSome(versionProbe.success)
      ? versionProbe.success.value
      : null;
  const parsedVersion = version
    ? parseGenericCliVersion(`${version.stdout}\n${version.stderr}`)
    : null;
  if (version && version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models: builtInModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `OpenCode CLI is installed but failed to run. ${detail}`
          : "OpenCode CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: true,
    checkedAt,
    models: builtInModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: { status: "unknown" },
      message: "Managed OpenCode server will start on first use.",
    },
  });
});

export const OpenCodeProviderLive = Layer.effect(
  OpenCodeProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const providerCheckCache = yield* Cache.make({
      capacity: 1,
      timeToLive: Duration.minutes(1),
      lookup: (_key: string) => checkOpenCodeProviderStatus(),
    });

    const checkProvider = Cache.get(providerCheckCache, "opencode").pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<OpenCodeSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.opencode),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.opencode),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
