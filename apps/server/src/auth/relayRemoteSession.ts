import type {
  AuthSessionCapability,
  RelayRemoteSessionClaim,
  RelaySignedRemoteSessionClaim,
} from "@wobex/contracts";

import { signPayload, timingSafeEqualBase64Url } from "./utils.ts";

const DISALLOWED_RELAY_CAPABILITIES = new Set<AuthSessionCapability>([
  "auth:admin",
  "settings:admin",
]);

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
}): RelaySignedRemoteSessionClaim {
  return {
    keyId: input.keyId,
    signature: signPayload(
      serializeRelayRemoteSessionClaim(input.claim),
      Buffer.from(input.secret, "utf8"),
    ),
    claim: input.claim,
  };
}

export function verifyRelayRemoteSessionSignature(input: {
  readonly signedClaim: RelaySignedRemoteSessionClaim;
  readonly expectedKeyId: string;
  readonly secret: string;
}): boolean {
  if (input.signedClaim.keyId !== input.expectedKeyId) {
    return false;
  }
  const expectedSignature = signPayload(
    serializeRelayRemoteSessionClaim(input.signedClaim.claim),
    Buffer.from(input.secret, "utf8"),
  );
  return timingSafeEqualBase64Url(input.signedClaim.signature, expectedSignature);
}

export function hasDisallowedRelayCapabilities(
  capabilities: ReadonlyArray<AuthSessionCapability>,
): boolean {
  return capabilities.some((capability) => DISALLOWED_RELAY_CAPABILITIES.has(capability));
}
