import { describe, expect, it } from "vitest";
import { parseClaudeUsageText, refreshClaudeUsage } from "./claudeUsageProbe";

describe("claudeUsageProbe", () => {
  it("parses Claude TUI usage windows captured from tmux", () => {
    const windows = parseClaudeUsageText(`
  Current session
  Resets 10pm (Europe/Berlin)                        30% used

  Current week (all models)
  Resets Apr 23 at 9pm (Europe/Berlin)               18% used

  Current week (Sonnet only)
  Resets Apr 23 at 11pm (Europe/Berlin)              2% used
`);

    expect(windows).toEqual([
      {
        label: "Claude 5h",
        resetLabel: "10pm (Europe/Berlin)",
        usedPercent: 30,
        remainingPercent: 70,
        kind: "session",
        source: "tmux",
      },
      {
        label: "Claude weekly",
        resetLabel: "Apr 23 at 9pm (Europe/Berlin)",
        usedPercent: 18,
        remainingPercent: 82,
        kind: "weekly",
        source: "tmux",
      },
      {
        label: "Claude weekly Sonnet",
        resetLabel: "Apr 23 at 11pm (Europe/Berlin)",
        usedPercent: 2,
        remainingPercent: 98,
        kind: "weekly",
        source: "tmux",
      },
    ]);
  });

  it("kills the tmux session when usage output cannot be parsed", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const result = await refreshClaudeUsage({
      provider: "claudeAgent",
      force: true,
      timeoutMs: 1,
      sleepFn: async () => undefined,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return {
          stdout: args[0] === "capture-pane" ? "Claude started but no usage output yet" : "",
          stderr: "",
        };
      },
    });

    expect(result.available).toBe(false);
    expect(result.error).toBe("Claude usage output was not detected.");
    expect(calls.some((call) => call.args[0] === "kill-session")).toBe(true);
  });
});
