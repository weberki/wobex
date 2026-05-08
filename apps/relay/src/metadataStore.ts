import { randomInt, randomUUID } from "node:crypto";

import { hashToken, newHashedToken, tokenMatchesHash } from "./crypto";
import { type Clock, isoNow, systemClock } from "./time";
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

const DEFAULT_LOGIN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_HOST_PAIRING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

const CONTENT_METADATA_KEY_PATTERN =
  /(body|content|conversation|diff|file|message|payload|prompt|terminal|transcript)/i;

export interface LoginStartResult {
  challenge: RelayLoginChallenge;
  code: string;
}

export interface LoginVerifyResult {
  user: RelayUser;
  device: RelayDevice;
  session: RelayUserSession;
  sessionToken: string;
}

export interface HostPairingIntentResult {
  intent: RelayHostPairingIntent;
  deviceCode: string;
}

export interface HostRegistrationResult {
  host: RelayHost;
  registrationToken: RelayHostRegistrationToken;
  token: string;
}

export interface RelayMetadataSnapshot {
  users: readonly RelayUser[];
  devices: readonly RelayDevice[];
  sessions: readonly RelayUserSession[];
  passkeyCredentials: readonly RelayPasskeyCredential[];
  passkeyChallenges: readonly RelayPasskeyChallenge[];
  hosts: readonly RelayHost[];
  hostGrants: readonly RelayHostGrant[];
  loginChallenges: readonly RelayLoginChallenge[];
  hostPairingIntents: readonly RelayHostPairingIntent[];
  hostRegistrationTokens: readonly RelayHostRegistrationToken[];
  hostStatuses: readonly RelayHostStatus[];
  auditEvents: readonly RelayAuditEvent[];
}

export class RelayMetadataStore {
  #clock: Clock;
  #usersById = new Map<string, RelayUser>();
  #usersByEmail = new Map<string, RelayUser>();
  #devicesById = new Map<string, RelayDevice>();
  #sessionsById = new Map<string, RelayUserSession>();
  #passkeyCredentialsById = new Map<string, RelayPasskeyCredential>();
  #passkeyCredentialIds = new Map<string, string>();
  #passkeyChallengesById = new Map<string, RelayPasskeyChallenge>();
  #hostsById = new Map<string, RelayHost>();
  #hostGrantsById = new Map<string, RelayHostGrant>();
  #loginChallengesById = new Map<string, RelayLoginChallenge>();
  #hostPairingIntentsById = new Map<string, RelayHostPairingIntent>();
  #hostTokensById = new Map<string, RelayHostRegistrationToken>();
  #hostStatusesById = new Map<string, RelayHostStatus>();
  #auditEvents: RelayAuditEvent[] = [];

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  startLogin(email: string, deviceLabel = "Remote device"): LoginStartResult {
    const normalized = normalizeEmail(email);
    const code = createNumericCode();
    const hashed = newHashedTokenFromValue(code);
    const now = this.#now();
    const challenge: RelayLoginChallenge = {
      id: randomUUID(),
      email: normalized,
      deviceLabel,
      codeSalt: hashed.salt,
      codeHash: hashed.tokenHash,
      attempts: 0,
      createdAt: now,
      expiresAt: this.#isoAfter(DEFAULT_LOGIN_TTL_MS),
    };
    this.#loginChallengesById.set(challenge.id, challenge);
    this.recordAudit({
      action: "login.start",
      metadata: { challengeId: challenge.id },
    });
    return { challenge, code };
  }

  verifyLogin(challengeId: string, code: string, deviceLabel?: string): LoginVerifyResult {
    const challenge = this.#loginChallengesById.get(challengeId);
    if (!challenge) {
      throw new Error("login challenge not found");
    }
    if (challenge.verifiedAt) {
      throw new Error("login challenge already verified");
    }
    if (isExpired(this.#clock, challenge.expiresAt)) {
      throw new Error("login challenge expired");
    }
    if (challenge.attempts >= MAX_LOGIN_ATTEMPTS) {
      throw new Error("login challenge attempt limit exceeded");
    }

    const attempts = challenge.attempts + 1;
    const updatedChallenge = { ...challenge, attempts };
    this.#loginChallengesById.set(challengeId, updatedChallenge);
    if (!tokenMatchesHash(code, challenge.codeSalt, challenge.codeHash)) {
      throw new Error("invalid login code");
    }

    const user = this.upsertUserByEmail(challenge.email);
    const device = this.createDevice(user.id, deviceLabel ?? challenge.deviceLabel, {
      trustState: "recovery",
    });
    const session = this.createUserSession(user.id, device.id, {
      authMethod: "email-recovery",
    });
    const verifiedChallenge = { ...updatedChallenge, verifiedAt: this.#now() };
    this.#loginChallengesById.set(challengeId, verifiedChallenge);
    this.recordAudit({
      action: "login.verified",
      actorUserId: user.id,
      deviceId: device.id,
      metadata: { challengeId },
    });
    return { user, device, session: session.session, sessionToken: session.token };
  }

  upsertUserByEmail(email: string): RelayUser {
    const normalized = normalizeEmail(email);
    const existing = this.#usersByEmail.get(normalized);
    if (existing) {
      const next: RelayUser = {
        ...existing,
        updatedAt: this.#now(),
      };
      this.#usersById.set(next.id, next);
      this.#usersByEmail.set(normalized, next);
      return next;
    }
    const now = this.#now();
    const user: RelayUser = {
      id: randomUUID(),
      email: normalized,
      createdAt: now,
      updatedAt: now,
    };
    this.#usersById.set(user.id, user);
    this.#usersByEmail.set(normalized, user);
    return user;
  }

  createDevice(
    userId: string,
    label: string,
    options?: {
      readonly trustState?: RelayDevice["trustState"];
    },
  ): RelayDevice {
    const now = this.#now();
    const device: RelayDevice = {
      id: randomUUID(),
      userId,
      label,
      trustState: options?.trustState ?? "recovery",
      createdAt: now,
      lastSeenAt: now,
      ...(options?.trustState === "trusted" ? { trustedAt: now } : {}),
    };
    this.#devicesById.set(device.id, device);
    this.recordAudit({
      action: "device.added",
      actorUserId: userId,
      deviceId: device.id,
      metadata: { label },
    });
    return device;
  }

  revokeDevice(deviceId: string): RelayDevice | undefined {
    const current = this.#devicesById.get(deviceId);
    if (!current || current.revokedAt) {
      return current;
    }
    const revokedAt = this.#now();
    const next: RelayDevice = {
      ...current,
      trustState: "revoked",
      revokedAt,
    };
    this.#devicesById.set(deviceId, next);
    for (const session of this.#sessionsById.values()) {
      if (session.deviceId === deviceId && !session.revokedAt) {
        this.#sessionsById.set(session.id, {
          ...session,
          revokedAt,
        });
      }
    }
    for (const grant of this.#hostGrantsById.values()) {
      if (grant.deviceId === deviceId && !grant.revokedAt) {
        this.#hostGrantsById.set(grant.id, {
          ...grant,
          revokedAt,
        });
      }
    }
    for (const credential of this.#passkeyCredentialsById.values()) {
      if (credential.deviceId === deviceId && !credential.revokedAt) {
        this.#passkeyCredentialsById.set(credential.id, {
          ...credential,
          revokedAt,
        });
      }
    }
    this.recordAudit({
      action: "device.revoked",
      actorUserId: current.userId,
      deviceId,
      metadata: {},
    });
    return next;
  }

  createUserSession(
    userId: string,
    deviceId: string,
    options?: {
      readonly authMethod?: RelayUserSession["authMethod"];
    },
  ): { session: RelayUserSession; token: string } {
    const token = newHashedToken();
    const now = this.#now();
    const session: RelayUserSession = {
      id: randomUUID(),
      userId,
      deviceId,
      authMethod: options?.authMethod ?? "email-recovery",
      tokenSalt: token.salt,
      tokenHash: token.tokenHash,
      createdAt: now,
      expiresAt: this.#isoAfter(DEFAULT_SESSION_TTL_MS),
      lastSeenAt: now,
    };
    this.#sessionsById.set(session.id, session);
    return { session, token: token.token };
  }

  verifyUserSession(sessionId: string, token: string): RelayUserSession | undefined {
    const session = this.#sessionsById.get(sessionId);
    if (!session || session.revokedAt || isExpired(this.#clock, session.expiresAt)) {
      return undefined;
    }
    if (!tokenMatchesHash(token, session.tokenSalt, session.tokenHash)) {
      return undefined;
    }
    const touched: RelayUserSession = {
      ...session,
      lastSeenAt: this.#now(),
    };
    this.#sessionsById.set(sessionId, touched);
    return touched;
  }

  elevateUserSession(sessionId: string, ttlMs: number): RelayUserSession | undefined {
    const session = this.#sessionsById.get(sessionId);
    if (!session || session.revokedAt || isExpired(this.#clock, session.expiresAt)) {
      return undefined;
    }
    const next: RelayUserSession = {
      ...session,
      stepUpExpiresAt: this.#isoAfter(ttlMs),
      lastSeenAt: this.#now(),
    };
    this.#sessionsById.set(sessionId, next);
    return next;
  }

  clearSessionElevation(sessionId: string): RelayUserSession | undefined {
    const session = this.#sessionsById.get(sessionId);
    if (!session || session.stepUpExpiresAt === undefined) {
      return session;
    }
    const { stepUpExpiresAt: _stepUpExpiresAt, ...next } = session;
    this.#sessionsById.set(sessionId, next);
    return next;
  }

  trustDevice(deviceId: string): RelayDevice | undefined {
    const current = this.#devicesById.get(deviceId);
    if (!current || current.revokedAt) {
      return current;
    }
    const now = this.#now();
    const next: RelayDevice = {
      ...current,
      trustState: "trusted",
      lastSeenAt: now,
      trustedAt: current.trustedAt ?? now,
    };
    this.#devicesById.set(deviceId, next);
    return next;
  }

  addPasskeyCredential(input: {
    readonly userId: string;
    readonly deviceId: string;
    readonly webauthnUserId: string;
    readonly credentialId: string;
    readonly publicKey: string;
    readonly counter: number;
    readonly transports: string[];
    readonly backedUp: boolean;
  }): RelayPasskeyCredential {
    const existingId = this.#passkeyCredentialIds.get(input.credentialId);
    if (existingId) {
      const existing = this.#passkeyCredentialsById.get(existingId);
      if (existing) {
        return existing;
      }
    }
    const credential: RelayPasskeyCredential = {
      id: randomUUID(),
      userId: input.userId,
      deviceId: input.deviceId,
      webauthnUserId: input.webauthnUserId,
      credentialId: input.credentialId,
      publicKey: input.publicKey,
      counter: input.counter,
      transports: [...input.transports],
      backedUp: input.backedUp,
      createdAt: this.#now(),
    };
    this.#passkeyCredentialsById.set(credential.id, credential);
    this.#passkeyCredentialIds.set(credential.credentialId, credential.id);
    this.trustDevice(input.deviceId);
    return credential;
  }

  listPasskeyCredentialsForUser(userId: string): readonly RelayPasskeyCredential[] {
    return [...this.#passkeyCredentialsById.values()].filter(
      (credential) => credential.userId === userId && !credential.revokedAt,
    );
  }

  listPasskeyCredentialsForDevice(deviceId: string): readonly RelayPasskeyCredential[] {
    return [...this.#passkeyCredentialsById.values()].filter(
      (credential) => credential.deviceId === deviceId && !credential.revokedAt,
    );
  }

  getPasskeyCredentialByCredentialId(credentialId: string): RelayPasskeyCredential | undefined {
    const id = this.#passkeyCredentialIds.get(credentialId);
    return id ? this.#passkeyCredentialsById.get(id) : undefined;
  }

  getUserByEmail(email: string): RelayUser | undefined {
    return this.#usersByEmail.get(normalizeEmail(email));
  }

  updatePasskeyCredentialAssertion(
    credentialId: string,
    input: {
      readonly counter: number;
      readonly backedUp: boolean;
    },
  ): RelayPasskeyCredential | undefined {
    const current = this.getPasskeyCredentialByCredentialId(credentialId);
    if (!current || current.revokedAt) {
      return current;
    }
    const next: RelayPasskeyCredential = {
      ...current,
      counter: input.counter,
      backedUp: input.backedUp,
      lastUsedAt: this.#now(),
    };
    this.#passkeyCredentialsById.set(next.id, next);
    return next;
  }

  createPasskeyChallenge(input: {
    readonly userId: string;
    readonly purpose: RelayPasskeyChallenge["purpose"];
    readonly challenge: string;
    readonly sessionId?: string;
    readonly deviceId?: string;
    readonly ttlMs?: number;
  }): RelayPasskeyChallenge {
    const challenge: RelayPasskeyChallenge = {
      id: randomUUID(),
      userId: input.userId,
      purpose: input.purpose,
      challenge: input.challenge,
      createdAt: this.#now(),
      expiresAt: this.#isoAfter(input.ttlMs ?? DEFAULT_PASSKEY_CHALLENGE_TTL_MS),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    };
    this.#passkeyChallengesById.set(challenge.id, challenge);
    return challenge;
  }

  consumePasskeyChallenge(
    challengeId: string,
    purpose: RelayPasskeyChallenge["purpose"],
  ): RelayPasskeyChallenge {
    const challenge = this.#passkeyChallengesById.get(challengeId);
    if (!challenge) {
      throw new Error("passkey challenge not found");
    }
    if (challenge.purpose !== purpose) {
      throw new Error("passkey challenge purpose mismatch");
    }
    if (challenge.consumedAt) {
      throw new Error("passkey challenge already consumed");
    }
    if (isExpired(this.#clock, challenge.expiresAt)) {
      throw new Error("passkey challenge expired");
    }
    const next: RelayPasskeyChallenge = {
      ...challenge,
      consumedAt: this.#now(),
    };
    this.#passkeyChallengesById.set(challengeId, next);
    return next;
  }

  revokeUserSession(sessionId: string): RelayUserSession | undefined {
    const current = this.#sessionsById.get(sessionId);
    if (!current || current.revokedAt) {
      return current;
    }
    const next: RelayUserSession = {
      ...current,
      revokedAt: this.#now(),
    };
    this.#sessionsById.set(sessionId, next);
    this.recordAudit({
      action: "logout",
      actorUserId: current.userId,
      deviceId: current.deviceId,
      metadata: { sessionId },
    });
    return next;
  }

  createHost(userId: string, label: string): RelayHost {
    const host: RelayHost = {
      id: randomUUID(),
      userId,
      label,
      createdAt: this.#now(),
    };
    this.#hostsById.set(host.id, host);
    this.setHostStatus(host.id, "offline");
    this.recordAudit({
      action: "host.added",
      actorUserId: userId,
      hostId: host.id,
      metadata: { label },
    });
    return host;
  }

  revokeHost(hostId: string): RelayHost | undefined {
    const current = this.#hostsById.get(hostId);
    if (!current || current.revokedAt) {
      return current;
    }
    const revokedAt = this.#now();
    const next: RelayHost = {
      ...current,
      revokedAt,
    };
    this.#hostsById.set(hostId, next);
    this.setHostStatus(hostId, "offline");
    this.revokeHostTokens(hostId);
    for (const grant of this.#hostGrantsById.values()) {
      if (grant.hostId === hostId && !grant.revokedAt) {
        this.#hostGrantsById.set(grant.id, {
          ...grant,
          revokedAt,
        });
      }
    }
    this.recordAudit({
      action: "host.revoked",
      actorUserId: current.userId,
      hostId,
      metadata: {},
    });
    return next;
  }

  registerHostPublicKey(
    hostId: string,
    registrationToken: string,
    input: {
      readonly hostKeyId: string;
      readonly publicKeyPem: string;
      readonly algorithm: "ed25519";
    },
  ): RelayHost {
    const host = this.#hostsById.get(hostId);
    if (!host || host.revokedAt) {
      throw new Error("host not found or revoked");
    }
    const verifiedToken = this.verifyHostRegistrationToken(hostId, registrationToken);
    if (!verifiedToken) {
      throw new Error("invalid host registration token");
    }
    const next: RelayHost = {
      ...host,
      hostKeyId: input.hostKeyId,
      hostPublicKeyPem: input.publicKeyPem,
      hostKeyAlgorithm: input.algorithm,
      hostKeyUpdatedAt: this.#now(),
    };
    this.#hostsById.set(hostId, next);
    return next;
  }

  createHostGrant(hostId: string, deviceId: string): RelayHostGrant {
    const host = this.#hostsById.get(hostId);
    if (!host) {
      throw new Error("host not found");
    }
    const grant: RelayHostGrant = {
      id: randomUUID(),
      hostId,
      deviceId,
      scope: "agent-control",
      createdAt: this.#now(),
    };
    this.#hostGrantsById.set(grant.id, grant);
    return grant;
  }

  revokeHostGrant(grantId: string): RelayHostGrant | undefined {
    const current = this.#hostGrantsById.get(grantId);
    if (!current || current.revokedAt) {
      return current;
    }
    const next: RelayHostGrant = {
      ...current,
      revokedAt: this.#now(),
    };
    this.#hostGrantsById.set(grantId, next);
    return next;
  }

  createHostPairingIntent(userId: string | null, hostLabel: string): HostPairingIntentResult {
    const deviceCode = createDeviceCode();
    const hashed = newHashedTokenFromValue(deviceCode);
    const intent: RelayHostPairingIntent = {
      id: randomUUID(),
      userId: userId ?? "pending",
      hostLabel,
      deviceCodeSalt: hashed.salt,
      deviceCodeHash: hashed.tokenHash,
      status: "pending",
      createdAt: this.#now(),
      expiresAt: this.#isoAfter(DEFAULT_HOST_PAIRING_TTL_MS),
    };
    this.#hostPairingIntentsById.set(intent.id, intent);
    this.recordAudit({
      action: "host.pairing.created",
      ...(userId ? { actorUserId: userId } : {}),
      metadata: { intentId: intent.id },
    });
    return { intent, deviceCode };
  }

  approveHostPairingIntent(
    intentId: string,
    deviceCode: string,
    approvedByUserId: string,
  ): HostRegistrationResult {
    const intent = this.#hostPairingIntentsById.get(intentId);
    if (!intent) {
      throw new Error("host pairing intent not found");
    }
    if (intent.status !== "pending") {
      throw new Error(`host pairing intent is ${intent.status}`);
    }
    if (intent.userId !== "pending" && intent.userId !== approvedByUserId) {
      throw new Error("host pairing intent belongs to a different user");
    }
    if (isExpired(this.#clock, intent.expiresAt)) {
      this.#hostPairingIntentsById.set(intentId, { ...intent, status: "expired" });
      throw new Error("host pairing intent expired");
    }
    if (!tokenMatchesHash(deviceCode, intent.deviceCodeSalt, intent.deviceCodeHash)) {
      throw new Error("invalid host pairing device code");
    }

    const host = this.createHost(approvedByUserId, intent.hostLabel);
    const token = this.rotateHostRegistrationToken(host.id);
    const approved: RelayHostPairingIntent = {
      ...intent,
      status: "approved",
      approvedAt: this.#now(),
      hostId: host.id,
      registrationTokenId: token.registrationToken.id,
      registrationToken: token.token,
      ...(token.registrationToken.expiresAt
        ? { registrationTokenExpiresAt: token.registrationToken.expiresAt }
        : {}),
    };
    this.#hostPairingIntentsById.set(intent.id, approved);
    this.recordAudit({
      action: "host.pairing.approved",
      actorUserId: approvedByUserId,
      hostId: host.id,
      metadata: { intentId },
    });
    return { host, registrationToken: token.registrationToken, token: token.token };
  }

  rotateHostRegistrationToken(hostId: string): {
    registrationToken: RelayHostRegistrationToken;
    token: string;
  } {
    const host = this.#hostsById.get(hostId);
    if (!host || host.revokedAt) {
      throw new Error("host not found or revoked");
    }
    this.revokeHostTokens(hostId);
    const token = newHashedToken();
    const registrationToken: RelayHostRegistrationToken = {
      id: randomUUID(),
      hostId,
      tokenSalt: token.salt,
      tokenHash: token.tokenHash,
      createdAt: this.#now(),
    };
    this.#hostTokensById.set(registrationToken.id, registrationToken);
    this.recordAudit({
      action: "host.token.rotated",
      actorUserId: host.userId,
      hostId,
      metadata: { tokenId: registrationToken.id },
    });
    return { registrationToken, token: token.token };
  }

  verifyHostRegistrationToken(
    hostId: string,
    token: string,
  ): RelayHostRegistrationToken | undefined {
    for (const registrationToken of this.#hostTokensById.values()) {
      if (
        registrationToken.hostId === hostId &&
        !registrationToken.revokedAt &&
        !isExpired(this.#clock, registrationToken.expiresAt) &&
        tokenMatchesHash(token, registrationToken.tokenSalt, registrationToken.tokenHash)
      ) {
        return registrationToken;
      }
    }
    return undefined;
  }

  revokeHostTokens(hostId: string): void {
    const revokedAt = this.#now();
    for (const token of this.#hostTokensById.values()) {
      if (token.hostId === hostId && !token.revokedAt) {
        this.#hostTokensById.set(token.id, { ...token, revokedAt });
      }
    }
  }

  setHostStatus(
    hostId: string,
    state: RelayHostStatus["state"],
    connectionId?: string,
  ): RelayHostStatus {
    const current = this.#hostStatusesById.get(hostId);
    const now = this.#now();
    const status: RelayHostStatus = {
      hostId,
      state,
    };
    const connectedAt = state === "online" ? (current?.connectedAt ?? now) : current?.connectedAt;
    if (connectedAt) {
      status.connectedAt = connectedAt;
    }
    const disconnectedAt = state === "offline" ? now : current?.disconnectedAt;
    if (disconnectedAt) {
      status.disconnectedAt = disconnectedAt;
    }
    if (connectionId) {
      status.connectionId = connectionId;
    }
    this.#hostStatusesById.set(hostId, status);
    return status;
  }

  getUserById(userId: string): RelayUser | undefined {
    return this.#usersById.get(userId);
  }

  getDeviceById(deviceId: string): RelayDevice | undefined {
    return this.#devicesById.get(deviceId);
  }

  getSessionById(sessionId: string): RelayUserSession | undefined {
    return this.#sessionsById.get(sessionId);
  }

  getPasskeyChallengeById(challengeId: string): RelayPasskeyChallenge | undefined {
    return this.#passkeyChallengesById.get(challengeId);
  }

  getHostById(hostId: string): RelayHost | undefined {
    return this.#hostsById.get(hostId);
  }

  getHostStatus(hostId: string): RelayHostStatus | undefined {
    return this.#hostStatusesById.get(hostId);
  }

  listHostsForUser(userId: string): readonly RelayHost[] {
    return [...this.#hostsById.values()].filter(
      (host) => host.userId === userId && !host.revokedAt,
    );
  }

  listDevicesForUser(userId: string): readonly RelayDevice[] {
    return [...this.#devicesById.values()].filter((device) => device.userId === userId);
  }

  listHostGrantsForDevice(deviceId: string): readonly RelayHostGrant[] {
    return [...this.#hostGrantsById.values()].filter(
      (grant) => grant.deviceId === deviceId && !grant.revokedAt,
    );
  }

  listHostGrantsForHost(hostId: string): readonly RelayHostGrant[] {
    return [...this.#hostGrantsById.values()].filter(
      (grant) => grant.hostId === hostId && !grant.revokedAt,
    );
  }

  getHostPairingIntent(intentId: string): RelayHostPairingIntent | undefined {
    return this.#hostPairingIntentsById.get(intentId);
  }

  listAuditEvents(): readonly RelayAuditEvent[] {
    return [...this.#auditEvents];
  }

  snapshot(): RelayMetadataSnapshot {
    return {
      users: [...this.#usersById.values()],
      devices: [...this.#devicesById.values()],
      sessions: [...this.#sessionsById.values()],
      passkeyCredentials: [...this.#passkeyCredentialsById.values()],
      passkeyChallenges: [...this.#passkeyChallengesById.values()],
      hosts: [...this.#hostsById.values()],
      hostGrants: [...this.#hostGrantsById.values()],
      loginChallenges: [...this.#loginChallengesById.values()],
      hostPairingIntents: [...this.#hostPairingIntentsById.values()],
      hostRegistrationTokens: [...this.#hostTokensById.values()],
      hostStatuses: [...this.#hostStatusesById.values()],
      auditEvents: [...this.#auditEvents],
    };
  }

  hydrate(snapshot: RelayMetadataSnapshot): void {
    this.#usersById = new Map(snapshot.users.map((user) => [user.id, user]));
    this.#usersByEmail = new Map(snapshot.users.map((user) => [user.email, user]));
    this.#devicesById = new Map(snapshot.devices.map((device) => [device.id, device]));
    this.#sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]));
    this.#passkeyCredentialsById = new Map(
      snapshot.passkeyCredentials.map((credential) => [credential.id, credential]),
    );
    this.#passkeyCredentialIds = new Map(
      snapshot.passkeyCredentials.map((credential) => [credential.credentialId, credential.id]),
    );
    this.#passkeyChallengesById = new Map(
      snapshot.passkeyChallenges.map((challenge) => [challenge.id, challenge]),
    );
    this.#hostsById = new Map(snapshot.hosts.map((host) => [host.id, host]));
    this.#hostGrantsById = new Map(snapshot.hostGrants.map((grant) => [grant.id, grant]));
    this.#loginChallengesById = new Map(
      snapshot.loginChallenges.map((challenge) => [challenge.id, challenge]),
    );
    this.#hostPairingIntentsById = new Map(
      snapshot.hostPairingIntents.map((intent) => [intent.id, intent]),
    );
    this.#hostTokensById = new Map(
      snapshot.hostRegistrationTokens.map((token) => [token.id, token]),
    );
    this.#hostStatusesById = new Map(
      snapshot.hostStatuses.map((status) => [status.hostId, status]),
    );
    this.#auditEvents = snapshot.auditEvents.toSorted(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
  }

  recordAudit(input: Omit<RelayAuditEvent, "id" | "createdAt">): RelayAuditEvent {
    assertMetadataOnly(input.metadata);
    const event: RelayAuditEvent = {
      id: randomUUID(),
      createdAt: this.#now(),
      ...input,
    };
    this.#auditEvents.push(event);
    return event;
  }

  #now(): string {
    return isoNow(this.#clock);
  }

  #isoAfter(ms: number): string {
    return new Date(this.#clock.now().getTime() + ms).toISOString();
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) {
    throw new Error("invalid email address");
  }
  return normalized;
}

function createNumericCode(): string {
  return `${randomInt(100000, 1000000)}`;
}

function createDeviceCode(): string {
  const left = randomInt(1000, 10000);
  const right = randomInt(1000, 10000);
  return `${left}-${right}`;
}

function newHashedTokenFromValue(token: string): { salt: string; tokenHash: string } {
  const hashed = newHashedToken();
  return {
    salt: hashed.salt,
    tokenHash: hashToken(token, hashed.salt),
  };
}

function isExpired(clock: Clock, expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() <= clock.now().getTime();
}

export function assertMetadataOnly(metadata: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (CONTENT_METADATA_KEY_PATTERN.test(key)) {
      throw new Error(`audit metadata key "${key}" may contain content`);
    }
    if (typeof value === "object" && value !== null) {
      throw new Error(`audit metadata key "${key}" must be scalar metadata`);
    }
  }
}
