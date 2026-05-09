import { spawn } from "node:child_process";

export interface OracleDevToolInput {
  readonly prompt: string;
  readonly files?: readonly string[];
  readonly outputPath?: string;
  readonly model?: string;
  readonly thinkingTime?: string;
  readonly browserModelStrategy?: string;
  readonly browserTimeout?: string;
  readonly dryRun?: boolean;
  readonly oracleCommand?: string;
}

export interface OracleDevToolCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function buildOracleDevToolCommand(input: OracleDevToolInput): OracleDevToolCommand {
  const command = input.oracleCommand?.trim() || "npx";
  const args = command === "npx" ? ["-y", "@steipete/oracle"] : [];
  args.push(
    "--engine",
    "browser",
    "--model",
    input.model ?? "gpt-5.5-pro",
    "--browser-manual-login",
    "--browser-model-strategy",
    input.browserModelStrategy ?? "select",
    "--browser-thinking-time",
    input.thinkingTime ?? "heavy",
    "--browser-auto-reattach-delay",
    "5s",
    "--browser-auto-reattach-interval",
    "3s",
    "--browser-auto-reattach-timeout",
    "60s",
  );

  if (input.browserTimeout) {
    args.push("--browser-timeout", input.browserTimeout);
  }
  if (input.dryRun) {
    args.push("--dry-run", "summary");
  }

  args.push("-p", input.prompt);
  for (const file of input.files ?? []) {
    args.push("--file", file);
  }
  if (input.outputPath) {
    args.push("--write-output", input.outputPath);
  }

  return { command, args };
}

export async function runOracleDevTool(input: OracleDevToolInput): Promise<void> {
  const { command, args } = buildOracleDevToolCommand(input);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `Oracle exited after signal ${signal}.`
            : `Oracle exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}
