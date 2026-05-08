import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { buildRelayHostTunnelChallengeMessage } from "@wobex/shared/relayHostAuth";

import type { RelayHostConnectionConfig } from "./relayHostConfig";

export interface RelayHostKeyMaterial {
  readonly hostKeyId: string;
  readonly hostPublicKeyPem: string;
  readonly hostPrivateKeyPem: string;
}

export function resolveRelayHostKeyMaterial(
  connection: RelayHostConnectionConfig,
): RelayHostKeyMaterial | null {
  if (!connection.hostKeyId || !connection.hostPublicKeyPem || !connection.hostPrivateKeyPem) {
    return null;
  }
  return {
    hostKeyId: connection.hostKeyId,
    hostPublicKeyPem: connection.hostPublicKeyPem,
    hostPrivateKeyPem: connection.hostPrivateKeyPem,
  };
}

export function generateRelayHostKeyMaterial(): RelayHostKeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    hostKeyId: `host-key-${randomUUID()}`,
    hostPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    hostPrivateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signRelayHostTunnelChallenge(input: {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly hostKeyId: string;
  readonly challengeId: string;
  readonly nonce: string;
  readonly hostPrivateKeyPem: string;
}): string {
  return sign(
    null,
    Buffer.from(
      buildRelayHostTunnelChallengeMessage({
        relayUrl: input.relayUrl,
        hostId: input.hostId,
        hostKeyId: input.hostKeyId,
        challengeId: input.challengeId,
        nonce: input.nonce,
      }),
      "utf8",
    ),
    input.hostPrivateKeyPem,
  ).toString("base64url");
}
