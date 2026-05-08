import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProjectListTreeInput,
  ProjectReadFileBinaryResult,
  ProjectReadFileInput,
  ProjectReadFileTextResult,
} from "./project";

describe("ProjectListTreeInput", () => {
  it("accepts root listings without a relative path", () => {
    const parsed = Schema.decodeUnknownSync(ProjectListTreeInput)({
      cwd: "/tmp/workspace",
      limit: 20,
    });

    expect(parsed.cwd).toBe("/tmp/workspace");
    expect(parsed.relativePath).toBeUndefined();
    expect(parsed.limit).toBe(20);
  });
});

describe("ProjectReadFileInput", () => {
  it("accepts bounded preview requests", () => {
    const parsed = Schema.decodeUnknownSync(ProjectReadFileInput)({
      cwd: "/tmp/workspace",
      relativePath: "README.md",
      maxBytes: 2048,
    });

    expect(parsed.relativePath).toBe("README.md");
    expect(parsed.maxBytes).toBe(2048);
  });
});

describe("ProjectReadFileResult", () => {
  it("decodes text previews", () => {
    const parsed = Schema.decodeUnknownSync(ProjectReadFileTextResult)({
      kind: "text",
      relativePath: "README.md",
      mimeType: "text/markdown",
      sizeBytes: 12,
      truncated: false,
      contents: "# Hello\n",
    });

    expect(parsed.kind).toBe("text");
    expect(parsed.contents).toContain("Hello");
  });

  it("decodes binary previews", () => {
    const parsed = Schema.decodeUnknownSync(ProjectReadFileBinaryResult)({
      kind: "binary",
      relativePath: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 4,
      truncated: true,
      bytesBase64: "AQIDBA==",
    });

    expect(parsed.kind).toBe("binary");
    expect(parsed.bytesBase64).toBe("AQIDBA==");
  });
});
