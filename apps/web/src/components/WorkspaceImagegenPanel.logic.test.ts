import { describe, expect, it } from "vitest";

import {
  buildImagegenRequests,
  clampImagegenCount,
  DEFAULT_IMAGEGEN_DRAFT,
  splitImagegenBatchPrompts,
  type ImagegenDraft,
} from "./WorkspaceImagegenPanel.logic";

describe("WorkspaceImagegenPanel logic", () => {
  it("splits batch prompts by blank lines, separators, and bullet lists", () => {
    expect(
      splitImagegenBatchPrompts(
        [
          "A cinematic espresso macro",
          "",
          "A neon Wobex robot",
          "---",
          "A calm workspace hero",
        ].join("\n"),
      ),
    ).toEqual(["A cinematic espresso macro", "A neon Wobex robot", "A calm workspace hero"]);

    expect(splitImagegenBatchPrompts("- first asset\n- second asset\n- third asset")).toEqual([
      "first asset",
      "second asset",
      "third asset",
    ]);
  });

  it("clamps variant count to a small frontend batch-safe range", () => {
    expect(clampImagegenCount(0)).toBe(1);
    expect(clampImagegenCount(3)).toBe(3);
    expect(clampImagegenCount(20)).toBe(4);
    expect(clampImagegenCount(Number.NaN)).toBe(1);
  });

  it("builds one direct generation request with aspect, resize, format, and cwd", () => {
    const draft: ImagegenDraft = {
      ...DEFAULT_IMAGEGEN_DRAFT,
      prompt: "Tiny Wobex logo mark on a dark background",
      count: 2,
      aspectPreset: "16:9",
      outputPreset: "1920x1080",
      quality: "high",
      format: "webp",
      fit: "cover",
      outputBasename: "wobex-logo",
    };

    expect(buildImagegenRequests(draft, { cwd: "D:\\2Dev\\wbr\\wobex" })).toEqual([
      {
        prompt: "Tiny Wobex logo mark on a dark background",
        count: 2,
        size: "16:9",
        quality: "high",
        format: "webp",
        outputBasename: "wobex-logo",
        cwd: "D:\\2Dev\\wbr\\wobex",
        resize: {
          width: 1920,
          height: 1080,
          fit: "cover",
        },
      },
    ]);
  });

  it("builds separate batch requests with stable output basenames", () => {
    const draft: ImagegenDraft = {
      ...DEFAULT_IMAGEGEN_DRAFT,
      mode: "batch",
      prompt: "ignored in batch mode",
      batchPrompts: "first prompt\n\nsecond prompt",
      outputBasename: "campaign",
      outputPreset: "native",
      count: 1,
    };

    expect(buildImagegenRequests(draft, { cwd: null })).toMatchObject([
      {
        prompt: "first prompt",
        outputBasename: "campaign-1",
      },
      {
        prompt: "second prompt",
        outputBasename: "campaign-2",
      },
    ]);
  });

  it("uses custom resize dimensions when custom output is selected", () => {
    const draft: ImagegenDraft = {
      ...DEFAULT_IMAGEGEN_DRAFT,
      prompt: "Poster crop",
      outputPreset: "custom",
      customWidth: 1200,
      customHeight: 1600,
      fit: "contain",
      background: "#101418",
    };

    expect(buildImagegenRequests(draft, { cwd: null })[0]?.resize).toEqual({
      width: 1200,
      height: 1600,
      fit: "contain",
      background: "#101418",
    });
  });
});
