import { saveRelayHostConnection, type RelayHostConnectionConfig } from "./relayHostConfig";
import { registerRelayHostPublicKey } from "./relayHostRegistration";
import { generateRelayHostKeyMaterial, resolveRelayHostKeyMaterial } from "./relayHostKeys";

export async function ensureRelayHostConnectionEnrollment(input: {
  readonly secretsDir: string;
  readonly connection: RelayHostConnectionConfig;
  readonly fetchImpl?: typeof fetch;
}): Promise<RelayHostConnectionConfig> {
  const existingKeys = resolveRelayHostKeyMaterial(input.connection);
  if (
    existingKeys &&
    input.connection.trustedRelaySigningKeyId &&
    input.connection.trustedRelaySigningKey
  ) {
    return input.connection;
  }

  const keyMaterial = existingKeys ?? generateRelayHostKeyMaterial();
  const registered = await registerRelayHostPublicKey({
    relayUrl: input.connection.relayUrl,
    hostId: input.connection.hostId,
    registrationToken: input.connection.registrationToken,
    keyMaterial,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });

  return saveRelayHostConnection({
    secretsDir: input.secretsDir,
    relayUrl: input.connection.relayUrl,
    hostId: input.connection.hostId,
    registrationToken: input.connection.registrationToken,
    hostKeyId: keyMaterial.hostKeyId,
    hostPublicKeyPem: keyMaterial.hostPublicKeyPem,
    hostPrivateKeyPem: keyMaterial.hostPrivateKeyPem,
    trustedRelaySigningKeyId: registered.trustedRelaySigningKeyId,
    trustedRelaySigningKey: registered.trustedRelaySigningKey,
  });
}
