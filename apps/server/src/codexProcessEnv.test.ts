import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import OS from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCodexProcessEnv } from "./codexProcessEnv";

const tempDirs: string[] = [];

function makeCodexHome(config: string): string {
  const tempDir = mkdtempSync(join(OS.tmpdir(), "Wobex-codex-env-"));
  tempDirs.push(tempDir);
  writeFileSync(join(tempDir, "config.toml"), config, "utf8");
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("buildCodexProcessEnv", () => {
  it("hydrates the active custom provider env key from the login shell", () => {
    const codexHome = makeCodexHome(
      ['model_provider = "azure"', "", "[model_providers.azure]", 'env_key = "AZURE_KEY"'].join(
        "\n",
      ),
    );
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/shell.sock",
      AZURE_KEY: "shell-secret",
    }));

    const env = buildCodexProcessEnv({
      platform: "darwin",
      env: {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        CODEX_HOME: codexHome,
      },
      readEnvironment,
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", [
      "PATH",
      "SSH_AUTH_SOCK",
      "AZURE_KEY",
    ]);
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/shell.sock");
    expect(env.AZURE_KEY).toBe("shell-secret");
  });

  it("preserves existing provider secrets", () => {
    const codexHome = makeCodexHome(
      ['model_provider = "azure"', "", "[model_providers.azure]", 'env_key = "AZURE_KEY"'].join(
        "\n",
      ),
    );
    const readEnvironment = vi.fn(() => ({
      AZURE_KEY: "shell-secret",
    }));

    const env = buildCodexProcessEnv({
      platform: "darwin",
      env: {
        SHELL: "/bin/zsh",
        CODEX_HOME: codexHome,
        AZURE_KEY: "inherited-secret",
      },
      readEnvironment,
    });

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(env.AZURE_KEY).toBe("inherited-secret");
  });

  it("applies explicit homePath before reading config", () => {
    const codexHome = makeCodexHome(
      ['model_provider = "proxy"', "", "[model_providers.proxy]", 'env_key = "PROXY_KEY"'].join(
        "\n",
      ),
    );
    const readEnvironment = vi.fn(() => ({ PROXY_KEY: "from-shell" }));

    const env = buildCodexProcessEnv({
      platform: "linux",
      homePath: codexHome,
      env: { SHELL: "/bin/bash" },
      readEnvironment,
    });

    expect(env.CODEX_HOME).toBe(codexHome);
    expect(env.PROXY_KEY).toBe("from-shell");
  });
});
