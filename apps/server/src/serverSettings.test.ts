import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@wobex/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "Wobex-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });

      assert.deepEqual(
        decodePatch({
          providers: {
            claudeAgent: {
              transport: "cli-stream",
              remoteEndpoints: {
                kimi: {
                  authToken: "fw_test",
                },
              },
            },
          },
        }),
        {
          providers: {
            claudeAgent: {
              transport: "cli-stream",
              remoteEndpoints: {
                kimi: {
                  authToken: "fw_test",
                },
              },
            },
          },
        },
      );

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }),
        {
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        },
      );
    }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/developer/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
            remoteEndpoints: {
              kimi: {
                authToken: "fw_test",
              },
            },
          },
        },
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: {
            fastMode: false,
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/developer/.codex",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        transport: "cli-stream",
        customModels: ["claude-custom"],
        remoteEndpoints: {
          kimi: {
            baseUrl: "https://api.fireworks.ai/inference",
            authToken: "fw_test",
          },
          minimax: {
            baseUrl: "https://api.minimax.io/anthropic",
            authToken: "",
          },
        },
      });
      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: {
          reasoningEffort: "high",
          fastMode: false,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            effort: "high",
          },
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "high",
          },
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "high",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
            remoteEndpoints: {
              kimi: {
                authToken: "  fw_test  ",
                baseUrl: "  https://api.fireworks.ai/inference  ",
              },
            },
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        transport: "cli-stream",
        customModels: [],
        remoteEndpoints: {
          kimi: {
            baseUrl: "https://api.fireworks.ai/inference",
            authToken: "fw_test",
          },
          minimax: {
            baseUrl: "https://api.minimax.io/anthropic",
            authToken: "",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("coerces persisted Claude SDK transport back to cli-stream", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          claudeAgent: {
            transport: "sdk",
          },
        },
      });

      assert.equal(next.providers.claudeAgent.transport, "cli-stream");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("migrates legacy claude-compatible settings files to remoteEndpoints", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify(
          {
            providers: {
              claudeAgent: {
                binaryPath: "claude",
                kimi: {
                  baseUrl: "https://api.fireworks.ai/inference",
                  authToken: "fw_test",
                },
                minimax: {
                  baseUrl: "https://api.minimax.io/anthropic",
                  authToken: "sk-cp-test",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const next = yield* serverSettings.getSettings;

      assert.deepEqual(next.providers.claudeAgent.remoteEndpoints, {
        kimi: {
          baseUrl: "https://api.fireworks.ai/inference",
          authToken: "fw_test",
        },
        minimax: {
          baseUrl: "https://api.minimax.io/anthropic",
          authToken: "sk-cp-test",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
