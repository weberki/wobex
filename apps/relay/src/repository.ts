import postgres, { type Sql, type TransactionSql } from "postgres";

import { RelayMetadataStore, type RelayMetadataSnapshot } from "./metadataStore";
import { relayPostgresMigrations } from "./postgresMigrations";
import { type Clock, systemClock } from "./time";
import type {
  RelayAuditEvent,
  RelayDevice,
  RelayHost,
  RelayHostGrant,
  RelayHostPairingIntent,
  RelayPasskeyChallenge,
  RelayPasskeyCredential,
  RelayHostRegistrationToken,
  RelayHostStatus,
  RelayLoginChallenge,
  RelayUser,
  RelayUserSession,
} from "./types";

export interface RelayRepository {
  readonly kind: "memory" | "postgres";
  readonly store: RelayMetadataStore;
  assertReady(): void;
  initialize(): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class InMemoryRelayRepository implements RelayRepository {
  readonly kind = "memory" as const;
  readonly store: RelayMetadataStore;

  constructor(clock: Clock = systemClock) {
    this.store = new RelayMetadataStore(clock);
  }

  assertReady(): void {}

  async initialize(): Promise<void> {}

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}

export class PostgresRelayRepository implements RelayRepository {
  readonly kind = "postgres" as const;
  readonly store: RelayMetadataStore;
  readonly #sql: Sql;
  #initialized = false;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(databaseUrl: string, clock: Clock = systemClock) {
    this.#sql = postgres(databaseUrl, {
      max: 5,
    });
    this.store = new RelayMetadataStore(clock);
  }

  assertReady(): void {}

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    for (const migration of relayPostgresMigrations) {
      await this.#sql.unsafe(migration.sql);
    }
    this.store.hydrate(await this.#loadSnapshot());
    this.#initialized = true;
  }

  async flush(): Promise<void> {
    if (!this.#initialized) {
      await this.initialize();
    }
    const snapshot = this.store.snapshot();
    this.#writeQueue = this.#writeQueue.catch(() => {}).then(() => this.#writeSnapshot(snapshot));
    await this.#writeQueue;
  }

  async close(): Promise<void> {
    if (this.#initialized) {
      await this.flush();
    }
    await this.#sql.end({ timeout: 5 });
  }

  async #loadSnapshot(): Promise<RelayMetadataSnapshot> {
    const [
      users,
      loginChallenges,
      devices,
      sessions,
      passkeyCredentials,
      passkeyChallenges,
      hosts,
      hostPairingIntents,
      hostGrants,
      hostRegistrationTokens,
      hostStatuses,
      auditEvents,
    ] = await Promise.all([
      this.#sql`select * from users order by created_at asc`,
      this.#sql`select * from login_challenges order by created_at asc`,
      this.#sql`select * from devices order by created_at asc`,
      this.#sql`select * from user_sessions order by created_at asc`,
      this.#sql`select * from passkey_credentials order by created_at asc`,
      this.#sql`select * from passkey_challenges order by created_at asc`,
      this.#sql`select * from hosts order by created_at asc`,
      this.#sql`select * from host_pairing_intents order by created_at asc`,
      this.#sql`select * from host_grants order by created_at asc`,
      this.#sql`select * from host_registration_tokens order by created_at asc`,
      this.#sql`select * from host_statuses`,
      this.#sql`select * from audit_events order by created_at asc`,
    ]);

    return {
      users: users.map(rowToUser),
      loginChallenges: loginChallenges.map(rowToLoginChallenge),
      devices: devices.map(rowToDevice),
      sessions: sessions.map(rowToSession),
      passkeyCredentials: passkeyCredentials.map(rowToPasskeyCredential),
      passkeyChallenges: passkeyChallenges.map(rowToPasskeyChallenge),
      hosts: hosts.map(rowToHost),
      hostPairingIntents: hostPairingIntents.map(rowToPairingIntent),
      hostGrants: hostGrants.map(rowToHostGrant),
      hostRegistrationTokens: hostRegistrationTokens.map(rowToHostRegistrationToken),
      hostStatuses: hostStatuses.map(rowToHostStatus),
      auditEvents: auditEvents.map(rowToAuditEvent),
    };
  }

  async #writeSnapshot(snapshot: RelayMetadataSnapshot): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`delete from audit_events`;
      await sql`delete from host_statuses`;
      await sql`delete from host_registration_tokens`;
      await sql`delete from host_grants`;
      await sql`delete from host_pairing_intents`;
      await sql`delete from passkey_challenges`;
      await sql`delete from user_sessions`;
      await sql`delete from passkey_credentials`;
      await sql`delete from devices`;
      await sql`delete from hosts`;
      await sql`delete from login_challenges`;
      await sql`delete from users`;

      for (const user of snapshot.users) {
        await insertUser(sql, user);
      }
      for (const challenge of snapshot.loginChallenges) {
        await insertLoginChallenge(sql, challenge);
      }
      for (const device of snapshot.devices) {
        await insertDevice(sql, device);
      }
      for (const session of snapshot.sessions) {
        await insertSession(sql, session);
      }
      for (const credential of snapshot.passkeyCredentials) {
        await insertPasskeyCredential(sql, credential);
      }
      for (const challenge of snapshot.passkeyChallenges) {
        await insertPasskeyChallenge(sql, challenge);
      }
      for (const host of snapshot.hosts) {
        await insertHost(sql, host);
      }
      for (const intent of snapshot.hostPairingIntents) {
        await insertHostPairingIntent(sql, intent);
      }
      for (const grant of snapshot.hostGrants) {
        await insertHostGrant(sql, grant);
      }
      for (const token of snapshot.hostRegistrationTokens) {
        await insertHostRegistrationToken(sql, token);
      }
      for (const status of snapshot.hostStatuses) {
        await insertHostStatus(sql, status);
      }
      for (const event of snapshot.auditEvents) {
        await insertAuditEvent(sql, event);
      }
    });
  }
}

export function createRelayRepository(
  databaseUrl: string | undefined,
  clock: Clock = systemClock,
): RelayRepository {
  if (databaseUrl) {
    return new PostgresRelayRepository(databaseUrl, clock);
  }
  return new InMemoryRelayRepository(clock);
}

async function insertUser(sql: TransactionSql, user: RelayUser): Promise<void> {
  await sql`
    insert into users (id, email, created_at, updated_at)
    values (${user.id}, ${user.email}, ${user.createdAt}, ${user.updatedAt})
  `;
}

async function insertLoginChallenge(
  sql: TransactionSql,
  challenge: RelayLoginChallenge,
): Promise<void> {
  await sql`
    insert into login_challenges (
      id, email, device_label, code_salt, code_hash, attempts, created_at, expires_at, verified_at
    )
    values (
      ${challenge.id}, ${challenge.email}, ${challenge.deviceLabel}, ${challenge.codeSalt},
      ${challenge.codeHash}, ${challenge.attempts}, ${challenge.createdAt}, ${challenge.expiresAt},
      ${challenge.verifiedAt ?? null}
    )
  `;
}

async function insertDevice(sql: TransactionSql, device: RelayDevice): Promise<void> {
  await sql`
    insert into devices (
      id, user_id, label, trust_state, created_at, last_seen_at, trusted_at, revoked_at
    )
    values (
      ${device.id}, ${device.userId}, ${device.label}, ${device.trustState}, ${device.createdAt},
      ${device.lastSeenAt}, ${device.trustedAt ?? null}, ${device.revokedAt ?? null}
    )
  `;
}

async function insertSession(sql: TransactionSql, session: RelayUserSession): Promise<void> {
  await sql`
    insert into user_sessions (
      id, user_id, device_id, auth_method, token_salt, token_hash, created_at, expires_at,
      last_seen_at, step_up_expires_at, revoked_at
    )
    values (
      ${session.id}, ${session.userId}, ${session.deviceId}, ${session.authMethod},
      ${session.tokenSalt}, ${session.tokenHash}, ${session.createdAt}, ${session.expiresAt},
      ${session.lastSeenAt}, ${session.stepUpExpiresAt ?? null}, ${session.revokedAt ?? null}
    )
  `;
}

async function insertPasskeyCredential(
  sql: TransactionSql,
  credential: RelayPasskeyCredential,
): Promise<void> {
  await sql`
    insert into passkey_credentials (
      id, user_id, device_id, webauthn_user_id, credential_id, public_key, counter, transports,
      backed_up, created_at, last_used_at, revoked_at
    )
    values (
      ${credential.id}, ${credential.userId}, ${credential.deviceId}, ${credential.webauthnUserId},
      ${credential.credentialId}, ${credential.publicKey}, ${credential.counter},
      ${sql.array(credential.transports)}, ${credential.backedUp}, ${credential.createdAt},
      ${credential.lastUsedAt ?? null}, ${credential.revokedAt ?? null}
    )
  `;
}

async function insertPasskeyChallenge(
  sql: TransactionSql,
  challenge: RelayPasskeyChallenge,
): Promise<void> {
  await sql`
    insert into passkey_challenges (
      id, user_id, session_id, device_id, purpose, challenge, created_at, expires_at, consumed_at
    )
    values (
      ${challenge.id}, ${challenge.userId}, ${challenge.sessionId ?? null},
      ${challenge.deviceId ?? null}, ${challenge.purpose}, ${challenge.challenge},
      ${challenge.createdAt}, ${challenge.expiresAt}, ${challenge.consumedAt ?? null}
    )
  `;
}

async function insertHost(sql: TransactionSql, host: RelayHost): Promise<void> {
  await sql`
    insert into hosts (
      id, user_id, label, created_at, host_key_id, host_public_key_pem, host_key_algorithm,
      host_key_updated_at, revoked_at
    )
    values (
      ${host.id}, ${host.userId}, ${host.label}, ${host.createdAt}, ${host.hostKeyId ?? null},
      ${host.hostPublicKeyPem ?? null}, ${host.hostKeyAlgorithm ?? null},
      ${host.hostKeyUpdatedAt ?? null}, ${host.revokedAt ?? null}
    )
  `;
}

async function insertHostPairingIntent(
  sql: TransactionSql,
  intent: RelayHostPairingIntent,
): Promise<void> {
  await sql`
    insert into host_pairing_intents (
      id, user_id, host_id, host_label, device_code_salt, device_code_hash, status, created_at,
      expires_at, approved_at, registration_token_id, registration_token_expires_at
    )
    values (
      ${intent.id}, ${intent.userId === "pending" ? null : intent.userId}, ${intent.hostId ?? null},
      ${intent.hostLabel}, ${intent.deviceCodeSalt}, ${intent.deviceCodeHash}, ${intent.status},
      ${intent.createdAt}, ${intent.expiresAt}, ${intent.approvedAt ?? null},
      ${intent.registrationTokenId ?? null}, ${intent.registrationTokenExpiresAt ?? null}
    )
  `;
}

async function insertHostGrant(sql: TransactionSql, grant: RelayHostGrant): Promise<void> {
  await sql`
    insert into host_grants (id, host_id, device_id, scope, created_at, revoked_at)
    values (
      ${grant.id}, ${grant.hostId}, ${grant.deviceId}, ${grant.scope}, ${grant.createdAt},
      ${grant.revokedAt ?? null}
    )
  `;
}

async function insertHostRegistrationToken(
  sql: TransactionSql,
  token: RelayHostRegistrationToken,
): Promise<void> {
  await sql`
    insert into host_registration_tokens (
      id, host_id, token_salt, token_hash, created_at, expires_at, revoked_at
    )
    values (
      ${token.id}, ${token.hostId}, ${token.tokenSalt}, ${token.tokenHash}, ${token.createdAt},
      ${token.expiresAt ?? null}, ${token.revokedAt ?? null}
    )
  `;
}

async function insertHostStatus(sql: TransactionSql, status: RelayHostStatus): Promise<void> {
  await sql`
    insert into host_statuses (host_id, state, connected_at, disconnected_at, connection_id)
    values (
      ${status.hostId}, ${status.state}, ${status.connectedAt ?? null},
      ${status.disconnectedAt ?? null}, ${status.connectionId ?? null}
    )
  `;
}

async function insertAuditEvent(sql: TransactionSql, event: RelayAuditEvent): Promise<void> {
  await sql`
    insert into audit_events (
      id, action, actor_user_id, host_id, device_id, request_id, stream_id, status_code, byte_count,
      metadata, created_at
    )
    values (
      ${event.id}, ${event.action}, ${event.actorUserId ?? null}, ${event.hostId ?? null},
      ${event.deviceId ?? null}, ${event.requestId ?? null}, ${event.streamId ?? null},
      ${event.statusCode ?? null}, ${event.byteCount ?? null}, ${sql.json(event.metadata)},
      ${event.createdAt}
    )
  `;
}

function rowToUser(row: Record<string, unknown>): RelayUser {
  return {
    id: String(row.id),
    email: String(row.email),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToLoginChallenge(row: Record<string, unknown>): RelayLoginChallenge {
  const challenge: RelayLoginChallenge = {
    id: String(row.id),
    email: String(row.email),
    deviceLabel: String(row.device_label),
    codeSalt: String(row.code_salt),
    codeHash: String(row.code_hash),
    attempts: Number(row.attempts),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
  const verifiedAt = optionalIso(row.verified_at);
  if (verifiedAt) {
    challenge.verifiedAt = verifiedAt;
  }
  return challenge;
}

function rowToDevice(row: Record<string, unknown>): RelayDevice {
  const device: RelayDevice = {
    id: String(row.id),
    userId: String(row.user_id),
    label: String(row.label),
    trustState: String(row.trust_state ?? "recovery") as RelayDevice["trustState"],
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at ?? row.created_at),
  };
  const trustedAt = optionalIso(row.trusted_at);
  const revokedAt = optionalIso(row.revoked_at);
  if (trustedAt) {
    device.trustedAt = trustedAt;
  }
  if (revokedAt) {
    device.revokedAt = revokedAt;
  }
  return device;
}

function rowToSession(row: Record<string, unknown>): RelayUserSession {
  const session: RelayUserSession = {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    authMethod: String(row.auth_method ?? "email-recovery") as RelayUserSession["authMethod"],
    tokenSalt: String(row.token_salt),
    tokenHash: String(row.token_hash),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    lastSeenAt: iso(row.last_seen_at ?? row.created_at),
  };
  const stepUpExpiresAt = optionalIso(row.step_up_expires_at);
  const revokedAt = optionalIso(row.revoked_at);
  if (stepUpExpiresAt) {
    session.stepUpExpiresAt = stepUpExpiresAt;
  }
  if (revokedAt) {
    session.revokedAt = revokedAt;
  }
  return session;
}

function rowToPasskeyCredential(row: Record<string, unknown>): RelayPasskeyCredential {
  const credential: RelayPasskeyCredential = {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    webauthnUserId: String(row.webauthn_user_id),
    credentialId: String(row.credential_id),
    publicKey: String(row.public_key),
    counter: Number(row.counter),
    transports: Array.isArray(row.transports) ? row.transports.map((entry) => String(entry)) : [],
    backedUp: Boolean(row.backed_up),
    createdAt: iso(row.created_at),
  };
  const lastUsedAt = optionalIso(row.last_used_at);
  const revokedAt = optionalIso(row.revoked_at);
  if (lastUsedAt) {
    credential.lastUsedAt = lastUsedAt;
  }
  if (revokedAt) {
    credential.revokedAt = revokedAt;
  }
  return credential;
}

function rowToPasskeyChallenge(row: Record<string, unknown>): RelayPasskeyChallenge {
  const challenge: RelayPasskeyChallenge = {
    id: String(row.id),
    userId: String(row.user_id),
    purpose: String(row.purpose) as RelayPasskeyChallenge["purpose"],
    challenge: String(row.challenge),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
  const sessionId = optionalString(row.session_id);
  const deviceId = optionalString(row.device_id);
  const consumedAt = optionalIso(row.consumed_at);
  if (sessionId) {
    challenge.sessionId = sessionId;
  }
  if (deviceId) {
    challenge.deviceId = deviceId;
  }
  if (consumedAt) {
    challenge.consumedAt = consumedAt;
  }
  return challenge;
}

function rowToHost(row: Record<string, unknown>): RelayHost {
  const host: RelayHost = {
    id: String(row.id),
    userId: String(row.user_id),
    label: String(row.label),
    createdAt: iso(row.created_at),
  };
  const hostKeyId = optionalString(row.host_key_id);
  const hostPublicKeyPem = optionalString(row.host_public_key_pem);
  const hostKeyAlgorithm = optionalString(row.host_key_algorithm);
  const hostKeyUpdatedAt = optionalIso(row.host_key_updated_at);
  const revokedAt = optionalIso(row.revoked_at);
  if (hostKeyId) {
    host.hostKeyId = hostKeyId;
  }
  if (hostPublicKeyPem) {
    host.hostPublicKeyPem = hostPublicKeyPem;
  }
  if (hostKeyAlgorithm === "ed25519") {
    host.hostKeyAlgorithm = "ed25519";
  }
  if (hostKeyUpdatedAt) {
    host.hostKeyUpdatedAt = hostKeyUpdatedAt;
  }
  if (revokedAt) {
    host.revokedAt = revokedAt;
  }
  return host;
}

function rowToPairingIntent(row: Record<string, unknown>): RelayHostPairingIntent {
  const intent: RelayHostPairingIntent = {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : "pending",
    hostLabel: String(row.host_label),
    deviceCodeSalt: String(row.device_code_salt),
    deviceCodeHash: String(row.device_code_hash),
    status: String(row.status) as RelayHostPairingIntent["status"],
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
  const approvedAt = optionalIso(row.approved_at);
  const hostId = optionalString(row.host_id);
  const registrationTokenId = optionalString(row.registration_token_id);
  const registrationTokenExpiresAt = optionalIso(row.registration_token_expires_at);
  if (approvedAt) {
    intent.approvedAt = approvedAt;
  }
  if (hostId) {
    intent.hostId = hostId;
  }
  if (registrationTokenId) {
    intent.registrationTokenId = registrationTokenId;
  }
  if (registrationTokenExpiresAt) {
    intent.registrationTokenExpiresAt = registrationTokenExpiresAt;
  }
  return intent;
}

function rowToHostGrant(row: Record<string, unknown>): RelayHostGrant {
  const grant: RelayHostGrant = {
    id: String(row.id),
    hostId: String(row.host_id),
    deviceId: String(row.device_id),
    scope: "agent-control" as const,
    createdAt: iso(row.created_at),
  };
  const revokedAt = optionalIso(row.revoked_at);
  if (revokedAt) {
    grant.revokedAt = revokedAt;
  }
  return grant;
}

function rowToHostRegistrationToken(row: Record<string, unknown>): RelayHostRegistrationToken {
  const token: RelayHostRegistrationToken = {
    id: String(row.id),
    hostId: String(row.host_id),
    tokenSalt: String(row.token_salt),
    tokenHash: String(row.token_hash),
    createdAt: iso(row.created_at),
  };
  const expiresAt = optionalIso(row.expires_at);
  const revokedAt = optionalIso(row.revoked_at);
  if (expiresAt) {
    token.expiresAt = expiresAt;
  }
  if (revokedAt) {
    token.revokedAt = revokedAt;
  }
  return token;
}

function rowToHostStatus(row: Record<string, unknown>): RelayHostStatus {
  const status: RelayHostStatus = {
    hostId: String(row.host_id),
    state: String(row.state) as RelayHostStatus["state"],
  };
  const connectedAt = optionalIso(row.connected_at);
  const disconnectedAt = optionalIso(row.disconnected_at);
  const connectionId = optionalString(row.connection_id);
  if (connectedAt) {
    status.connectedAt = connectedAt;
  }
  if (disconnectedAt) {
    status.disconnectedAt = disconnectedAt;
  }
  if (connectionId) {
    status.connectionId = connectionId;
  }
  return status;
}

function rowToAuditEvent(row: Record<string, unknown>): RelayAuditEvent {
  const event: RelayAuditEvent = {
    id: String(row.id),
    action: String(row.action) as RelayAuditEvent["action"],
    metadata: metadataObject(row.metadata),
    createdAt: iso(row.created_at),
  };
  const actorUserId = optionalString(row.actor_user_id);
  const hostId = optionalString(row.host_id);
  const deviceId = optionalString(row.device_id);
  const requestId = optionalString(row.request_id);
  const streamId = optionalString(row.stream_id);
  const statusCode = optionalNumber(row.status_code);
  const byteCount = optionalNumber(row.byte_count);
  if (actorUserId) {
    event.actorUserId = actorUserId;
  }
  if (hostId) {
    event.hostId = hostId;
  }
  if (deviceId) {
    event.deviceId = deviceId;
  }
  if (requestId) {
    event.requestId = requestId;
  }
  if (streamId) {
    event.streamId = streamId;
  }
  if (statusCode !== undefined) {
    event.statusCode = statusCode;
  }
  if (byteCount !== undefined) {
    event.byteCount = byteCount;
  }
  return event;
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function optionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return iso(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function metadataObject(value: unknown): RelayAuditEvent["metadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as RelayAuditEvent["metadata"];
}
