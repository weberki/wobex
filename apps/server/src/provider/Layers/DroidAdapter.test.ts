import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { makeDroidAdapterLive } from "./DroidAdapter";
import { DroidAdapter } from "../Services/DroidAdapter";
import { ServerSettingsService } from "../../serverSettings";
import { ThreadId } from "@wobex/contracts";

const THREAD_ID = ThreadId.make("thread-droid");

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(signal?: NodeJS.Signals) {
    this.killed = true;
    this.emit("exit", null, signal ?? "SIGTERM");
    return true;
  }
}

describe("DroidAdapter", () => {
  it("captures and reuses Droid session ids across turns", async () => {
    const spawnedArgs: Array<ReadonlyArray<string>> = [];
    const fakeChildren: Array<FakeChildProcess> = [];
    const layer = makeDroidAdapterLive({
      spawnProcess: ({ args }) => {
        spawnedArgs.push(args);
        const child = new FakeChildProcess();
        fakeChildren.push(child);
        return {
          child: child as unknown as never,
          kill(signal?: NodeJS.Signals) {
            child.kill(signal);
          },
        };
      },
    }).pipe(
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            droid: {
              binaryPath: "droid",
            },
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    const runtime = Effect.gen(function* () {
      const adapter = yield* DroidAdapter;
      const eventsFiber = yield* Stream.take(adapter.streamEvents, 6).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "droid",
        runtimeMode: "auto-accept-edits",
      });

      const firstTurn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "hello droid",
        attachments: [],
      });
      fakeChildren[0]!.stdout.write(
        `${JSON.stringify({ type: "message", session_id: "sess-1", text: "hi" })}\n`,
      );
      fakeChildren[0]!.stdout.end(
        `${JSON.stringify({ type: "completion", session_id: "sess-1" })}\n`,
      );
      fakeChildren[0]!.emit("exit", 0, null);

      const secondTurn = yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "follow up",
        attachments: [],
      });
      fakeChildren[1]!.stdout.write(
        `${JSON.stringify({ type: "message", session_id: "sess-1", text: "again" })}\n`,
      );
      fakeChildren[1]!.stdout.end(
        `${JSON.stringify({ type: "completion", session_id: "sess-1" })}\n`,
      );
      fakeChildren[1]!.emit("exit", 0, null);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      return { firstTurn, secondTurn, events };
    }).pipe(Effect.provide(layer));

    const { firstTurn, secondTurn, events } = await Effect.runPromise(runtime);
    expect(firstTurn.resumeCursor).toEqual({ sessionId: "sess-1" });
    expect(secondTurn.resumeCursor).toEqual({ sessionId: "sess-1" });
    expect(spawnedArgs[0]).toContain("--auto");
    expect(spawnedArgs[0]).toContain("low");
    expect(spawnedArgs[1]).toContain("--session-id");
    expect(spawnedArgs[1]).toContain("sess-1");
    expect(events.some((event) => event.type === "content.delta")).toBe(true);
    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
  });
});
