# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Wobex is a Windows-first web and desktop GUI for coding agents (Codex, Claude, OpenCode, Droid). It is a public fork of T3 Code and keeps T3 Code available as a manual reference for selective fix adoption. The project is early WIP; sweeping maintainability improvements are encouraged.

## Commands

```bash
# Development
bun run dev              # Full stack (server + web) with hot reload
bun run dev:server       # Server only
bun run dev:web          # Web only
bun run dev:desktop      # Desktop (Electron) + server

# Build
bun run build            # Full build (all workspaces via Turbo)
bun run build:contracts  # Contracts package only (needed before first dev)

# Quality (all must pass before task completion)
bun run fmt              # Format with oxfmt
bun run fmt:check        # Check formatting
bun run lint             # Lint with oxlint
bun run typecheck        # TypeScript type checking

# Testing — ALWAYS use `bun run test`, NEVER `bun test`
bun run test             # All Vitest tests (Turbo-coordinated)
cd apps/server && bun run test              # Server tests only
cd apps/web && bun run test                 # Web tests only
cd apps/web && bun run test:browser         # Browser tests (Playwright)

# Single test file
cd apps/server && npx vitest run src/server.test.ts
cd apps/server && npx vitest run src/provider/Layers/ProviderAdapterRegistry.test.ts

# Production
bun run build && bun run start
```

## Git Policy

- **Commits**: Small, focused commits per implementation step. Do not batch unrelated changes.
- origin is the public Wobex repo under weberki/wobex; keep history clean.
- T3 Code is the read-only reference. Never blindly merge upstream. Cherry-pick or hand-port specific fixes.

## Core Priorities

1. Performance first
2. Reliability first
3. Predictable behavior under load and failures (session restarts, reconnects, partial streams)

Choose correctness and robustness over short-term convenience.

## Monorepo Structure

**Package manager**: Bun. **Build orchestration**: Turbo. **Runtime framework**: Effect 4.0 (beta).

| Workspace                 | Package                 | Role                                                                                                                                |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`             | `wobex`                 | Node.js WebSocket server. Wraps provider backends (Codex, Claude, etc.) over JSON-RPC stdio, manages sessions, orchestrates events. |
| `apps/web`                | `@wobex/web`            | React 19 + Vite 8 UI. TanStack Router/Query, Tailwind 4, xterm, Lexical editor. Connects to server via WebSocket.                   |
| `apps/desktop`            | `@wobex/desktop`        | Electron 40 shell around the web app.                                                                                               |
| `apps/marketing`          | `@wobex/marketing`      | Astro marketing site.                                                                                                               |
| `packages/contracts`      | `@wobex/contracts`      | Effect/Schema type definitions. Schema-only — no runtime logic.                                                                     |
| `packages/shared`         | `@wobex/shared`         | Shared utilities. Explicit subpath exports only (`@wobex/shared/git`, `/logging`, etc.) — no barrel index.                          |
| `packages/client-runtime` | `@wobex/client-runtime` | Minimal client-side runtime.                                                                                                        |

## Architecture

### Event-Sourced Orchestration

All state changes flow through an event-sourcing pipeline:

```
Client (WebSocket RPC)
  -> wsServer routes request
  -> OrchestrationEngine.dispatch(command)
    -> decider: (command, readModel) -> event[]   # pure function
    -> persist events to SQLite
    -> projector: (readModel, event) -> readModel  # pure function
    -> Reactor layers handle side effects async
  -> ServerPushBus -> Client receives domain events
```

Key files:

- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — command dispatch + persistence
- `apps/server/src/orchestration/decider.ts` — pure decision function
- `apps/server/src/orchestration/projector.ts` — pure projection function

### Provider System (4 backends)

Providers (Codex, Claude, OpenCode, Droid) share a unified adapter interface:

- **Adapter** (`provider/Layers/[Name]Adapter.ts`): Protocol handler. Translates provider-agnostic RPC to provider-specific protocol and back.
- **ProviderAdapterRegistry** (`provider/Layers/ProviderAdapterRegistry.ts`): In-memory lookup of `ProviderKind -> Adapter`.
- **ProviderService** (`provider/Layers/ProviderService.ts`): Cross-provider orchestrator. Routes validated RPC through Registry + SessionDirectory.
- **ProviderSessionDirectory** (`provider/Layers/ProviderSessionDirectory.ts`): Persistent store of thread-to-provider bindings (which adapter, session ID, runtime mode, resume cursor).

Codex is the primary provider. It runs as `codex app-server` (JSON-RPC over stdio) managed by `apps/server/src/codexAppServerManager.ts`.

### Services vs Layers Pattern

Effect-based dependency injection throughout:

- **Services/** directories: Abstract interfaces (`Context.Service` definitions)
- **Layers/** directories: Concrete implementations + dependency wiring (`Layer` definitions)

This separation enables swapping implementations and mocking in tests.

### Background Workers (Reactors)

Side effects run as queue-backed workers using `DrainableWorker`:

- **ProviderCommandReactor**: Reacts to orchestration intent events, dispatches provider calls
- **ProviderRuntimeIngestion**: Consumes provider event streams, emits orchestration commands
- **CheckpointReactor**: Captures git checkpoints on turn start/complete
- **RuntimeReceiptBus**: Typed signals for async milestone completion (tests wait on these, not polling)

### Git Text Generation

Separate from the interactive provider system. Fire-and-forget CLI subprocesses for commit messages, PR descriptions, branch names:

- `git/Layers/RoutingTextGeneration.ts` routes to Claude or Codex based on `modelSelection.provider`
- `git/Layers/CodexTextGeneration.ts` / `ClaudeTextGeneration.ts` spawn CLI processes

### WebSocket Protocol

Request/Response: `{ id, method, params }` -> `{ id, result }` or `{ id, error }`
Push events: typed envelopes with `channel`, `sequence` (monotonic), channel-specific `data`
Push channels: `server.welcome`, `server.configUpdated`, `terminal.event`, `orchestration.domainEvent`

Methods mirror `NativeApi` in contracts: `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`, etc.

### Mobile Host Control

Remote mobile control is host-based. The Mac Mini/MacBook keeps the workspace, SQLite database, provider CLIs, resume cursors, terminal state, and orchestration read model. Phone/tablet clients only submit commands, stream or replay results, answer approvals/user-input prompts, and reconnect to host state.

- V1 access is tailnet/direct host access. `wobex serve --host "$(tailscale ip -4)"` prints a pairing URL and QR code.
- Agent control is the default role for mobile/headless pairing. Owner must be selected explicitly for trusted administration clients.
- Startup owner bootstrap links are hidden from normal pairing-link listings.
- The web client tracks host recovery states separately from raw WebSocket state: online, reconnecting, replaying, recovered, offline.
- Stale provider approvals/user-input callbacks are recorded with structured `staleRequest` metadata so the UI can clear dead prompts and show a restart-oriented status.

Detailed docs: `REMOTE.md`, `docs/mobile-host-control.md`.

## Maintainability

Extract shared logic — don't duplicate across files. Check for existing modules before adding new functionality. Changing existing code is encouraged. Don't take shortcuts by adding local logic to avoid touching shared code.

## Reference

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- Upstream repo: https://github.com/pingdotgg/t3code
- Codex-Monitor (reference impl): https://github.com/Dimillian/CodexMonitor
- Detailed architecture docs: `.docs/architecture.md`, `.docs/provider-architecture.md`
