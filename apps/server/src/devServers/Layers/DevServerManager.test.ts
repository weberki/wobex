import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from "@wobex/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Path, Stream } from "effect";
import { TestClock } from "effect/testing";

import {
  deriveServerPaths,
  ServerConfig,
  type ServerConfigShape,
  type ServerDerivedPaths,
} from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { DevServerManager } from "../Services/DevServerManager.ts";
import {
  DevServerManagerLive,
  parseDevServerListeners,
  parseDevServerProcesses,
} from "./DevServerManager.ts";

const testProjectId = ProjectId.make("project-dev");
const testThreadId = ThreadId.make("thread-dev");

const makeReadModel = (
  workspaceRoot: string,
  scripts: OrchestrationReadModel["projects"][number]["scripts"],
): OrchestrationReadModel => {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    snapshotSequence: 0,
    updatedAt: now,
    projects: [
      {
        id: testProjectId,
        title: "Dev Project",
        workspaceRoot,
        repositoryIdentity: null,
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: testThreadId,
        projectId: testProjectId,
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        latestTurn: null,
        messages: [],
        session: null,
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        deletedAt: null,
      },
    ],
  };
};

const makeOrchestrationLayer = (readModel: OrchestrationReadModel) =>
  Layer.mock(OrchestrationEngineService)({
    getReadModel: () => Effect.succeed(readModel),
    readEvents: () => Stream.empty,
    dispatch: () => Effect.succeed({ sequence: 0 }),
    streamDomainEvents: Stream.empty,
  });

const makeServerConfig = (baseDir: string, paths: ServerDerivedPaths) =>
  ({
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "wobex-server",
    mode: "web",
    port: 0,
    host: undefined,
    cwd: baseDir,
    baseDir,
    ...paths,
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    startupPresentation: "browser",
    desktopBootstrapToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
  }) satisfies ServerConfigShape;

const makeManagerTestLayer = (readModel: OrchestrationReadModel) =>
  Layer.mergeAll(
    DevServerManagerLive.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "wobex-dev-server-" })),
    ),
    makeOrchestrationLayer(readModel),
  ).pipe(Layer.provide(NodeServices.layer));

const withManager =
  (readModel: OrchestrationReadModel) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provide(makeManagerTestLayer(readModel)));

describe("DevServerManager inventory parsing", () => {
  it("parses ps output", () => {
    const processes = parseDevServerProcesses(
      "123 1 S 0.0 0.1 node node /repo/node_modules/.bin/vite --host\n",
    );

    assert.equal(processes[0]?.pid, 123);
    assert.equal(processes[0]?.parentPid, 1);
    assert.equal(processes[0]?.command, "node");
    assert.equal(processes[0]?.args, "node /repo/node_modules/.bin/vite --host");
  });

  it("parses lsof listener output", () => {
    const listeners = parseDevServerListeners(
      [
        "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
        "node 123 dev 20u IPv6 0xabc 0t0 TCP *:5173 (LISTEN)",
        "node 123 dev 21u IPv4 0xabc 0t0 TCP 127.0.0.1:5173 (LISTEN)",
      ].join("\n"),
    );

    assert.equal(listeners.length, 1);
    assert.equal(listeners[0]?.pid, 123);
    assert.equal(listeners[0]?.port, 5173);
    assert.equal(listeners[0]?.processName, "node");
  });
});

describe("DevServerManager managed processes", () => {
  it.effect("starts and stops only managed dev-server project scripts", () =>
    Effect.gen(function* () {
      const manager = yield* DevServerManager;
      const started = yield* manager.start({
        projectId: testProjectId,
        scriptId: "dev",
      });

      assert.equal(started.scriptId, "dev");
      assert.equal(started.status, "starting");
      assert.ok(started.pid);

      const stopFiber = yield* manager.stop({ id: started.id }).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1000 millis");
      const stopped = yield* Fiber.join(stopFiber);

      assert.equal(stopped.status, "stopped");
    }).pipe(
      Effect.provide(TestClock.layer()),
      withManager(
        makeReadModel(process.cwd(), [
          {
            id: "dev",
            name: "Dev",
            command: `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`,
            icon: "play",
            runOnWorktreeCreate: false,
            role: "dev-server",
          },
        ]),
      ),
    ),
  );

  it.effect("refuses to stop unmanaged process ids", () =>
    Effect.gen(function* () {
      const manager = yield* DevServerManager;
      const error = yield* manager.stop({ id: "external-123-5173" }).pipe(Effect.flip);

      assert.equal(error._tag, "DevServerError");
      assert.equal(error.message, "Unknown managed dev server.");
    }).pipe(withManager(makeReadModel(process.cwd(), []))),
  );

  it.effect("rehydrates persisted managed metadata on backend restart", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "wobex-dev-server-rehydrate-",
      });
      const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
      yield* fileSystem.makeDirectory(derivedPaths.stateDir, { recursive: true });
      const config = makeServerConfig(baseDir, derivedPaths);
      yield* fileSystem.writeFileString(
        path.join(derivedPaths.stateDir, "dev-servers.json"),
        JSON.stringify([
          {
            id: "dev-server-persisted",
            projectId: testProjectId,
            projectTitle: "Dev Project",
            scriptId: "dev",
            scriptName: "Dev",
            command: "bun dev",
            cwd: baseDir,
            worktreePath: null,
            pid: null,
            rootPid: null,
            port: null,
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            exitCode: null,
            exitSignal: null,
          },
        ]),
      );

      const snapshot = yield* Effect.gen(function* () {
        const manager = yield* DevServerManager;
        return yield* manager.getSnapshot();
      }).pipe(
        Effect.provide(
          DevServerManagerLive.pipe(Layer.provide(Layer.succeed(ServerConfig, config))),
        ),
      );

      assert.equal(snapshot.managedDevServers[0]?.id, "dev-server-persisted");
      assert.equal(snapshot.managedDevServers[0]?.status, "unknown");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
