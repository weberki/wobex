---
name: play-desktop
description: Start or explain the Wobex Electron desktop app for local development when the user asks to play, launch, run, or open the desktop app.
---

# Play Desktop

Use this workflow when the user wants Codex to start the local Wobex Electron app.

1. Confirm the current working directory is the Wobex repository root.
2. Run `bun run play` for the normal desktop development loop. This aliases `bun run dev:desktop`, which starts the web app and Electron desktop app together with the correct loopback ports.
3. Use `bun run play:web` only when the user explicitly asks for the browser/web development app instead of Electron.
4. For a production-like desktop launch from built artifacts, run `bun run build:desktop` followed by `bun run start:desktop`.
5. If the user asks for a desktop smoke check, run `bun run test:desktop-smoke`.

When starting the dev app, keep the process running and report the command/session status clearly. If verification is needed after code changes, follow the repository rule: use `bun run test`, never `bun test`.
