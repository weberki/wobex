import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import { basename } from "node:path";

import { NetService } from "@wobex/shared/Net";
import { makeCli } from "./cli";
import { version } from "../package.json" with { type: "json" };

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const commandName = resolveCommandName(process.argv[1]);

Command.run(makeCli(commandName), { version }).pipe(
  Effect.scoped,
  Effect.provide(CliRuntimeLayer),
  NodeRuntime.runMain,
);

function resolveCommandName(argvPath: string | undefined): string {
  const name = basename(argvPath ?? "").trim();
  if (name === "Wobex" || name === "wobex") {
    return name;
  }
  return "wobex";
}
