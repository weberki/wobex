import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

import { checkOpenCodeProviderStatus } from "./OpenCodeProvider";
import { ServerSettingsService } from "../../serverSettings";

const encoder = new TextEncoder();

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout: string; stderr: string; code: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { command: string; args: ReadonlyArray<string> };
      return Effect.succeed(mockHandle(handler(cmd.command, cmd.args)));
    }),
  );
}

describe("OpenCodeProvider", () => {
  it("reports managed OpenCode mode as ready when the binary is available", async () => {
    const status = await Effect.runPromise(
      checkOpenCodeProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            ServerSettingsService.layerTest(),
            mockSpawnerLayer((_command, args) => {
              if (args.join(" ") === "--version") {
                return { stdout: "opencode 1.4.3\n", stderr: "", code: 0 };
              }
              throw new Error(`Unexpected args: ${args.join(" ")}`);
            }),
          ),
        ),
      ),
    );

    expect(status.provider).toBe("opencode");
    expect(status.status).toBe("ready");
    expect(status.installed).toBe(true);
    expect(status.auth.status).toBe("unknown");
    expect(status.version).toBe("1.4.3");
  });

  it("probes an external OpenCode server with basic auth and model discovery", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const authHeader = init?.headers
        ? new Headers(init.headers as Record<string, string>).get("Authorization")
        : null;
      expect(authHeader).toBe(`Basic ${Buffer.from("user:pass", "utf8").toString("base64")}`);

      if (target.endsWith("/health")) {
        return new Response(JSON.stringify({ version: "1.4.3" }), { status: 200 });
      }
      if (target.endsWith("/api/models")) {
        return new Response(JSON.stringify({ models: [{ id: "gpt-5.4", name: "GPT-5.4" }] }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected URL: ${target}`);
    }) as typeof fetch;

    const status = await Effect.runPromise(
      checkOpenCodeProviderStatus(fetchImpl).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            ServerSettingsService.layerTest({
              providers: {
                opencode: {
                  serverUrl: "http://opencode.local",
                  serverUsername: "user",
                  serverPassword: "pass",
                },
              },
            }),
          ),
        ),
      ),
    );

    expect(status.status).toBe("ready");
    expect(status.auth.status).toBe("authenticated");
    expect(status.version).toBe("1.4.3");
    expect(status.models.map((model) => model.slug)).toEqual(["gpt-5.4"]);
  });

  it("marks an unreachable external OpenCode server as an error without crashing", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    const status = await Effect.runPromise(
      checkOpenCodeProviderStatus(fetchImpl).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            ServerSettingsService.layerTest({
              providers: {
                opencode: {
                  serverUrl: "http://127.0.0.1:43101",
                },
              },
            }),
          ),
        ),
      ),
    );

    expect(status.status).toBe("error");
    expect(status.auth.status).toBe("unknown");
    expect(status.installed).toBe(true);
    expect(status.message).toContain("connect ECONNREFUSED");
  });
});
