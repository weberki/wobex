import { verify } from "node:crypto";

import { describe, expect, it } from "vitest";
import { buildRelayHostTunnelChallengeMessage } from "@wobex/shared/relayHostAuth";

import {
  generateRelayHostKeyMaterial,
  resolveRelayHostKeyMaterial,
  signRelayHostTunnelChallenge,
} from "./relayHostKeys";

describe("relayHostKeys", () => {
  it("generates host key material and resolves it from connection config", () => {
    const material = generateRelayHostKeyMaterial();

    expect(material.hostKeyId).toMatch(/^host-key-/);
    expect(material.hostPublicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(material.hostPrivateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(
      resolveRelayHostKeyMaterial({
        relayUrl: "https://relay.example.com",
        hostId: "host-1",
        registrationToken: "token-1",
        hostKeyId: material.hostKeyId,
        hostPublicKeyPem: material.hostPublicKeyPem,
        hostPrivateKeyPem: material.hostPrivateKeyPem,
        connectedAt: "2026-04-15T10:00:00.000Z",
        updatedAt: "2026-04-15T10:00:00.000Z",
      }),
    ).toEqual(material);
  });

  it("signs a relay tunnel challenge that verifies against the generated public key", () => {
    const material = generateRelayHostKeyMaterial();

    const signature = signRelayHostTunnelChallenge({
      relayUrl: "https://relay.example.com",
      hostId: "host-1",
      hostKeyId: material.hostKeyId,
      challengeId: "challenge-1",
      nonce: "nonce-1",
      hostPrivateKeyPem: material.hostPrivateKeyPem,
    });

    expect(
      verify(
        null,
        Buffer.from(
          buildRelayHostTunnelChallengeMessage({
            relayUrl: "https://relay.example.com",
            hostId: "host-1",
            hostKeyId: material.hostKeyId,
            challengeId: "challenge-1",
            nonce: "nonce-1",
          }),
          "utf8",
        ),
        material.hostPublicKeyPem,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});
