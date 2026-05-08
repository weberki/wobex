# Remote Access

Use this when you want to connect to a Wobex server from another device such as a phone, tablet, or separate desktop app.

For the mobile-first control model, see [docs/mobile-host-control.md](./docs/mobile-host-control.md).
For Relay operations, see [docs/relay-operator.md](./docs/relay-operator.md).

## Decision Matrix

| Access mode       | Use now?                                                                | Network path                                                 | Auth authority                                                       | Relay stores content? | Best for                                       |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| Tailnet/direct V1 | Yes                                                                     | Phone connects directly to the host private address          | Host                                                                 | No relay involved     | Immediate secure mobile control                |
| Public Relay V2   | Private/public read-first smoke path works; hardening still in progress | Host opens outbound tunnel to Relay; phone connects to Relay | Relay authenticates account/device, host authorizes workspace access | No                    | Worldwide access without inbound host exposure |

Tailnet/direct remains the recommended production path when you do not need worldwide access. Relay V2 is designed for worldwide access, stays metadata-only, and defaults to Agent-control. The VPS Relay stack now supports relay-signed host bootstrap into a host-issued local bearer session, browser passkey/WebAuthn registration and login, short-lived write step-up, SMTP-backed recovery email delivery, and host key challenge-response for the outbound tunnel.

## Recommended Setup

Use a trusted private network that meshes your devices together, such as a tailnet.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## Enabling Network Access

There are two ways to expose your server for remote connections: from the desktop app or from the CLI.

### Option 1: Desktop App

If you are already running the desktop app and want to make it reachable from other devices:

1. Open **Settings** → **Connections**.
2. Under **Manage Local Backend**, toggle **Network access** on. This will restart the app and run the backend on all network interfaces.
3. The settings panel will show the address the server is reachable at (e.g. `http://192.168.x.y:3773`).
4. Use **Create Link** to generate a pairing link you can share with another device.
5. Leave the access level on **Agent control** for phones and tablets unless the device needs owner administration rights.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

Run the server with `wobex serve` or `Wobex serve`.

```bash
wobex serve --host "$(tailscale ip -4)"
```

`wobex serve` starts the server without opening a browser and prints:

- a connection string
- the access role
- a pairing token
- a pairing URL
- a QR code for the pairing URL

From there, connect from another device in either of these ways:

- scan the QR code on your phone
- in the desktop app, enter the full pairing URL
- in the desktop app, enter the host and token separately

Use `wobex serve --help` for the full flag reference. It supports the same general startup options as the normal server command, including an optional `cwd` argument.

By default, this headless pairing link creates an **Agent control** session. Use owner pairing only for trusted administration clients.

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `wobex serve` issues a one-time Agent control pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Managing Access Later

Use `wobex auth` to manage access after the initial pairing flow.

Typical uses:

- issue additional pairing credentials
- inspect active sessions
- revoke old pairing links or sessions

Pairing links can be created as Agent control or Owner. Agent control is the default for `wobex serve`, Settings, and `wobex auth pairing create`; Owner must be selected explicitly.

Use `wobex auth --help` and the nested subcommand help pages for the full reference.

## Relay Cloud Host Registration

Relay V2 introduces host registration for worldwide access through a public backend. The Relay app lives in `apps/relay` and stores only account, login challenge, device, host, grant, session, registration-token, host-status, and audit metadata.

Use Postgres for Relay production, especially on a VPS. SQLite is only a local/dev or throwaway single-user option. In production the Relay should run as its own Node container, with Postgres in a separate database container or managed Postgres instance, and an HTTPS reverse proxy in front of the Relay. Do not store provider secrets, workspace files, prompts, messages, diffs, terminal output, resume cursors, raw host registration tokens, or host SQLite orchestration data in that database.

The Docker deployment scaffold lives in `deploy/relay`:

```bash
cd deploy/relay
cp .env.example .env
docker compose up -d --build
```

The stack contains the Relay app, Postgres, and Caddy. Keep `RELAY_DEBUG_AUTH_CODES=false` on real public domains. `RELAY_SMTP_HOST`, `RELAY_SMTP_PORT`, `RELAY_SMTP_SECURE`, `RELAY_SMTP_USER`, `RELAY_SMTP_PASSWORD`, and `RELAY_EMAIL_FROM` should be configured before exposing the Relay publicly.

After a host is approved by the Relay, store the Relay-issued host registration token locally:

```bash
wobex cloud connect \
  --relay-url https://code.example.com \
  --host-id host_123 \
  --registration-token <relay-issued-token>
```

Check or remove that local configuration:

```bash
wobex cloud status
wobex cloud disconnect
```

The status command intentionally hides the registration token. Host token storage is local to the host secrets directory. The Relay must never store provider secrets, workspace files, prompts, messages, diffs, terminal output, or SQLite orchestration state.

Current Relay production limits:

- Remote sessions stay read-first by default; mutating Relay actions such as host/device revoke require a fresh passkey write step-up.
- Remote Owner stays disabled over Relay.
- Active host tunnels still require a single Relay process or sticky sessions.
- Relay stays metadata-only and must not store prompts, messages, diffs, files, terminal output, or provider payloads.

## Security Notes

- Treat pairing URLs and pairing tokens like passwords.
- Prefer binding `--host` to a trusted private address, such as a Tailnet IP, instead of exposing the server broadly.
- Anyone with a valid pairing credential can create a session until that credential expires or is revoked.
- Prefer Agent control for mobile devices. Use Owner only where backend administration is required.
- Use `wobex auth` to revoke credentials or sessions you no longer trust.
- For Relay V2, keep Remote Owner disabled by default. Relay devices should receive Agent-control host sessions unless a future host policy explicitly allows owner sessions.
- Relay audit events may contain only metadata such as host id, device id, request id, stream id, status code, byte count, and timestamps.

## Reconnect and Recovery

The server persists orchestration state on the host. On mobile reload or reconnect, the client loads a snapshot and replays missed orchestration events. The mobile dashboard distinguishes raw transport state from host recovery state:

- **Online**: connected and bootstrapped.
- **Reconnecting**: reopening the host connection.
- **Replaying**: catching up missed host events.
- **Recovered**: replay or snapshot recovery completed.
- **Offline**: the host is not reachable.

If a restart makes a provider approval or user-input callback stale, the server records it as a structured stale pending request. The mobile UI clears the dead prompt and marks the thread as needing a restart-oriented follow-up instead of waiting forever.
