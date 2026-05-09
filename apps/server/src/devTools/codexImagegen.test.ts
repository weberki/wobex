import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCodexImagegenPrompt,
  findGeneratedImageFiles,
  resolveImagegenOutputTargets,
} from "./codexImagegen";

describe("buildCodexImagegenPrompt", () => {
  it("builds a focused prompt that asks Codex to use built-in image generation", () => {
    const prompt = buildCodexImagegenPrompt({
      prompt: "A small Wobex logo mark on a dark background",
      count: 2,
      size: "1024x1024",
      quality: "high",
      outputFormat: "png",
    });

    expect(prompt).toContain("Use the built-in `image_gen` tool");
    expect(prompt).toContain("A small Wobex logo mark on a dark background");
    expect(prompt).toContain("Number of images: 2");
    expect(prompt).toContain("Size: 1024x1024");
    expect(prompt).toContain("Quality: high");
    expect(prompt).toContain("Preferred output format: png");
    expect(prompt).toContain("Respond with a concise JSON object");
  });
});

describe("findGeneratedImageFiles", () => {
  it("returns only image files created after the start time, newest first", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wobex-imagegen-test-"));
    try {
      const batchDir = path.join(root, "batch");
      mkdirSync(batchDir, { recursive: true });
      const oldFile = path.join(batchDir, "old.png");
      const newFile = path.join(batchDir, "new.png");
      const newerFile = path.join(root, "newer.webp");
      const textFile = path.join(root, "notes.txt");
      writeFileSync(oldFile, "old");
      writeFileSync(newFile, "new");
      writeFileSync(newerFile, "newer");
      writeFileSync(textFile, "notes");

      const oldDate = new Date("2026-05-09T10:00:00.000Z");
      const newDate = new Date("2026-05-09T10:05:00.000Z");
      const newerDate = new Date("2026-05-09T10:06:00.000Z");
      utimesSync(oldFile, oldDate, oldDate);
      utimesSync(newFile, newDate, newDate);
      utimesSync(newerFile, newerDate, newerDate);
      utimesSync(textFile, newerDate, newerDate);

      const files = await findGeneratedImageFiles({
        generatedImagesDir: root,
        sinceMs: new Date("2026-05-09T10:01:00.000Z").getTime(),
      });

      expect(files.map((file) => path.basename(file.path))).toEqual(["newer.webp", "new.png"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveImagegenOutputTargets", () => {
  it("uses the requested path directly for a single output", () => {
    expect(
      resolveImagegenOutputTargets({
        outPath: path.join("output", "imagegen", "hero.png"),
        sources: [{ path: "generated.png", extension: ".png" }],
      }),
    ).toEqual([path.join("output", "imagegen", "hero.png")]);
  });

  it("adds numeric suffixes before the extension for multiple outputs", () => {
    expect(
      resolveImagegenOutputTargets({
        outPath: path.join("output", "imagegen", "hero.png"),
        sources: [
          { path: "generated-1.png", extension: ".png" },
          { path: "generated-2.png", extension: ".png" },
        ],
      }),
    ).toEqual([
      path.join("output", "imagegen", "hero-1.png"),
      path.join("output", "imagegen", "hero-2.png"),
    ]);
  });
});
