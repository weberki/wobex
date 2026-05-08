# Relay Operator Notes

The Relay is a public transport and auth service for worldwide mobile host control. It must not become an execution environment or a conversation database.

## Components

- `apps/relay`: Node/TypeScript Relay service foundation.
- `packages/contracts/src/relay.ts`: shared schema-only Relay contracts.
- `apps/server/src/relayHostConfig.ts`: host-local Relay registration token storage.
- `wobex cloud connect/status/disconnect`: host CLI for storing and inspecting Relay registration state.
- `deploy/relay`: VPS Docker Compose stack for Relay, Postgres, and Caddy.

Current V2.0 contract coverage:

- `RelayHostTunnelAuthInput` / `RelayHostTunnelAuthResult`
- `RelaySignedRemoteSessionClaim` / `RelayRemoteSessionBootstrapInput`
- `RelayRemoteSessionClaim` / `RelayRemoteSessionBootstrapResult`
- `RelayHostPairingPollResult`
- `RelayHostListItem`
- `RelayListDevicesResult`
- `RelayRevokeDeviceInput` / `RelayRevokeDeviceResult`
- relay tunnel frames for `http.*`, `ws.*`, `host.status`, and `host.error`

## Data Policy

Relay Postgres may contain:

- users
- login_challenges
- user_sessions
- devices
- hosts
- host_pairing_intents
- host_grants
- host_registration_tokens
- host_statuses
- audit_events

Relay Postgres must not contain:

- prompts
- messages
- conversations
- workspace files
- file contents
- diffs
- terminal output
- provider secrets
- host SQLite orchestration state
- resume cursors

Audit metadata is limited to scalar routing and operational metadata. Do not log request bodies, WebSocket payloads, provider chunks, prompts, messages, diffs, file contents, or terminal output.

Host registration tokens are stored as salted hashes in `host_registration_tokens`. The raw token may exist only transiently in Relay process memory while a just-approved pairing intent is being returned to the host. Postgres must not persist raw host registration tokens.

## Environment

Expected production settings for the Relay service:

- `RELAY_PUBLIC_URL`: public HTTPS origin, for example `https://code.example.com`
- `RELAY_DATABASE_URL`: Postgres connection string
- `RELAY_SESSION_COOKIE_SECRET`: cookie signing/encryption secret
- `RELAY_SIGNING_KEY_ID`: identifier for Relay claim-signing material distributed to approved hosts
- `RELAY_SIGNING_KEY`: shared signing secret used for short-lived Relay remote-session claims
- `RELAY_EMAIL_FROM`: sender address for login codes
- `RELAY_EMAIL_REPLY_TO`: optional reply-to address for Relay login emails
- `RELAY_SMTP_HOST`: SMTP hostname
- `RELAY_SMTP_PORT`: SMTP port, usually `587` or `465`
- `RELAY_SMTP_SECURE`: `true` for implicit TLS SMTP, otherwise `false`
- `RELAY_SMTP_USER`: optional SMTP username
- `RELAY_SMTP_PASSWORD`: optional SMTP password
- `RELAY_ALLOWED_ORIGINS`: comma-separated HTTPS origins accepted for browser and WebSocket requests
- `RELAY_DEBUG_AUTH_CODES`: must be `false` on exposed public domains

Local development may use HTTP on localhost. Production must be HTTPS-only with secure HTTP-only cookies.

## Production Database

Use Postgres for Relay production. SQLite is acceptable only for local development, throwaway demos, or a private single-user prototype. The public Relay is a multi-device, multi-host auth and routing service, so it needs normal production database properties: concurrent writes, transactional session and grant updates, token revocation, audit retention, backups, restore drills, and a clean path to future scaling.

On a VPS, run the Relay and Postgres as separate containers:

- `relay`: the `apps/relay` Node service, configured with `RELAY_DATABASE_URL`, `RELAY_PUBLIC_URL`, cookie secret, allowed origins, and email settings.
- `postgres`: a dedicated Postgres container with a named volume, restricted network access, and automated backups.
- reverse proxy: Caddy, Traefik, or Nginx terminates TLS and forwards only HTTPS/WebSocket traffic to `relay`.

Do not bake Postgres into the Relay container. Keep the database lifecycle separate so Relay deploys, database upgrades, backups, and restores can be handled independently.

Minimal deployment shape:

```yaml
services:
  relay:
    image: Wobex-relay:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      RELAY_PUBLIC_URL: https://code.example.com
      RELAY_DATABASE_URL: postgres://relay:${RELAY_POSTGRES_PASSWORD}@postgres:5432/relay
      RELAY_SESSION_COOKIE_SECRET: ${RELAY_SESSION_COOKIE_SECRET}
      RELAY_ALLOWED_ORIGINS: https://code.example.com
      RELAY_EMAIL_FROM: code@example.com
    ports:
      - "127.0.0.1:8787:8787"

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: relay
      POSTGRES_USER: relay
      POSTGRES_PASSWORD: ${RELAY_POSTGRES_PASSWORD}
    volumes:
      - relay-postgres:/var/lib/postgresql/data

volumes:
  relay-postgres:
```

The checked-in VPS stack is in `deploy/relay`:

```bash
cd deploy/relay
cp .env.example .env
docker compose up -d --build
```

It includes Caddy for TLS/WebSocket proxying. The Relay service stays on the internal Docker network and is not bound directly to the public host.

The first production topology should stay single Relay process or sticky-session based, because active host tunnel WebSockets live in Relay process memory. Postgres stores durable metadata only; it does not route active tunnel frames.

If the Relay process restarts after an owner approves a host but before the host polls the raw registration token, the host should start a new pairing flow. This keeps the database secret-free instead of storing a recoverable raw host token.

## Migration Rules

The current migration definition is in `apps/relay/src/postgresMigrations.ts`. It intentionally defines only metadata tables. Keep migration reviews strict:

- Adding a content-like table or column is a design violation.
- Adding JSON metadata is allowed only for scalar routing/audit metadata.
- Any new audit key must be checked against the Zero Content policy.

## Host Token Operations

Relay host registration tokens are rotatable and revocable. The host stores the current token locally:

```bash
wobex cloud connect \
  --relay-url https://code.example.com \
  --host-id host_123 \
  --registration-token <relay-issued-token>
```

Inspect without revealing secrets:

```bash
wobex cloud status
```

Remove local host registration:

```bash
wobex cloud disconnect
```

Production token rotation should issue a new Relay token, update the host-local token, revoke the previous token, and force the old tunnel to disconnect.

## Current Public E2E Blockers

The VPS stack can run the Relay service and is suitable for private/public smoke tests of:

- health checks
- Postgres metadata persistence
- Relay login with debug codes
- host pairing approval
- host tunnel connection and status
- relay-signed remote bootstrap into a host-issued local bearer session
- Relay Web environment reconnect with a persisted host bearer token

The secure public baseline now includes:

- passwordless recovery/bootstrap email through SMTP with `RELAY_DEBUG_AUTH_CODES=false`
- browser passkeys/WebAuthn per trusted device for login plus short-lived write step-up
- host tunnel auth via host keypair challenge-response instead of durable-token-only tunnel login
- write elevation tied to a fresh passkey step-up, while Relay defaults to read-first sessions
- device and host revoke actions in the Relay UI, gated behind active write step-up

Remaining production limits:

- Remote Owner stays disabled over Relay
- active host tunnels still require a single Relay process or sticky sessions
- the Relay remains metadata-only and does not persist payloads, files, prompts, diffs, or terminal output

## Scaling

The first Relay deployment should be a single Node process or use sticky sessions, because active host tunnel sockets are in memory. Horizontal scaling needs a later broker layer for host connection routing.

## Required Checks

Before merging Relay changes:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Do not use `bun test`; use `bun run test`.
