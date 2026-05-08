# Provider Usage CLI

This document explains how `wobex usage` reads Claude and Codex rate limit data,
what the terminal output means, and how another local agent such as
`vibestats` should consume it.

## Commands

Human-readable terminal output:

```bash
wobex usage claude
wobex usage codex
wobex usage all
wobex usage local
```

Machine-readable JSON output:

```bash
wobex usage claude --json
wobex usage codex --json
wobex usage all --json
wobex usage local --json
```

Repeated terminal refresh:

```bash
wobex usage all --watch 10m
```

The global command is installed as:

```bash
/Users/developer/.bun/bin/wobex
```

`Wobex` is an alias for the same binary.

## Output Shape

The JSON output is the stable integration surface. It is intentionally free of
ANSI colors and spinner text.

```json
{
  "provider": "codex",
  "refreshedAt": "2026-04-17T20:39:36.534Z",
  "cached": false,
  "available": true,
  "rateLimits": {
    "windows": [
      {
        "label": "Codex 5h",
        "usedPercent": 28,
        "remainingPercent": 72,
        "resetsAt": "2026-04-17T21:24:45.000Z",
        "kind": "session",
        "windowMinutes": 300,
        "source": "app-server"
      }
    ]
  }
}
```

Important fields:

- `available`: `true` when usage data was parsed successfully.
- `error`: present only when `available` is `false`.
- `rateLimits.windows`: one entry per known usage window.
- `label`: display label, for example `Claude 5h`, `Claude weekly`,
  `Codex 5h`, or `GPT-5.3-Codex-Spark weekly`.
- `usedPercent`: provider-reported used percentage.
- `remainingPercent`: `100 - usedPercent`, clamped to `0..100`.
- `resetsAt`: ISO timestamp when the provider gives a structured reset time.
- `resetLabel`: provider text when only a textual reset label is available.
- `kind`: normalized window type: `session`, `weekly`, or `other`.
- `windowMinutes`: numeric window duration when the provider reports one.
- `source`: current values are `tmux` for Claude and `app-server` for Codex.

For reset display, prefer:

```ts
const reset = window.resetLabel ?? window.resetsAt ?? null;
```

Claude currently returns text labels such as `3am (Europe/Berlin)`. Codex
currently returns ISO timestamps.

## Human CLI Rendering

Plain output is optimized for terminals:

- Claude rows are green.
- Codex rows are blue.
- Each row includes a remaining-usage bar.
- Weekly Codex rows include a linear pace line when `resetsAt` and
  `windowMinutes` are available.
- A `Loading Usage` spinner is shown while the probe is running in a TTY.

Example:

```text
Codex Usage
  Loading source app-server · fresh · 2026-04-17T21:13:53.037Z
  Codex 5h                    ███████████████░░░░░░░░░   63% remaining  37% used  reset 2026-04-17T21:24:45.000Z
  Codex weekly                █████████████████████░░░   87% remaining  13% used  reset 2026-04-23T18:00:57.000Z
  Pace         3.2% reserve vs linear plan (16.2% expected). Lasts until reset.
```

Do not parse this output in automation. Use `--json`.

### Pace

Pace is deliberately simple and deterministic:

```text
expectedUsedPercent = elapsedWindowMinutes / windowMinutes * 100
deltaPercent = usedPercent - expectedUsedPercent
```

Interpretation:

- `reserve`: usage is below the linear weekly budget.
- `ahead`: usage is above the linear weekly budget.
- `on track`: within roughly two percentage points of the linear budget.

This is not historical forecasting yet. It is the same conservative first step
as the CodexBar-style pace concept, without using dashboard cookies or remote
web account data.

## Claude Data Path

Claude usage is read through a temporary headless tmux session:

1. `wobex` creates a tmux session named `wobex-claude-usage-<random>`.
2. The session launches the local `claude` CLI.
3. `wobex` sends `/usage` and `Enter`.
4. `wobex` captures the pane text with `tmux capture-pane`.
5. The parser extracts these Claude sections:
   - `Current session`
   - `Current week (all models)`
   - `Current week (Sonnet only)`
6. The labels are normalized to:
   - `Claude 5h`
   - `Claude weekly`
   - `Claude weekly Sonnet`
7. The tmux session is killed in a `finally` cleanup block.

The implementation lives in:

- `apps/server/src/claudeUsageProbe.ts`
- `apps/server/src/claudeUsageProbe.test.ts`

Why tmux:

- Claude exposes the useful usage view through the interactive `/usage`
  command.
- The current implementation avoids Anthropic API keys and direct provider API
  calls from Wobex.
- The only dependency is the local authenticated `claude` CLI.

Operational notes:

- `wobex usage claude` chooses a stable default working directory so it also
  works from `/tmp` or `$HOME`.
- `--cwd <path>` can override the launch directory when needed.
- If Claude changes the `/usage` text format, the parser test should be updated
  before changing the parser.

## Codex Data Path

Codex usage is read through the local Codex app-server, not tmux:

1. `wobex` spawns `codex app-server` over stdio.
2. `wobex` sends JSON-RPC `initialize` with experimental API capabilities.
3. `wobex` sends `initialized`.
4. `wobex` sends JSON-RPC request `account/rateLimits/read`.
5. The structured result is normalized into `rateLimits.windows`.
6. The app-server process is killed after the response or on failure.

The app-server response currently includes a primary `codex` limit and may also
include model-specific limits under `rateLimitsByLimitId`, such as Spark:

```json
{
  "rateLimits": {
    "limitId": "codex",
    "primary": {
      "usedPercent": 28,
      "windowDurationMins": 300,
      "resetsAt": 1776461085
    },
    "secondary": {
      "usedPercent": 11,
      "windowDurationMins": 10080,
      "resetsAt": 1776967257
    }
  },
  "rateLimitsByLimitId": {
    "codex_bengalfox": {
      "limitName": "GPT-5.3-Codex-Spark",
      "primary": {
        "usedPercent": 2,
        "windowDurationMins": 300
      },
      "secondary": {
        "usedPercent": 1,
        "windowDurationMins": 10080
      }
    }
  }
}
```

Normalization rules:

- `windowDurationMins: 300` becomes `5h`.
- `windowDurationMins: 10080` becomes `weekly`.
- `windowDurationMins: 300` also sets `kind: "session"` and
  `windowMinutes: 300`.
- `windowDurationMins: 10080` also sets `kind: "weekly"` and
  `windowMinutes: 10080`.
- Unix reset timestamps are converted to ISO strings.
- The main `codex` limit becomes `Codex 5h` and `Codex weekly`.
- Named limits become `<limitName> 5h` and `<limitName> weekly`.

The implementation lives in:

- `apps/server/src/codexUsageProbe.ts`
- `apps/server/src/codexUsageProbe.test.ts`

Why app-server:

- It is the same local Codex integration surface Wobex already uses.
- It returns structured rate limit data.
- It avoids fragile terminal scraping for Codex.

Important caveat:

- Wobex does not call a provider REST API directly for this command.
  Codex app-server is a local authenticated Codex process and may internally
  refresh account state as part of `account/rateLimits/read`.

## Local Usage Comparison

`wobex usage local` reads local session files and produces token totals for a
lookback window:

```bash
wobex usage local --since-days 7
wobex usage local --since-days 30 --json
```

Current local sources:

- Codex: `~/.codex/sessions/**/*.jsonl`
- Codex archived sessions: `~/.codex/archived_sessions/*.jsonl`
- Claude: `~/.claude/usage-data/session-meta/*.json`

Codex JSONL files contain cumulative per-session token usage snapshots. The
reader takes the highest cumulative snapshot per session file, so it does not
sum every token-count event in a file. Claude session metadata already stores
session-level `input_tokens` and `output_tokens`.

Important limitations:

- Local files are historical token/session usage, not provider quota state.
- They do not contain the live Claude 5h/weekly limit values shown by
  `/usage`.
- They do not reliably contain Codex 5h/weekly reset state.
- `cached` is shown separately because cached input tokens are a subset of
  input usage in Codex logs, not an extra quota bucket to blindly add to input.
- No provider pricing table is applied, so the command reports token totals,
  not dollar cost.

Use this local view to compare "what did we actually run locally?" against the
live quota view from `wobex usage all`.

## Vibestats Integration

`vibestats` should call the JSON commands and treat them as external probes.

Recommended polling command:

```bash
wobex usage all --json
```

For manual dashboards or terminal panels:

```bash
wobex usage all --watch 10m
```

Recommended TypeScript helper:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type UsageWindow = {
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  resetLabel?: string;
  kind?: "session" | "weekly" | "other";
  windowMinutes?: number;
  source: string;
};

type UsageResult = {
  provider: "codex" | "claudeAgent" | "opencode" | "droid";
  refreshedAt: string;
  cached: boolean;
  available: boolean;
  error?: string;
  rateLimits: {
    windows: UsageWindow[];
  };
};

async function readProviderUsage(provider: "codex" | "claude"): Promise<UsageResult> {
  const { stdout } = await execFileAsync("wobex", ["usage", provider, "--json"], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout) as UsageResult;
}

async function readAllUsage(): Promise<{
  providers: UsageResult[];
  localUsage: unknown;
}> {
  const { stdout } = await execFileAsync("wobex", ["usage", "all", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
```

Recommended vibestats behavior:

- Prefer `wobex usage all --json` for a single process call.
- Poll both providers independently only when partial failure isolation matters.
- Use a 10-15 second process timeout.
- If `available === false`, record the `error` and keep the previous good
  sample for display.
- Store `refreshedAt` from the result, not the local wall-clock receive time.
- Use `remainingPercent` for gauges and alerts.
- Use `resetLabel ?? resetsAt` for the reset display.
- Do not parse ANSI terminal output.
- Do not depend on row order; identify windows by `label`.

Suggested alert thresholds:

- `remainingPercent <= 20`: warning.
- `remainingPercent <= 10`: critical.
- `available === false`: stale/unavailable, not zero remaining.

Suggested normalized vibestats record:

```json
{
  "provider": "codex",
  "window": "Codex 5h",
  "remainingPercent": 72,
  "usedPercent": 28,
  "reset": "2026-04-17T21:24:45.000Z",
  "kind": "session",
  "windowMinutes": 300,
  "source": "app-server",
  "refreshedAt": "2026-04-17T20:39:36.534Z"
}
```

## Failure Modes

Claude:

- `tmux` is not installed.
- `claude` is not installed or not logged in.
- Claude TUI changes the `/usage` text.
- Claude does not render usage output before the timeout.

Codex:

- `codex` is not installed or not logged in.
- `codex app-server` fails to start.
- `account/rateLimits/read` is not supported by the installed Codex version.
- The app-server returns an unexpected JSON shape.

In all cases, `wobex usage <provider> --json` should still return a JSON object
with `available: false` and an `error` string whenever the process itself can
complete.

## Quick Manual Checks

```bash
wobex usage claude
wobex usage codex
wobex usage all
wobex usage local --since-days 7
wobex usage claude --json | jq .
wobex usage codex --json | jq .
wobex usage all --json | jq .
wobex usage local --json | jq .
tmux list-sessions -F '#S' | rg '^wobex-claude-usage' || true
```

The final tmux command should print nothing after a successful Claude probe.
