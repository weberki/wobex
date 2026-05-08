import { createHmac } from "node:crypto";

import type { AuthSessionCapabilities, RelayRemoteSessionClaim } from "@wobex/contracts";

function signPayload(payload: string, secret: Uint8Array): string {
  return createHmac("sha256", Buffer.from(secret)).update(payload).digest("base64url");
}

export const RELAY_READ_CAPABILITIES: AuthSessionCapabilities = [
  "chat:read",
  "chat:write",
  "files:read",
  "terminal:read",
  "git:read",
];

export const RELAY_WRITE_CAPABILITIES: AuthSessionCapabilities = [
  ...RELAY_READ_CAPABILITIES,
  "approvals:respond",
  "files:write",
  "terminal:write",
  "git:write",
];

export function serializeRelayRemoteSessionClaim(claim: RelayRemoteSessionClaim): string {
  return JSON.stringify({
    version: claim.version,
    hostId: claim.hostId,
    userId: claim.userId,
    deviceId: claim.deviceId,
    grantId: claim.grantId,
    subject: claim.subject,
    role: claim.role,
    capabilities: [...claim.capabilities],
    issuedAt: claim.issuedAt,
    expiresAt: claim.expiresAt,
  });
}

export function signRelayRemoteSessionClaim(input: {
  readonly claim: RelayRemoteSessionClaim;
  readonly keyId: string;
  readonly secret: string;
}) {
  return {
    keyId: input.keyId,
    signature: signPayload(
      serializeRelayRemoteSessionClaim(input.claim),
      Buffer.from(input.secret, "utf8"),
    ),
    claim: input.claim,
  };
}
