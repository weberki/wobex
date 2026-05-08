import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";

import type {
  Options as ClaudeQueryOptions,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

interface ClaudeCliStreamQuery extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<void>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly close: () => void;
}

class AsyncMessageQueue implements AsyncIterable<SDKMessage> {
  private readonly queue: Array<SDKMessage> = [];
  private readonly waiters: Array<{
    readonly resolve: (value: IteratorResult<SDKMessage>) => void;
    readonly reject: (reason: unknown) => void;
  }> = [];
  private done = false;
  private failure: unknown | undefined;

  emit(message: SDKMessage): void {
    if (this.done) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: message });
      return;
    }
    this.queue.push(message);
  }

  fail(cause: unknown): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.failure = cause;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(cause);
    }
  }

  finish(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          const value = this.queue.shift();
          if (value) {
            return Promise.resolve({
              done: false,
              value,
            });
          }
        }
        if (this.failure !== undefined) {
          const failure = this.failure;
          this.failure = undefined;
          return Promise.reject(failure);
        }
        if (this.done) {
          return Promise.resolve({
            done: true,
            value: undefined,
          });
        }
        return new Promise((resolve, reject) => {
          this.waiters.push({
            resolve,
            reject,
          });
        });
      },
    };
  }
}

function extractPromptText(message: SDKUserMessage): string {
  const content = message.message.content;
  if (typeof content === "string") {
    return content;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || block.type !== "text") {
      throw new Error(
        "Claude CLI stream transport currently supports text-only prompts. Use the SDK transport for attachments.",
      );
    }
    parts.push(typeof block.text === "string" ? block.text : "");
  }
  return parts.join("\n");
}

function messageWithSessionId<T extends Record<string, unknown>>(
  message: T,
  sessionId: string | undefined,
): T {
  if (!sessionId || typeof message.session_id === "string") {
    return message;
  }
  return {
    ...message,
    session_id: sessionId,
  };
}

function makeSyntheticStreamEvent(
  sessionId: string | undefined,
  event: Record<string, unknown>,
): SDKMessage {
  return {
    type: "stream_event",
    session_id: sessionId ?? "",
    uuid: crypto.randomUUID(),
    parent_tool_use_id: null,
    event,
  } as SDKMessage;
}

function makeSyntheticToolResultUserMessage(
  sessionId: string | undefined,
  content: Array<Record<string, unknown>>,
): SDKMessage {
  return {
    type: "user",
    session_id: sessionId ?? "",
    uuid: crypto.randomUUID(),
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    },
  } as SDKMessage;
}

function normalizeAssistantMessage(record: Record<string, unknown>): ReadonlyArray<SDKMessage> {
  const content =
    record.message && typeof record.message === "object"
      ? (record.message as { content?: unknown }).content
      : undefined;
  if (!Array.isArray(content)) {
    return [record as SDKMessage];
  }

  const sessionId = typeof record.session_id === "string" ? record.session_id : undefined;
  const normalized: SDKMessage[] = [];
  const assistantToolResults: Array<Record<string, unknown>> = [];

  for (const [index, rawBlock] of content.entries()) {
    if (!rawBlock || typeof rawBlock !== "object") {
      continue;
    }

    const block = rawBlock as Record<string, unknown>;
    switch (block.type) {
      case "text": {
        normalized.push(
          makeSyntheticStreamEvent(sessionId, {
            type: "content_block_start",
            index,
            content_block: block,
          }),
        );
        const text = typeof block.text === "string" ? block.text : "";
        if (text.length > 0) {
          normalized.push(
            makeSyntheticStreamEvent(sessionId, {
              type: "content_block_delta",
              index,
              delta: {
                type: "text_delta",
                text,
              },
            }),
          );
        }
        normalized.push(
          makeSyntheticStreamEvent(sessionId, {
            type: "content_block_stop",
            index,
          }),
        );
        break;
      }
      case "thinking": {
        const thinking = typeof block.thinking === "string" ? block.thinking : "";
        if (thinking.length > 0) {
          normalized.push(
            makeSyntheticStreamEvent(sessionId, {
              type: "content_block_delta",
              index,
              delta: {
                type: "thinking_delta",
                thinking,
              },
            }),
          );
        }
        break;
      }
      case "tool_use": {
        normalized.push(
          makeSyntheticStreamEvent(sessionId, {
            type: "content_block_start",
            index,
            content_block: block,
          }),
        );
        break;
      }
      case "tool_result":
        assistantToolResults.push(block);
        break;
      default:
        break;
    }
  }

  normalized.push(record as SDKMessage);

  if (assistantToolResults.length > 0) {
    normalized.push(makeSyntheticToolResultUserMessage(sessionId, assistantToolResults));
  }

  return normalized;
}

function normalizeCliStreamLine(
  line: string,
  fallbackSessionId: string | undefined,
): ReadonlyArray<SDKMessage> {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const record = messageWithSessionId(parsed as Record<string, unknown>, fallbackSessionId);
  switch (record.type) {
    case "assistant":
      return normalizeAssistantMessage(record);
    case "system":
    case "user":
    case "result":
    case "tool_progress":
    case "tool_use_summary":
    case "auth_status":
    case "rate_limit_event":
    case "stream_event":
      return [record as SDKMessage];
    default:
      return [];
  }
}

class ClaudeCliStreamQueryRuntime implements ClaudeCliStreamQuery {
  private readonly queue = new AsyncMessageQueue();
  private currentProcess: ChildProcess | undefined;
  private currentSessionId: string | undefined;
  private currentModel: string | undefined;
  private currentPermissionMode: PermissionMode | undefined;
  private currentMaxThinkingTokens: number | null = null;
  private interrupted = false;
  private closed = false;

  constructor(
    private readonly prompt: AsyncIterable<SDKUserMessage>,
    private readonly options: ClaudeQueryOptions,
  ) {
    this.currentSessionId = options.resume;
    this.currentModel = options.model;
    this.currentPermissionMode = options.permissionMode;
    void this.consumePromptLoop().catch(() => undefined);
  }

  private buildArgs(promptText: string): string[] {
    const args = ["-p", promptText, "--output-format", "stream-json", "--verbose"];
    args.push("--include-hook-events");

    if (this.currentSessionId) {
      args.push("--resume", this.currentSessionId);
    } else if (this.options.sessionId) {
      args.push("--session-id", this.options.sessionId);
    }

    if (this.currentModel) {
      args.push("--model", this.currentModel);
    }
    if (this.options.effort) {
      args.push("--effort", this.options.effort);
    }
    if (this.currentPermissionMode) {
      args.push("--permission-mode", this.currentPermissionMode);
    }
    if (this.currentPermissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    }
    if (this.options.settingSources && this.options.settingSources.length > 0) {
      args.push("--setting-sources", this.options.settingSources.join(","));
    }
    if (this.options.settings && Object.keys(this.options.settings).length > 0) {
      args.push("--settings", JSON.stringify(this.options.settings));
    }
    for (const directory of this.options.additionalDirectories ?? []) {
      args.push("--add-dir", directory);
    }

    void this.currentMaxThinkingTokens;

    return args;
  }

  private async consumePromptLoop(): Promise<void> {
    try {
      for await (const message of this.prompt) {
        if (this.closed) {
          break;
        }
        const promptText = extractPromptText(message);
        await this.runPrompt(promptText);
      }
      this.queue.finish();
    } catch (cause) {
      if (!this.closed) {
        this.queue.fail(cause);
      }
    }
  }

  private async runPrompt(promptText: string): Promise<void> {
    const binaryPath = this.options.pathToClaudeCodeExecutable || "claude";
    const child = spawn(binaryPath, this.buildArgs(promptText), {
      cwd: this.options.cwd,
      env: this.options.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!child.stdout || !child.stderr) {
      throw new Error("Claude CLI stream process did not expose stdout/stderr pipes.");
    }
    this.currentProcess = child;
    this.interrupted = false;

    let sawResult = false;
    let stderr = "";
    const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length >= 16_384) {
        return;
      }
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });

    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of lines) {
        if (this.closed) {
          break;
        }
        for (const message of normalizeCliStreamLine(line, this.currentSessionId)) {
          if (typeof message.session_id === "string" && message.session_id.length > 0) {
            this.currentSessionId = message.session_id;
          }
          if (message.type === "result") {
            sawResult = true;
          }
          this.queue.emit(message);
        }
      }
    } finally {
      lines.close();
    }

    const { code, signal } = await closePromise;
    this.currentProcess = undefined;
    if (this.closed) {
      return;
    }
    if (this.interrupted || signal === "SIGTERM" || signal === "SIGINT") {
      throw new Error("interrupted by user");
    }
    if (code !== 0 && !sawResult) {
      const detail = stderr.trim();
      throw new Error(
        detail.length > 0
          ? `Claude CLI stream process failed: ${detail}`
          : `Claude CLI stream process failed with code ${code}.`,
      );
    }
  }

  readonly interrupt = async (): Promise<void> => {
    this.interrupted = true;
    this.currentProcess?.kill("SIGTERM");
  };

  readonly setModel = async (model?: string): Promise<void> => {
    this.currentModel = model;
  };

  readonly setPermissionMode = async (mode: PermissionMode): Promise<void> => {
    this.currentPermissionMode = mode;
  };

  readonly setMaxThinkingTokens = async (maxThinkingTokens: number | null): Promise<void> => {
    this.currentMaxThinkingTokens = maxThinkingTokens;
  };

  readonly close = (): void => {
    this.closed = true;
    this.currentProcess?.kill("SIGTERM");
    this.queue.finish();
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.queue[Symbol.asyncIterator]();
  }
}

export function createClaudeCliStreamQuery(input: {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: ClaudeQueryOptions;
}): ClaudeCliStreamQuery {
  return new ClaudeCliStreamQueryRuntime(input.prompt, input.options);
}
