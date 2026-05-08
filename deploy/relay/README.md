# Wobex Relay Deployment

This directory is the VPS deployment shape for worldwide mobile host control.

It runs:

- `relay`: the Node/Bun Relay app from `apps/relay`
- `postgres`: durable metadata only
- `caddy`: HTTPS and WebSocket reverse proxy

The Relay is transport and account/device auth only. It must not execute agents or persist prompts, messages, diffs, terminal output, provider chunks, workspace files, provider secrets, host SQLite data, or resume cursors.

## Production Shape

Use Postgres, not SQLite, on the VPS. Keep Postgres in a separate container or managed database so backups, upgrades, and restores are independent from Relay deploys.

```bash
cd deploy/relay
cp .env.example .env
```

Edit `.env` with real secrets and a real domain:

- `RELAY_DOMAIN`: hostname for Caddy, for example `code.example.com`
- `RELAY_PUBLIC_URL`: public HTTPS origin, for example `https://code.example.com`
- `RELAY_ALLOWED_ORIGINS`: comma-separated allowed browser origins
- `RELAY_POSTGRES_PASSWORD`: long random database password
- `RELAY_SESSION_COOKIE_SECRET`: long random cookie secret
- `RELAY_EMAIL_FROM`: sender address for Relay login emails
- `RELAY_SMTP_HOST`: SMTP hostname
- `RELAY_SMTP_PORT`: SMTP port
- `RELAY_SMTP_SECURE`: `true` for implicit TLS SMTP
- `RELAY_SMTP_USER`: optional SMTP username
- `RELAY_SMTP_PASSWORD`: optional SMTP password

Start it:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f relay
```

Health check:

```bash
curl https://code.example.com/healthz
```

## Host Connection

On the Mac Mini, MacBook, or another host machine, install/build the CLI and connect the host outbound:

```bash
wobex cloud connect --relay-url https://code.example.com
```

The command prints a device code and approval URL. Approve it in the Relay UI, then the host stores the registration token locally. The token is hidden from status output:

```bash
wobex cloud status
```

Disconnect local Relay registration:

```bash
wobex cloud disconnect
```

## Current Public-Prod Notes

The Docker stack is enough to run the Relay service and test metadata, login, host registration, and tunnel plumbing on a VPS.

The secure public baseline now includes:

- SMTP-backed recovery/bootstrap email with `RELAY_DEBUG_AUTH_CODES=false`
- Relay-signed remote session bootstrap so the host issues local Agent-control bearer sessions for `relay:<userId>:<deviceId>`
- Relay-hosted web environment setup that consumes the host bearer session before opening `/api/auth/ws-token` or `/h/:hostId/ws`
- Host keypair challenge-response on the outbound host tunnel
- Passkey/WebAuthn login plus short-lived write step-up

Remaining production limits:

- Remote Owner stays disabled
- mutating Relay settings actions require an active write step-up
- active host tunnels still need a single Relay process or sticky sessions

For private smoke tests only, `RELAY_DEBUG_AUTH_CODES=true` returns login codes in API responses. Do not use that setting on an exposed public domain.
