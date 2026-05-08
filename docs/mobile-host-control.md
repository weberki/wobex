# Mobile Host Control

Mobile host control keeps all execution and persistence on the host machine. A phone or tablet is only a client: it submits commands, receives streamed results, answers approvals/user-input prompts, reloads snapshots, and reconnects to the same host state.

## Runtime Model

- The Mac Mini or MacBook host owns the workspace, SQLite database, provider CLIs, provider sessions, terminal state, and file access.
- The mobile browser/PWA does not run agents and does not store provider secrets or workspace files.
- The canonical route shape is still environment plus thread. Desktop and mobile clients reopen the same host-backed thread.
- Running provider processes are an optimization. The durable state is the orchestration read model, persisted provider bindings, resume cursors, activities, pending approvals/user-input projections, and session metadata.

## V1 Access Flow

Use a trusted private network such as a tailnet for V1. Start a headless host with a reachable private address:

```bash
wobex serve --host "$(tailscale ip -4)"
```

The command prints a connection string, access role, token, pairing URL, and QR code. Scan the QR code on the phone or enter the pairing URL from another client.

The headless pairing default is **Agent control**. Owner access is available only when explicitly requested from owner tooling, such as Settings or `wobex auth pairing create --role owner`.

## Roles

- **Agent control** is the default for mobile and headless pairing. It is intended for chat, streaming, approvals, files, terminal, and git work within granted capabilities.
- **Owner** is for trusted administration clients. Owner sessions can manage local backend exposure, create owner pairing links, and revoke other clients.
- Startup owner bootstrap links remain hidden from normal pairing-link lists.

## Mobile UI States

The mobile dashboard surfaces host state separately from the raw WebSocket state:

- `Online`: the host is connected and snapshot bootstrap is complete.
- `Reconnecting`: the client is reopening the host connection.
- `Replaying`: the client is catching up missed orchestration events.
- `Recovered`: replay or snapshot recovery completed after a reconnect.
- `Offline`: the host connection is closed or failed.

The mobile thread composer stays pinned at the bottom of the viewport so submit/approval control remains reachable while scrolling long logs.

## Stale Pending Requests

Provider callback state may disappear after app or host restarts. When a pending approval or user-input response targets an unknown provider request, the server records a structured stale request payload on the failure activity:

```ts
{
  staleRequest: {
    kind: "approval" | "user-input",
    requestId: "..."
  }
}
```

The web client uses that structured marker to clear stale pending prompts and show a restart-oriented status instead of leaving the phone blocked on a dead approval.

## Relay V2 Architecture

Relay V2 adds a public Node service in `apps/relay`. The service exists so the mobile Web UI can be reached worldwide without exposing the host directly.

The boundary stays strict:

- The host opens an outbound WebSocket tunnel to the relay.
- The relay serves the mobile Web UI and authenticates accounts/devices.
- The relay keeps host presence and routes HTTP/WebSocket traffic to the host.
- Agent execution, provider secrets, workspace files, SQLite orchestration, provider bindings, resume cursors, prompts, messages, diffs, and terminal output stay on the host.
- Relay Postgres stores only metadata tables: `users`, `login_challenges`, `user_sessions`, `devices`, `hosts`, `host_pairing_intents`, `host_grants`, `host_registration_tokens`, `host_statuses`, and `audit_events`.

The current foundation implements the schema and metadata layer for that boundary:

- `packages/contracts/src/relay.ts` defines schema-only Relay contracts and tunnel frames, including `RelayHostTunnelAuthInput`, `RelayHostTunnelAuthResult`, `RelayRemoteSessionClaim`, `RelayRemoteSessionBootstrapResult`, `RelayHostPairingPollResult`, and `RelayHostListItem`.
- `apps/relay` contains the Relay metadata store, Postgres-backed metadata repository, host registration token rotation, host pairing intents, audit metadata checks, and an in-memory tunnel registry.
- `wobex cloud connect/status/disconnect` stores or clears the host registration token locally under the host secrets directory. The CLI status output never prints the token.
- `deploy/relay` contains the VPS deployment scaffold: Relay container, Postgres container, Caddy reverse proxy, and `.env` template.

Known V2.0 limits:

- Relay stores metadata only. It does not persist prompts, messages, diffs, files, terminal output, or provider chunks.
- Relay-created host sessions are `client` sessions with Agent control by default.
- Relay tunnel payloads may be proxied in memory but are not replayed from Relay storage.
- Relay scaling is still single-process or sticky-session only; a non-sticky broker layer is a later milestone.
- Raw host registration tokens are not persisted in Relay Postgres. Only salted token hashes and scalar pairing metadata are durable.
- Relay now signs a remote-session claim, the host validates it with locally stored Relay trust material, and the host issues the final local bearer session before `/api/auth/ws-token` and `/h/:hostId/ws` are used.
- Public Relay V2 now includes host keypair challenge-response for the outbound host tunnel, SMTP-backed recovery email delivery, browser passkeys/WebAuthn for login and write step-up, and Relay-side device/host revoke flows that require a fresh write step-up.
- Remote Owner is still disabled, and the first production topology should still be single-process or sticky-session.

Production Relay deployments should use Postgres, not SQLite. On a VPS the recommended shape is one Relay Node container plus one separate Postgres container with a named volume and backups, behind an HTTPS reverse proxy. SQLite remains a local/dev fallback only because the public Relay needs durable concurrent metadata writes, token revocation, audit retention, and straightforward backup/restore.

## Relay Host Registration Flow

The production flow should be:

1. Host starts registration from `wobex cloud connect` or Desktop Settings → Remote Access.
2. Relay creates a short-lived host pairing intent and displays a QR/device code.
3. Owner signs in to the Relay and approves the host.
4. Relay creates a host record and returns a rotatable host registration token.
5. Host generates and registers a local Ed25519 host keypair, stores the registration token plus trusted Relay signing material locally, and uses the keypair for tunnel challenge-response.
6. Relay marks the host as `online`, `reconnecting`, `replaying`, `recovered`, or `offline`.

The local token storage step is now available from the CLI:

```bash
wobex cloud connect \
  --relay-url https://code.example.com \
  --host-id host_123 \
  --registration-token <relay-issued-token>
```

Use this to inspect or remove the local Relay host registration:

```bash
wobex cloud status
wobex cloud disconnect
```

`wobex cloud connect` now completes the full enrollment path: pairing approval returns the registration token, the host registers its public key with the Relay, stores the trusted Relay signing key locally, and only then opens the outbound tunnel.

## Relay Tunnel Frames

Relay tunnel frames are versioned envelopes. The relay may inspect routing metadata but must not persist frame payloads:

- `http.request`
- `http.response`
- `ws.open`
- `ws.message`
- `ws.close`
- `host.status`
- `host.error`

Allowed persisted metadata includes `hostId`, `deviceId`, `requestId`, `streamId`, timestamps, status codes, and byte counts. Payload bodies, prompts, messages, file contents, diffs, terminal output, and provider data must remain transient.

## Remote Session Mapping

Relay authentication is not the final authority for workspace access. The host still creates and validates the local auth session.

For remote devices, Relay asks the host for a local session with:

- subject: `relay:<userId>:<deviceId>`
- role: `client`
- default capabilities: Agent control

Remote Owner remains disabled by default. Owner-only capabilities such as `auth:admin` and `settings:admin` must stay blocked over Relay until a later explicit host policy enables them.

Implementation status: relay-signed remote host bootstrap is wired end to end for read-first Relay environments, the web client persists the host-issued bearer token before opening the proxied WebSocket, and Relay browsers can now register a passkey, sign in with it, and refresh short-lived write access with a passkey step-up. Tailnet/direct is still the safer production default until host key challenge-response and production-grade recovery email delivery are complete.
Implementation status: relay-signed remote host bootstrap is wired end to end for read-first Relay environments, the web client persists the host-issued bearer token before opening the proxied WebSocket, Relay browsers can register a passkey, sign in with it, refresh short-lived write access with a passkey step-up, and revoke Relay devices or hosts from mobile settings while write step-up is active. Tailnet/direct is still the simpler production default if you do not need worldwide access.
