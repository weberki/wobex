import { describe, expect, it } from "vitest";

import { buildOracleDevToolCommand } from "./oracle";

describe("buildOracleDevToolCommand", () => {
  it("defaults to Oracle browser mode with GPT-5.5 Pro and heavy thinking", () => {
    const command = buildOracleDevToolCommand({
      prompt: "Review the migration plan",
      files: ["docs/plan.md", "src/**/*.ts"],
      outputPath: "output/oracle.md",
    });

    expect(command.command).toBe("npx");
    expect(command.args).toEqual([
      "-y",
      "@steipete/oracle",
      "--engine",
      "browser",
      "--model",
      "gpt-5.5-pro",
      "--browser-manual-login",
      "--browser-model-strategy",
      "select",
      "--browser-thinking-time",
      "heavy",
      "--browser-auto-reattach-delay",
      "5s",
      "--browser-auto-reattach-interval",
      "3s",
      "--browser-auto-reattach-timeout",
      "60s",
      "-p",
      "Review the migration plan",
      "--file",
      "docs/plan.md",
      "--file",
      "src/**/*.ts",
      "--write-output",
      "output/oracle.md",
    ]);
  });

  it("supports dry-run summary without dropping browser defaults", () => {
    const command = buildOracleDevToolCommand({
      prompt: "Preview",
      dryRun: true,
    });

    expect(command.args).toContain("--dry-run");
    expect(command.args).toContain("summary");
    expect(command.args).toContain("--browser-manual-login");
    expect(command.args).toContain("gpt-5.5-pro");
  });
});
