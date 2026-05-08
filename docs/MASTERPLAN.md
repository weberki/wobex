# Wobex Masterplan

Wobex is a Windows-first fork of [T3 Code](https://github.com/pingdotgg/t3code).
The project is published under the `weberki` identity and keeps its own product
direction, branding, release process, and governance.

## Product Direction

- Local-first desktop and web client for coding agents.
- Windows-first packaging, updates, signing, terminal behavior, path handling, and shell integration.
- Provider-neutral runtime for Codex, Claude Code, OpenCode, Gemini, and future local/provider CLIs.
- Privacy-first remote/mobile control where execution, provider credentials, prompts, diffs, files, terminals, and SQLite state stay on the host.
- Open-source development with a clean public history and no active upstream remote.

## Repository Policy

- `origin` is `git@github.com-weberki:weberki/wobex.git`.
- T3 Code is the fork source and manual reference.
- Do not add a persistent `upstream` remote.
- Port ideas and fixes through focused patches with tests.
- Preserve required MIT attribution for T3 Code.

## Implementation Phases

### Phase 1: Public Foundation

- Publish the cleaned repository under `weberki/wobex`.
- Keep Wobex branding consistent across packages, app UI, docs, assets, releases, and telemetry.
- Maintain a single clean public history for the initial release.
- Run formatting, linting, type checking, targeted tests, and secret scans before publication.

### Phase 2: Windows Desktop Reliability

- Harden Electron startup, backend supervision, update checks, logging, and shutdown.
- Make Windows shell/path behavior deterministic.
- Finish signed Windows release artifacts and release smoke tests.
- Keep local data under `WOBEX_HOME` with clear development and production profiles.

### Phase 3: Provider Runtime

- Keep provider adapters isolated behind a common interface.
- Normalize provider events into orchestration events before projecting UI state.
- Expand provider discovery, authenticated-state detection, model metadata, and usage/rate-limit surfaces.
- Keep provider secrets on the host and never send raw secret values back to the renderer.

### Phase 4: Remote And Mobile Control

- Keep relay services metadata-only.
- Prefer tailnet/direct host access when public relay is not needed.
- Keep host-issued bearer sessions as the final authority for remote clients.
- Add mobile-friendly recovery and reconnect flows without moving execution off the host.

### Phase 5: Release And Community

- Publish repeatable release instructions.
- Add contribution guidance and issue templates that match the Wobex roadmap.
- Keep CI focused on formatting, linting, type checking, test coverage, and release artifact smoke checks.
- Avoid automatic upstream merges; review every imported change explicitly.
