# AGENTS.md

## Project Mission

Wobex is a Windows-first, local-first desktop and web client for coding agents. It is a fork of T3 Code published under the `weberki` identity with its own product direction, branding, release process, and governance.

## Task Completion Requirements

- After making code changes, always run the relevant tests and lint checks if available.
- For this Bun monorepo, the default completion gate is:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
- NEVER run `bun test`. Always use `bun run test` so the repo's Vitest command is used.
- If the relevant checks pass, create a small focused git commit unless the user explicitly says not to.
- Do not push, deploy, or test in production unless the user explicitly asks.
- If uncertain about pushing, deploying, production testing, or public repository creation, ask in chat first.

## Git Remote Policy

- `origin` should point to the primary Wobex repository, expected to be `git@github.com-weberki:weberki/wobex.git`.
- Do not keep an active `upstream` remote in this repository.
- Do not blindly merge T3 Code history.
- T3 Code may be cloned temporarily outside the workspace for research.
- Port fixes or features manually through focused patches, with attribution and tests.
- Preserve MIT license notices for substantial code derived from T3 Code.

## Core Priorities

1. Windows-first reliability.
2. Local-first privacy and secret handling.
3. Provider-neutral architecture for Codex, Claude, OpenCode, Gemini, and future adapters.
4. Predictable behavior under load, restarts, reconnects, partial streams, and provider failures.
5. Maintainability over shortcuts.

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Package Roles

- `apps/server`: Local backend and CLI. Wraps provider CLIs/app servers, serves the web app, manages provider sessions, persistence, terminal, Git, and orchestration.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, diffs, terminals, settings, and client-side state.
- `apps/desktop`: Electron shell. Starts and supervises the local backend and provides native desktop integration.
- `apps/relay`: Optional remote/mobile relay. It must stay metadata-only and must not execute agents or persist prompts, diffs, files, terminal output, provider chunks, provider secrets, or host SQLite data.
- `packages/contracts`: Shared schemas and TypeScript contracts. Keep this package schema-only.
- `packages/shared`: Shared runtime utilities consumed by server, web, and desktop. Prefer explicit subpath exports; avoid broad barrel files.

## Provider Boundary

Provider adapters should stay isolated behind a common driver shape:

- discover installed/authenticated state, version, models, account labels, and capabilities
- start or resume sessions
- send turns
- interrupt active turns
- respond to approvals and user-input requests
- read or rollback provider history where supported
- optionally expose structured usage/rate-limit data

Adapters emit normalized runtime events. Orchestration persists and projects those events for the UI.

## Reference Repos

- T3 Code: https://github.com/pingdotgg/t3code
- OpenAI Codex: https://github.com/openai/codex

Use these as references only. Do not add them as active upstream remotes.
