import type {
  ProviderKind,
  ProviderNativeCommandDescriptor,
  ProviderPluginDescriptor,
  ProviderSkillDescriptor,
} from "@wobex/contracts";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MAX_DISCOVERY_FILES = 1_000;
const SKILL_FILE_NAME = "SKILL.md";

interface DiscoveryRoot {
  readonly path: string;
  readonly maxDepth: number;
}

interface MarkdownMetadata {
  readonly name?: string;
  readonly description?: string;
}

function providerConfigDir(provider: ProviderKind, homePath = homedir()): string {
  switch (provider) {
    case "claudeAgent":
      return path.join(homePath, ".claude");
    case "opencode":
      return path.join(homePath, ".opencode");
    default:
      return path.join(homePath, `.${provider}`);
  }
}

function providerSkillRoots(provider: ProviderKind, homePath = homedir()): DiscoveryRoot[] {
  const root = providerConfigDir(provider, homePath);
  switch (provider) {
    case "codex":
      return [
        { path: path.join(root, "skills"), maxDepth: 6 },
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
      ];
    case "claudeAgent":
      return [
        { path: path.join(root, "skills"), maxDepth: 8 },
        { path: path.join(root, "agents"), maxDepth: 2 },
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
        { path: path.join(root, "plugins", "marketplaces"), maxDepth: 10 },
      ];
    default:
      return [
        { path: path.join(root, "skills"), maxDepth: 8 },
        { path: path.join(root, "agents"), maxDepth: 2 },
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
      ];
  }
}

function providerCommandRoots(provider: ProviderKind, homePath = homedir()): DiscoveryRoot[] {
  const root = providerConfigDir(provider, homePath);
  switch (provider) {
    case "codex":
      return [
        { path: path.join(root, "commands"), maxDepth: 4 },
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
      ];
    case "claudeAgent":
      return [
        { path: path.join(root, "commands"), maxDepth: 4 },
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
        { path: path.join(root, "plugins", "marketplaces"), maxDepth: 10 },
      ];
    default:
      return [
        { path: path.join(root, "commands"), maxDepth: 4 },
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
      ];
  }
}

function providerPluginRoots(provider: ProviderKind, homePath = homedir()): DiscoveryRoot[] {
  const root = providerConfigDir(provider, homePath);
  switch (provider) {
    case "codex":
      return [
        { path: path.join(root, "plugins"), maxDepth: 8 },
        { path: path.join(root, ".tmp", "plugins"), maxDepth: 8 },
      ];
    case "claudeAgent":
      return [
        { path: path.join(root, "plugins", "cache"), maxDepth: 10 },
        { path: path.join(root, "plugins", "marketplaces"), maxDepth: 10 },
      ];
    default:
      return [{ path: path.join(root, "plugins"), maxDepth: 8 }];
  }
}

function isIgnoredDiscoveryDirectory(name: string): boolean {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === "archived_sessions" ||
    name === "logs" ||
    name === "sqlite" ||
    name === "worktrees" ||
    name === "tasks" ||
    name === "projects" ||
    name === "ide"
  );
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function walkFiles(
  roots: ReadonlyArray<DiscoveryRoot>,
  predicate: (filePath: string, fileName: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (files.length >= MAX_DISCOVERY_FILES || !(await directoryExists(root.path))) {
      continue;
    }

    const stack: Array<{ directoryPath: string; depth: number }> = [
      { directoryPath: root.path, depth: 0 },
    ];

    while (stack.length > 0 && files.length < MAX_DISCOVERY_FILES) {
      const current = stack.pop();
      if (!current || current.depth > root.maxDepth) {
        continue;
      }

      let entries: Dirent[];
      try {
        entries = await fs.readdir(current.directoryPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(current.directoryPath, entry.name);
        if (entry.isDirectory()) {
          if (!isIgnoredDiscoveryDirectory(entry.name)) {
            stack.push({ directoryPath: entryPath, depth: current.depth + 1 });
          }
          continue;
        }

        if (!entry.isFile() || !predicate(entryPath, entry.name) || seen.has(entryPath)) {
          continue;
        }
        seen.add(entryPath);
        files.push(entryPath);
        if (files.length >= MAX_DISCOVERY_FILES) {
          break;
        }
      }
    }
  }

  return files.toSorted((left, right) => left.localeCompare(right));
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseMarkdownMetadata(markdown: string): MarkdownMetadata {
  const lines = markdown.split(/\r?\n/);
  const metadata: Record<string, string> = {};

  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line?.trim() === "---") {
        break;
      }
      const match = line?.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) {
        continue;
      }
      const key = match[1];
      const rawValue = match[2];
      if (!key || rawValue === undefined) {
        continue;
      }
      const value = rawValue.trim().replace(/^["']|["']$/g, "");
      if (value.length > 0) {
        metadata[key] = value;
      }
    }
  }

  const heading = lines
    .map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim())
    .find((value): value is string => Boolean(value));

  const name = metadata.name ?? heading;
  return {
    ...(name ? { name } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
  };
}

function skillScope(provider: ProviderKind, filePath: string): string {
  if (filePath.includes(`${path.sep}plugins${path.sep}`)) {
    return "plugin";
  }
  if (provider === "claudeAgent" && filePath.includes(`${path.sep}agents${path.sep}`)) {
    return "agent";
  }
  return "global";
}

function skillNameFromPath(filePath: string): string {
  return path.basename(filePath) === SKILL_FILE_NAME
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, path.extname(filePath));
}

export async function discoverProviderSkills(
  provider: ProviderKind,
  homePath = homedir(),
): Promise<ProviderSkillDescriptor[]> {
  const files = await walkFiles(providerSkillRoots(provider, homePath), (filePath, fileName) => {
    if (fileName === SKILL_FILE_NAME) {
      return true;
    }
    return (
      provider === "claudeAgent" &&
      filePath.includes(`${path.sep}agents${path.sep}`) &&
      fileName.endsWith(".md")
    );
  });

  const skills = await Promise.all(
    files.map(async (filePath) => {
      const markdown = await readTextFile(filePath);
      const metadata = markdown ? parseMarkdownMetadata(markdown) : {};
      const name = metadata.name ?? skillNameFromPath(filePath);
      return Object.assign(
        {
          name,
          path: filePath,
          enabled: true,
          scope: skillScope(provider, filePath),
          interface: Object.assign(
            {
              displayName: name,
            },
            metadata.description ? { shortDescription: metadata.description } : {},
          ),
        },
        metadata.description ? { description: metadata.description } : {},
      ) satisfies ProviderSkillDescriptor;
    }),
  );

  return skills;
}

function isCommandMarkdown(filePath: string, fileName: string): boolean {
  return filePath.includes(`${path.sep}commands${path.sep}`) && fileName.endsWith(".md");
}

function providerBuiltInCommands(provider: ProviderKind): ProviderNativeCommandDescriptor[] {
  switch (provider) {
    case "claudeAgent":
      return [
        {
          name: "usage",
          description: "Show Claude Code account usage.",
        },
      ];
    default:
      return [];
  }
}

export async function discoverProviderCommands(
  provider: ProviderKind,
  homePath = homedir(),
): Promise<ProviderNativeCommandDescriptor[]> {
  const files = await walkFiles(providerCommandRoots(provider, homePath), isCommandMarkdown);
  const discoveredCommands = await Promise.all(
    files.map(async (filePath) => {
      const markdown = await readTextFile(filePath);
      const metadata = markdown ? parseMarkdownMetadata(markdown) : {};
      return Object.assign(
        {
          name: path.basename(filePath, ".md"),
        },
        metadata.description ? { description: metadata.description } : {},
      ) satisfies ProviderNativeCommandDescriptor;
    }),
  );
  const commandsByName = new Map<string, ProviderNativeCommandDescriptor>();
  for (const command of [...providerBuiltInCommands(provider), ...discoveredCommands]) {
    commandsByName.set(command.name, command);
  }
  return [...commandsByName.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function discoverProviderPlugins(
  provider: ProviderKind,
  homePath = homedir(),
): Promise<ProviderPluginDescriptor[]> {
  const files = await walkFiles(
    providerPluginRoots(provider, homePath),
    (_filePath, fileName) => fileName === "plugin.json",
  );

  const plugins = await Promise.all(
    files.map(async (filePath) => {
      const text = await readTextFile(filePath);
      let parsed: Record<string, unknown> = {};
      if (text) {
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      }

      const name =
        typeof parsed.name === "string" && parsed.name.trim().length > 0
          ? parsed.name.trim()
          : path.basename(path.dirname(path.dirname(filePath)));
      const description =
        typeof parsed.description === "string" && parsed.description.trim().length > 0
          ? parsed.description.trim()
          : undefined;

      return Object.assign(
        {
          id: filePath,
          name,
          path: filePath,
          installed: true,
          enabled: true,
          interface: Object.assign(
            {
              displayName: name,
            },
            description ? { shortDescription: description } : {},
          ),
        },
        description ? { description } : {},
      ) satisfies ProviderPluginDescriptor;
    }),
  );

  return plugins;
}
