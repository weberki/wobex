import { readActiveCodexProviderEnvKey } from "@wobex/shared/codexConfig";
import {
  readEnvironmentFromLoginShell,
  resolveLoginShell,
  type ShellEnvironmentReader,
} from "@wobex/shared/shell";

const CODEX_PROCESS_SHELL_ENV_NAMES = ["PATH", "SSH_AUTH_SOCK"] as const;

export function buildCodexProcessEnv(
  input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly homePath?: string;
    readonly platform?: NodeJS.Platform;
    readonly readEnvironment?: ShellEnvironmentReader;
  } = {},
): NodeJS.ProcessEnv {
  const baseEnv = { ...(input.env ?? process.env) };
  const effectiveEnv = input.homePath ? { ...baseEnv, CODEX_HOME: input.homePath } : baseEnv;
  const platform = input.platform ?? process.platform;

  if (platform !== "darwin" && platform !== "linux") {
    return effectiveEnv;
  }

  try {
    const shell = resolveLoginShell(platform, effectiveEnv.SHELL);
    const providerEnvKey = readActiveCodexProviderEnvKey(effectiveEnv);
    if (!shell || !providerEnvKey || effectiveEnv[providerEnvKey]?.trim()) {
      return effectiveEnv;
    }

    const shellEnvironment = (input.readEnvironment ?? readEnvironmentFromLoginShell)(shell, [
      ...CODEX_PROCESS_SHELL_ENV_NAMES,
      providerEnvKey,
    ]);

    if (shellEnvironment.PATH) {
      effectiveEnv.PATH = shellEnvironment.PATH;
    }
    if (!effectiveEnv.SSH_AUTH_SOCK && shellEnvironment.SSH_AUTH_SOCK) {
      effectiveEnv.SSH_AUTH_SOCK = shellEnvironment.SSH_AUTH_SOCK;
    }
    if (shellEnvironment[providerEnvKey]) {
      effectiveEnv[providerEnvKey] = shellEnvironment[providerEnvKey];
    }
  } catch {
    // Keep inherited environment if shell lookup or config parsing fails.
  }

  return effectiveEnv;
}
