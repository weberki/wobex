export type RelayId = string;
export type IsoDatetime = string;

export interface RelayUser {
  id: RelayId;
  email: string;
  createdAt: IsoDatetime;
  updatedAt: IsoDatetime;
}

export interface RelayDevice {
  id: RelayId;
  userId: RelayId;
  label: string;
  trustState: "trusted" | "recovery" | "revoked";
  createdAt: IsoDatetime;
  lastSeenAt: IsoDatetime;
  trustedAt?: IsoDatetime;
  revokedAt?: IsoDatetime;
}

export interface RelayHost {
  id: RelayId;
  userId: RelayId;
  label: string;
  createdAt: IsoDatetime;
  hostKeyId?: string;
  hostPublicKeyPem?: string;
  hostKeyAlgorithm?: "ed25519";
  hostKeyUpdatedAt?: IsoDatetime;
  revokedAt?: IsoDatetime;
}

export interface RelayHostGrant {
  id: RelayId;
  hostId: RelayId;
  deviceId: RelayId;
  scope: "agent-control";
  createdAt: IsoDatetime;
  revokedAt?: IsoDatetime;
}

export interface RelayAuditEvent {
  id: RelayId;
  action:
    | "login.start"
    | "login.verified"
    | "logout"
    | "device.added"
    | "device.revoked"
    | "host.added"
    | "host.revoked"
    | "host.pairing.created"
    | "host.pairing.approved"
    | "host.token.rotated"
    | "host.token.revoked"
    | "tunnel.connected"
    | "tunnel.disconnected"
    | "remote.session.opened"
    | "remote.session.denied"
    | "capability.denied";
  actorUserId?: RelayId;
  hostId?: RelayId;
  deviceId?: RelayId;
  requestId?: string;
  streamId?: string;
  statusCode?: number;
  byteCount?: number;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  createdAt: IsoDatetime;
}

export interface RelayUserSession {
  id: RelayId;
  userId: RelayId;
  deviceId: RelayId;
  authMethod: "email-recovery" | "passkey";
  tokenSalt: string;
  tokenHash: string;
  createdAt: IsoDatetime;
  expiresAt: IsoDatetime;
  lastSeenAt: IsoDatetime;
  stepUpExpiresAt?: IsoDatetime;
  revokedAt?: IsoDatetime;
}

export interface RelayPasskeyCredential {
  id: RelayId;
  userId: RelayId;
  deviceId: RelayId;
  webauthnUserId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  backedUp: boolean;
  createdAt: IsoDatetime;
  lastUsedAt?: IsoDatetime;
  revokedAt?: IsoDatetime;
}

export interface RelayPasskeyChallenge {
  id: RelayId;
  userId: RelayId;
  sessionId?: RelayId;
  deviceId?: RelayId;
  purpose: "register" | "login" | "step-up";
  challenge: string;
  createdAt: IsoDatetime;
  expiresAt: IsoDatetime;
  consumedAt?: IsoDatetime;
}

export interface RelayLoginChallenge {
  id: RelayId;
  email: string;
  deviceLabel: string;
  codeSalt: string;
  codeHash: string;
  attempts: number;
  createdAt: IsoDatetime;
  expiresAt: IsoDatetime;
  verifiedAt?: IsoDatetime;
}

export interface RelayHostPairingIntent {
  id: RelayId;
  userId: RelayId;
  hostLabel: string;
  deviceCodeSalt: string;
  deviceCodeHash: string;
  status: "pending" | "approved" | "expired" | "revoked" | "consumed";
  createdAt: IsoDatetime;
  expiresAt: IsoDatetime;
  approvedAt?: IsoDatetime;
  hostId?: RelayId;
  registrationTokenId?: RelayId;
  registrationToken?: string;
  registrationTokenExpiresAt?: IsoDatetime;
}

export interface RelayHostRegistrationToken {
  id: RelayId;
  hostId: RelayId;
  tokenSalt: string;
  tokenHash: string;
  createdAt: IsoDatetime;
  expiresAt?: IsoDatetime;
  revokedAt?: IsoDatetime;
}

export interface RelayHostStatus {
  hostId: RelayId;
  state: "online" | "reconnecting" | "replaying" | "recovered" | "offline";
  connectedAt?: IsoDatetime;
  disconnectedAt?: IsoDatetime;
  connectionId?: string;
}
