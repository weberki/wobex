import { Schema } from "effect";

import { AuthSessionCapabilities, AuthSessionRole } from "./auth";
import {
  AuthSessionId,
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const makeRelayId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const RelayUserId = makeRelayId("RelayUserId");
export type RelayUserId = typeof RelayUserId.Type;

export const RelaySessionId = makeRelayId("RelaySessionId");
export type RelaySessionId = typeof RelaySessionId.Type;

export const RelayDeviceId = makeRelayId("RelayDeviceId");
export type RelayDeviceId = typeof RelayDeviceId.Type;

export const RelayHostId = makeRelayId("RelayHostId");
export type RelayHostId = typeof RelayHostId.Type;

export const RelayGrantId = makeRelayId("RelayGrantId");
export type RelayGrantId = typeof RelayGrantId.Type;

export const RelayHostPairingIntentId = makeRelayId("RelayHostPairingIntentId");
export type RelayHostPairingIntentId = typeof RelayHostPairingIntentId.Type;

export const RelayAuditEventId = makeRelayId("RelayAuditEventId");
export type RelayAuditEventId = typeof RelayAuditEventId.Type;

export const RelayTunnelRequestId = makeRelayId("RelayTunnelRequestId");
export type RelayTunnelRequestId = typeof RelayTunnelRequestId.Type;

export const RelayTunnelStreamId = makeRelayId("RelayTunnelStreamId");
export type RelayTunnelStreamId = typeof RelayTunnelStreamId.Type;

export const RelayChallengeId = makeRelayId("RelayChallengeId");
export type RelayChallengeId = typeof RelayChallengeId.Type;

export const RelayHostStatus = Schema.Literals([
  "online",
  "reconnecting",
  "replaying",
  "recovered",
  "offline",
]);
export type RelayHostStatus = typeof RelayHostStatus.Type;

export const RelayAuthMethod = Schema.Literals(["email-recovery", "passkey"]);
export type RelayAuthMethod = typeof RelayAuthMethod.Type;

export const RelayDeviceTrustState = Schema.Literals(["trusted", "recovery", "revoked"]);
export type RelayDeviceTrustState = typeof RelayDeviceTrustState.Type;

export const RelayBootstrapScope = Schema.Literals(["read", "write"]);
export type RelayBootstrapScope = typeof RelayBootstrapScope.Type;

export const RelayPasskeyPurpose = Schema.Literals(["login", "step-up"]);
export type RelayPasskeyPurpose = typeof RelayPasskeyPurpose.Type;

export const RelayUserStatus = Schema.Literals(["active", "disabled"]);
export type RelayUserStatus = typeof RelayUserStatus.Type;

export const RelayDeviceStatus = Schema.Literals(["active", "revoked"]);
export type RelayDeviceStatus = typeof RelayDeviceStatus.Type;

export const RelayGrantStatus = Schema.Literals(["active", "revoked"]);
export type RelayGrantStatus = typeof RelayGrantStatus.Type;

export const RelayHostPairingIntentStatus = Schema.Literals([
  "pending",
  "approved",
  "expired",
  "revoked",
  "consumed",
]);
export type RelayHostPairingIntentStatus = typeof RelayHostPairingIntentStatus.Type;

export const RelayAuditAction = Schema.Literals([
  "login.start",
  "login.verified",
  "logout",
  "device.added",
  "device.revoked",
  "host.added",
  "host.revoked",
  "host.pairing.approved",
  "host.tunnel.connected",
  "host.tunnel.disconnected",
  "remote.session.opened",
  "remote.session.denied",
  "capability.denied",
]);
export type RelayAuditAction = typeof RelayAuditAction.Type;

export const RelayUser = Schema.Struct({
  id: RelayUserId,
  email: TrimmedNonEmptyString,
  status: RelayUserStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RelayUser = typeof RelayUser.Type;

export const RelaySession = Schema.Struct({
  id: RelaySessionId,
  userId: RelayUserId,
  deviceId: RelayDeviceId,
  authMethod: RelayAuthMethod,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  stepUpExpiresAt: Schema.NullOr(IsoDateTime),
});
export type RelaySession = typeof RelaySession.Type;

export const RelayDevice = Schema.Struct({
  id: RelayDeviceId,
  userId: RelayUserId,
  label: Schema.optionalKey(TrimmedNonEmptyString),
  userAgent: Schema.optionalKey(TrimmedNonEmptyString),
  status: RelayDeviceStatus,
  trustState: RelayDeviceTrustState,
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  trustedAt: Schema.NullOr(IsoDateTime),
});
export type RelayDevice = typeof RelayDevice.Type;

export const RelayPasskeyCredentialId = makeRelayId("RelayPasskeyCredentialId");
export type RelayPasskeyCredentialId = typeof RelayPasskeyCredentialId.Type;

export const RelayPasskeyCredential = Schema.Struct({
  id: RelayPasskeyCredentialId,
  userId: RelayUserId,
  deviceId: RelayDeviceId,
  webauthnUserId: TrimmedNonEmptyString,
  credentialId: TrimmedNonEmptyString,
  publicKey: TrimmedNonEmptyString,
  counter: NonNegativeInt,
  transports: Schema.Array(TrimmedNonEmptyString),
  backedUp: Schema.Boolean,
  createdAt: IsoDateTime,
  lastUsedAt: Schema.NullOr(IsoDateTime),
});
export type RelayPasskeyCredential = typeof RelayPasskeyCredential.Type;

export const RelayHost = Schema.Struct({
  id: RelayHostId,
  ownerUserId: RelayUserId,
  label: TrimmedNonEmptyString,
  environmentId: Schema.optionalKey(EnvironmentId),
  status: RelayHostStatus,
  lastSeenAt: Schema.NullOr(IsoDateTime),
  hostKeyId: Schema.optionalKey(TrimmedNonEmptyString),
  hostPublicKey: Schema.optionalKey(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RelayHost = typeof RelayHost.Type;

export const RelayHostListItem = Schema.Struct({
  ...RelayHost.fields,
  activeGrantCount: NonNegativeInt,
});
export type RelayHostListItem = typeof RelayHostListItem.Type;

export const RelayHostGrant = Schema.Struct({
  id: RelayGrantId,
  hostId: RelayHostId,
  userId: RelayUserId,
  deviceId: RelayDeviceId,
  role: AuthSessionRole,
  capabilities: AuthSessionCapabilities,
  status: RelayGrantStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type RelayHostGrant = typeof RelayHostGrant.Type;

export const RelayHostPairingIntent = Schema.Struct({
  id: RelayHostPairingIntentId,
  requestedByUserId: RelayUserId,
  hostId: Schema.optionalKey(RelayHostId),
  deviceCode: TrimmedNonEmptyString,
  qrCodeUrl: Schema.optionalKey(TrimmedNonEmptyString),
  status: RelayHostPairingIntentStatus,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  approvedAt: Schema.NullOr(IsoDateTime),
  approvedByUserId: Schema.optionalKey(RelayUserId),
});
export type RelayHostPairingIntent = typeof RelayHostPairingIntent.Type;

export const RelayHostTunnelAuthInput = Schema.Struct({
  hostId: RelayHostId,
  hostKeyId: TrimmedNonEmptyString,
  challengeId: RelayChallengeId,
  challengeSignature: TrimmedNonEmptyString,
  relayUrl: Schema.optionalKey(TrimmedNonEmptyString),
  reconnectAttempt: Schema.optionalKey(NonNegativeInt),
});
export type RelayHostTunnelAuthInput = typeof RelayHostTunnelAuthInput.Type;

export const RelayRemoteSessionClaim = Schema.Struct({
  version: Schema.Literal(1),
  hostId: RelayHostId,
  userId: RelayUserId,
  deviceId: RelayDeviceId,
  grantId: RelayGrantId,
  subject: TrimmedNonEmptyString,
  role: AuthSessionRole,
  capabilities: AuthSessionCapabilities,
  issuedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type RelayRemoteSessionClaim = typeof RelayRemoteSessionClaim.Type;

export const RelayRemoteSession = Schema.Struct({
  sessionId: AuthSessionId,
  subject: TrimmedNonEmptyString,
  hostId: RelayHostId,
  userId: RelayUserId,
  deviceId: RelayDeviceId,
  grantId: RelayGrantId,
  role: AuthSessionRole,
  capabilities: AuthSessionCapabilities,
  issuedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type RelayRemoteSession = typeof RelayRemoteSession.Type;

export const RelaySignedRemoteSessionClaim = Schema.Struct({
  keyId: TrimmedNonEmptyString,
  signature: TrimmedNonEmptyString,
  claim: RelayRemoteSessionClaim,
});
export type RelaySignedRemoteSessionClaim = typeof RelaySignedRemoteSessionClaim.Type;

export const RelayHostTunnelAuthResult = Schema.Struct({
  authenticated: Schema.Literal(true),
  host: RelayHostListItem,
  connectedAt: IsoDateTime,
});
export type RelayHostTunnelAuthResult = typeof RelayHostTunnelAuthResult.Type;

export const RelayRemoteSessionBootstrapResult = Schema.Struct({
  authenticated: Schema.Literal(true),
  sessionToken: TrimmedNonEmptyString,
  session: RelayRemoteSession,
});
export type RelayRemoteSessionBootstrapResult = typeof RelayRemoteSessionBootstrapResult.Type;

export const RelayRemoteSessionBootstrapInput = Schema.Struct({
  signedClaim: RelaySignedRemoteSessionClaim,
});
export type RelayRemoteSessionBootstrapInput = typeof RelayRemoteSessionBootstrapInput.Type;

export const RelayBootstrapHostSessionInput = Schema.Struct({
  scope: RelayBootstrapScope,
});
export type RelayBootstrapHostSessionInput = typeof RelayBootstrapHostSessionInput.Type;

export const RelayBootstrapHostSessionResult = RelayRemoteSessionBootstrapResult;
export type RelayBootstrapHostSessionResult = typeof RelayBootstrapHostSessionResult.Type;

export const RelayHostRegistrationToken = Schema.Struct({
  tokenId: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
});
export type RelayHostRegistrationToken = typeof RelayHostRegistrationToken.Type;

export const RelayHostPublicKeyRegistrationInput = Schema.Struct({
  hostId: RelayHostId,
  registrationToken: TrimmedNonEmptyString,
  hostKeyId: TrimmedNonEmptyString,
  publicKeyPem: TrimmedNonEmptyString,
  algorithm: Schema.Literal("ed25519"),
});
export type RelayHostPublicKeyRegistrationInput = typeof RelayHostPublicKeyRegistrationInput.Type;

export const RelayHostPublicKeyRegistrationResult = Schema.Struct({
  hostId: RelayHostId,
  hostKeyId: TrimmedNonEmptyString,
  trustedRelaySigningKeyId: TrimmedNonEmptyString,
  trustedRelaySigningKey: TrimmedNonEmptyString,
});
export type RelayHostPublicKeyRegistrationResult = typeof RelayHostPublicKeyRegistrationResult.Type;

export const RelayHostTunnelChallengeInput = Schema.Struct({
  hostId: RelayHostId,
  hostKeyId: TrimmedNonEmptyString,
});
export type RelayHostTunnelChallengeInput = typeof RelayHostTunnelChallengeInput.Type;

export const RelayHostTunnelChallengeResult = Schema.Struct({
  challengeId: RelayChallengeId,
  nonce: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
});
export type RelayHostTunnelChallengeResult = typeof RelayHostTunnelChallengeResult.Type;

export const RelayHostPairingPollResult = Schema.Struct({
  intent: RelayHostPairingIntent,
  host: Schema.optionalKey(RelayHostListItem),
  registrationToken: Schema.optionalKey(RelayHostRegistrationToken),
  trustedRelaySigningKeyId: Schema.optionalKey(TrimmedNonEmptyString),
  trustedRelaySigningKey: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayHostPairingPollResult = typeof RelayHostPairingPollResult.Type;

export const RelayAuditEvent = Schema.Struct({
  id: RelayAuditEventId,
  action: RelayAuditAction,
  userId: Schema.optionalKey(RelayUserId),
  deviceId: Schema.optionalKey(RelayDeviceId),
  hostId: Schema.optionalKey(RelayHostId),
  sessionId: Schema.optionalKey(RelaySessionId),
  createdAt: IsoDateTime,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});
export type RelayAuditEvent = typeof RelayAuditEvent.Type;

const RelayHttpHeaders = Schema.Record(Schema.String, Schema.String);
const RelayHttpQuery = Schema.Record(Schema.String, Schema.String);

export const RelayHttpMethod = Schema.Literals([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
export type RelayHttpMethod = typeof RelayHttpMethod.Type;

const RelayHostTunnelFrameBase = {
  version: Schema.Literal(1),
  hostId: RelayHostId,
  deviceId: Schema.optionalKey(RelayDeviceId),
  requestId: Schema.optionalKey(RelayTunnelRequestId),
  streamId: Schema.optionalKey(RelayTunnelStreamId),
  timestamp: IsoDateTime,
} as const;

export const RelayHostTunnelHttpRequestFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("http.request"),
  requestId: RelayTunnelRequestId,
  payload: Schema.Struct({
    method: RelayHttpMethod,
    path: TrimmedNonEmptyString,
    query: Schema.optionalKey(RelayHttpQuery),
    headers: Schema.optionalKey(RelayHttpHeaders),
    bodyBase64: Schema.optionalKey(Schema.String),
    timeoutMs: Schema.optionalKey(PositiveInt),
  }),
});
export type RelayHostTunnelHttpRequestFrame = typeof RelayHostTunnelHttpRequestFrame.Type;

export const RelayHostTunnelHttpResponseFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("http.response"),
  requestId: RelayTunnelRequestId,
  payload: Schema.Struct({
    statusCode: PositiveInt,
    headers: Schema.optionalKey(RelayHttpHeaders),
    bodyBase64: Schema.optionalKey(Schema.String),
    byteCount: Schema.optionalKey(NonNegativeInt),
  }),
});
export type RelayHostTunnelHttpResponseFrame = typeof RelayHostTunnelHttpResponseFrame.Type;

export const RelayHostTunnelWsOpenFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("ws.open"),
  streamId: RelayTunnelStreamId,
  payload: Schema.Struct({
    path: TrimmedNonEmptyString,
    query: Schema.optionalKey(RelayHttpQuery),
    headers: Schema.optionalKey(RelayHttpHeaders),
    subprotocol: Schema.optionalKey(TrimmedNonEmptyString),
  }),
});
export type RelayHostTunnelWsOpenFrame = typeof RelayHostTunnelWsOpenFrame.Type;

export const RelayHostTunnelWsMessageFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("ws.message"),
  streamId: RelayTunnelStreamId,
  payload: Schema.Struct({
    direction: Schema.Literals(["client-to-host", "host-to-client"]),
    isBinary: Schema.Boolean,
    data: Schema.String,
    byteCount: Schema.optionalKey(NonNegativeInt),
  }),
});
export type RelayHostTunnelWsMessageFrame = typeof RelayHostTunnelWsMessageFrame.Type;

export const RelayHostTunnelWsCloseFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("ws.close"),
  streamId: RelayTunnelStreamId,
  payload: Schema.Struct({
    code: PositiveInt,
    reason: Schema.optionalKey(TrimmedNonEmptyString),
    initiatedBy: Schema.Literals(["client", "relay", "host"]),
  }),
});
export type RelayHostTunnelWsCloseFrame = typeof RelayHostTunnelWsCloseFrame.Type;

export const RelayHostTunnelHostStatusFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("host.status"),
  payload: Schema.Struct({
    status: RelayHostStatus,
    detail: Schema.optionalKey(TrimmedNonEmptyString),
  }),
});
export type RelayHostTunnelHostStatusFrame = typeof RelayHostTunnelHostStatusFrame.Type;

export const RelayHostTunnelHostErrorFrame = Schema.Struct({
  ...RelayHostTunnelFrameBase,
  type: Schema.Literal("host.error"),
  payload: Schema.Struct({
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    retryable: Schema.Boolean,
  }),
});
export type RelayHostTunnelHostErrorFrame = typeof RelayHostTunnelHostErrorFrame.Type;

export const RelayHostTunnelFrame = Schema.Union([
  RelayHostTunnelHttpRequestFrame,
  RelayHostTunnelHttpResponseFrame,
  RelayHostTunnelWsOpenFrame,
  RelayHostTunnelWsMessageFrame,
  RelayHostTunnelWsCloseFrame,
  RelayHostTunnelHostStatusFrame,
  RelayHostTunnelHostErrorFrame,
]);
export type RelayHostTunnelFrame = typeof RelayHostTunnelFrame.Type;

export const RelayAuthLoginStartInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  deviceLabel: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayAuthLoginStartInput = typeof RelayAuthLoginStartInput.Type;

export const RelayAuthLoginStartResult = Schema.Struct({
  challengeId: RelayChallengeId,
  expiresAt: IsoDateTime,
  deliveryHint: Schema.NullOr(TrimmedNonEmptyString),
});
export type RelayAuthLoginStartResult = typeof RelayAuthLoginStartResult.Type;

export const RelayAuthLoginVerifyInput = Schema.Struct({
  challengeId: RelayChallengeId,
  code: TrimmedNonEmptyString,
  deviceLabel: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayAuthLoginVerifyInput = typeof RelayAuthLoginVerifyInput.Type;

export const RelayAuthLoginVerifyResult = Schema.Struct({
  user: RelayUser,
  session: RelaySession,
  device: RelayDevice,
  csrfToken: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayAuthLoginVerifyResult = typeof RelayAuthLoginVerifyResult.Type;

export const RelayPasskeyAuthenticationStartInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  purpose: RelayPasskeyPurpose,
});
export type RelayPasskeyAuthenticationStartInput = typeof RelayPasskeyAuthenticationStartInput.Type;

export const RelayPasskeyAuthenticationStartResult = Schema.Struct({
  challengeId: RelayChallengeId,
  purpose: RelayPasskeyPurpose,
  options: Schema.Unknown,
});
export type RelayPasskeyAuthenticationStartResult =
  typeof RelayPasskeyAuthenticationStartResult.Type;

export const RelayPasskeyAuthenticationFinishInput = Schema.Struct({
  challengeId: RelayChallengeId,
  purpose: RelayPasskeyPurpose,
  response: Schema.Unknown,
});
export type RelayPasskeyAuthenticationFinishInput =
  typeof RelayPasskeyAuthenticationFinishInput.Type;

export const RelayPasskeyAuthenticationFinishResult = Schema.Struct({
  user: RelayUser,
  session: RelaySession,
  device: RelayDevice,
  csrfToken: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayPasskeyAuthenticationFinishResult =
  typeof RelayPasskeyAuthenticationFinishResult.Type;

export const RelayPasskeyRegistrationStartResult = Schema.Struct({
  challengeId: RelayChallengeId,
  options: Schema.Unknown,
});
export type RelayPasskeyRegistrationStartResult = typeof RelayPasskeyRegistrationStartResult.Type;

export const RelayPasskeyRegistrationFinishInput = Schema.Struct({
  challengeId: RelayChallengeId,
  response: Schema.Unknown,
});
export type RelayPasskeyRegistrationFinishInput = typeof RelayPasskeyRegistrationFinishInput.Type;

export const RelayPasskeyRegistrationFinishResult = Schema.Struct({
  credential: RelayPasskeyCredential,
  device: RelayDevice,
});
export type RelayPasskeyRegistrationFinishResult = typeof RelayPasskeyRegistrationFinishResult.Type;

export const RelayAuthLogoutResult = Schema.Struct({
  success: Schema.Literal(true),
});
export type RelayAuthLogoutResult = typeof RelayAuthLogoutResult.Type;

export const RelayMeResult = Schema.Struct({
  user: RelayUser,
  session: RelaySession,
  device: RelayDevice,
  csrfToken: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayMeResult = typeof RelayMeResult.Type;

export const RelayListHostsResult = Schema.Struct({
  hosts: Schema.Array(RelayHostListItem),
});
export type RelayListHostsResult = typeof RelayListHostsResult.Type;

export const RelayGetHostStatusInput = Schema.Struct({
  hostId: RelayHostId,
});
export type RelayGetHostStatusInput = typeof RelayGetHostStatusInput.Type;

export const RelayGetHostStatusResult = Schema.Struct({
  hostId: RelayHostId,
  status: RelayHostStatus,
  updatedAt: IsoDateTime,
  detail: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayGetHostStatusResult = typeof RelayGetHostStatusResult.Type;

export const RelayListDevicesResult = Schema.Struct({
  currentDeviceId: RelayDeviceId,
  devices: Schema.Array(RelayDevice),
});
export type RelayListDevicesResult = typeof RelayListDevicesResult.Type;

export const RelayRevokeDeviceInput = Schema.Struct({
  deviceId: RelayDeviceId,
});
export type RelayRevokeDeviceInput = typeof RelayRevokeDeviceInput.Type;

export const RelayRevokeDeviceResult = Schema.Struct({
  device: RelayDevice,
  currentSessionRevoked: Schema.Boolean,
});
export type RelayRevokeDeviceResult = typeof RelayRevokeDeviceResult.Type;

export const RelayRevokeHostInput = Schema.Struct({
  hostId: RelayHostId,
});
export type RelayRevokeHostInput = typeof RelayRevokeHostInput.Type;

export const RelayRevokeHostResult = Schema.Struct({
  hostId: RelayHostId,
  revoked: Schema.Literal(true),
  revokedAt: IsoDateTime,
});
export type RelayRevokeHostResult = typeof RelayRevokeHostResult.Type;

export const RelayCreateHostPairingIntentInput = Schema.Struct({
  hostLabel: TrimmedNonEmptyString,
  environmentId: Schema.optionalKey(EnvironmentId),
});
export type RelayCreateHostPairingIntentInput = typeof RelayCreateHostPairingIntentInput.Type;

export const RelayCreateHostPairingIntentResult = Schema.Struct({
  intent: RelayHostPairingIntent,
});
export type RelayCreateHostPairingIntentResult = typeof RelayCreateHostPairingIntentResult.Type;

export const RelayApproveHostPairingIntentInput = Schema.Struct({
  intentId: RelayHostPairingIntentId,
  deviceCode: TrimmedNonEmptyString,
});
export type RelayApproveHostPairingIntentInput = typeof RelayApproveHostPairingIntentInput.Type;

export const RelayApproveHostPairingIntentResult = Schema.Struct({
  host: RelayHost,
  registrationToken: RelayHostRegistrationToken,
  trustedRelaySigningKeyId: Schema.optionalKey(TrimmedNonEmptyString),
  trustedRelaySigningKey: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RelayApproveHostPairingIntentResult = typeof RelayApproveHostPairingIntentResult.Type;
