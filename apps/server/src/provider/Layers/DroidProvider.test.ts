import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

import { checkDroidProviderStatus } from "./DroidProvider";
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

describe("DroidProvider", () => {
  it("degrades Droid auth to unknown when the CLI output is indeterminate", async () => {
    const status = await Effect.runPromise(
      checkDroidProviderStatus().pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            ServerSettingsService.layerTest(),
            mockSpawnerLayer((_command, args) => {
              const joined = args.join(" ");
              if (joined === "--version") {
                return { stdout: "droid 0.98.0\n", stderr: "", code: 0 };
              }
              if (joined === "auth status") {
                return { stdout: "authenticated maybe\n", stderr: "", code: 0 };
              }
              throw new Error(`Unexpected args: ${joined}`);
            }),
          ),
        ),
      ),
    );

    expect(status.provider).toBe("droid");
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.98.0");
    expect(status.status).toBe("warning");
    expect(status.auth.status).toBe("unknown");
  });
});
