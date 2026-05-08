export interface RelayHostTunnelChallengeMessageInput {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly hostKeyId: string;
  readonly challengeId: string;
  readonly nonce: string;
}

export function buildRelayHostTunnelChallengeMessage(
  input: RelayHostTunnelChallengeMessageInput,
): string {
  return JSON.stringify({
    relayUrl: input.relayUrl,
    hostId: input.hostId,
    hostKeyId: input.hostKeyId,
    challengeId: input.challengeId,
    nonce: input.nonce,
  });
}
