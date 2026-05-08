/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider in each
 * request input.
 *
 * When `modelSelection.provider` is `"claudeAgent"` the request is forwarded to
 * the Claude layer; for any other value (including the default `undefined`) it
 * falls through to the Codex layer.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";

import {
  TextGeneration,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "wobex/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "wobex/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

const normalizeProvider = (provider?: string): TextGenerationProvider | undefined =>
  provider === "claudeAgent" || provider === "codex" ? provider : undefined;

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;

  const route = (provider?: string): TextGenerationShape =>
    provider === "claudeAgent" ? claude : codex;

  return {
    generateCommitMessage: (input) =>
      route(normalizeProvider(input.modelSelection.provider)).generateCommitMessage(input),
    generatePrContent: (input) =>
      route(normalizeProvider(input.modelSelection.provider)).generatePrContent(input),
    generateDiffSummary: (input) =>
      route(normalizeProvider(input.modelSelection.provider)).generateDiffSummary(input),
    generateBranchName: (input) =>
      route(normalizeProvider(input.modelSelection.provider)).generateBranchName(input),
    generateThreadTitle: (input) =>
      route(normalizeProvider(input.modelSelection.provider)).generateThreadTitle(input),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));
