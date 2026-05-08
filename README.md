# Wobex

Wobex is a Windows-first, local-first desktop and web client for coding agents.

This project is a fork of [T3 Code](https://github.com/pingdotgg/t3code), published under the `weberki` identity with its own product direction, release process, and Windows-first roadmap.

## Current Status

This repository is in early bootstrap phase.

## Strategy

- Wobex has no active upstream remote.
- T3 Code is the fork source and reference project.
- Strong ideas and fixes should be ported manually through focused, reviewed patches.
- MIT license notices and attribution must be preserved.
- Windows install, update, signing, terminal, Git, provider discovery, and path handling are release blockers.

## Development

Install dependencies:

```bash
bun install
```

Run the desktop dev loop:

```bash
bun run play
```

Build and start a production-like desktop app:

```bash
bun run build:desktop
bun run start:desktop
```

Default completion checks:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

## Docs

- Masterplan: [docs/MASTERPLAN.md](./docs/MASTERPLAN.md)
- Remote/mobile host control: [docs/mobile-host-control.md](./docs/mobile-host-control.md)
- Observability: [docs/observability.md](./docs/observability.md)
- Provider usage CLI: [docs/provider-usage-cli.md](./docs/provider-usage-cli.md)

## References

Wobex is a fork of [T3 Code](https://github.com/pingdotgg/t3code). Wobex is not affiliated with T3 Tools Inc.
