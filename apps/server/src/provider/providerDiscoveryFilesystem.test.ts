import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  discoverProviderCommands,
  discoverProviderPlugins,
  discoverProviderSkills,
} from "./providerDiscoveryFilesystem";

async function withTempHome(run: (homePath: string) => Promise<void>) {
  const homePath = await mkdtemp(path.join(tmpdir(), "wobex-provider-discovery-"));
  try {
    await run(homePath);
  } finally {
    await rm(homePath, { force: true, recursive: true });
  }
}

async function writeHomeFile(homePath: string, relativePath: string, contents: string) {
  const filePath = path.join(homePath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("provider discovery filesystem", () => {
  it("discovers Codex skills and plugins from .codex", async () =>
    withTempHome(async (homePath) => {
      const globalSkillPath = await writeHomeFile(
        homePath,
        ".codex/skills/frontend/SKILL.md",
        ["---", "name: frontend-skill", "description: Frontend craft", "---", ""].join("\n"),
      );
      const pluginSkillPath = await writeHomeFile(
        homePath,
        ".codex/plugins/cache/build-web/skills/react/SKILL.md",
        ["# react-best-practices", "", "React performance notes"].join("\n"),
      );
      const pluginPath = await writeHomeFile(
        homePath,
        ".codex/plugins/build-web/.codex-plugin/plugin.json",
        JSON.stringify({
          name: "Build Web Apps",
          description: "Web development plugin",
        }),
      );

      const skills = await discoverProviderSkills("codex", homePath);
      const plugins = await discoverProviderPlugins("codex", homePath);

      expect(skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "frontend-skill",
            description: "Frontend craft",
            path: globalSkillPath,
            scope: "global",
          }),
          expect.objectContaining({
            name: "react-best-practices",
            path: pluginSkillPath,
            scope: "plugin",
          }),
        ]),
      );
      expect(plugins).toEqual([
        expect.objectContaining({
          id: pluginPath,
          name: "Build Web Apps",
          description: "Web development plugin",
        }),
      ]);
    }));

  it("discovers Claude commands, agents, skills, and plugins from .claude", async () =>
    withTempHome(async (homePath) => {
      await writeHomeFile(
        homePath,
        ".claude/commands/review.md",
        [
          "---",
          "description: Review the current changes",
          "allowed-tools: Bash(git diff:*)",
          "---",
          "",
        ].join("\n"),
      );
      await writeHomeFile(
        homePath,
        ".claude/agents/reviewer.md",
        ["---", "name: reviewer", "description: Code review agent", "---", ""].join("\n"),
      );
      await writeHomeFile(
        homePath,
        ".claude/skills/audio/SKILL.md",
        ["---", "name: audio-tools", "description: Audio utilities", "---", ""].join("\n"),
      );
      const pluginPath = await writeHomeFile(
        homePath,
        ".claude/plugins/cache/anthropic/claude/.claude-plugin/plugin.json",
        JSON.stringify({
          name: "Claude Tools",
          description: "Claude plugin bundle",
        }),
      );

      const commands = await discoverProviderCommands("claudeAgent", homePath);
      const skills = await discoverProviderSkills("claudeAgent", homePath);
      const plugins = await discoverProviderPlugins("claudeAgent", homePath);

      expect(commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "review",
            description: "Review the current changes",
          }),
          expect.objectContaining({
            name: "usage",
            description: "Show Claude Code account usage.",
          }),
        ]),
      );
      expect(skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "reviewer",
            description: "Code review agent",
            scope: "agent",
          }),
          expect.objectContaining({
            name: "audio-tools",
            description: "Audio utilities",
            scope: "global",
          }),
        ]),
      );
      expect(plugins).toEqual([
        expect.objectContaining({
          id: pluginPath,
          name: "Claude Tools",
          description: "Claude plugin bundle",
        }),
      ]);
    }));

  it("discovers generic provider skills from their dot directories", async () =>
    withTempHome(async (homePath) => {
      await writeHomeFile(
        homePath,
        ".droid/skills/android/SKILL.md",
        ["---", "name: android-emulator-qa", "description: Emulator QA", "---", ""].join("\n"),
      );

      await expect(discoverProviderSkills("droid", homePath)).resolves.toEqual([
        expect.objectContaining({
          name: "android-emulator-qa",
          description: "Emulator QA",
          scope: "global",
        }),
      ]);
    }));
});
