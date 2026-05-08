import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  clearRelayHostConnection,
  formatRelayHostConnectionStatus,
  readRelayHostConnection,
  resolveRelayHostConnectionPath,
  saveRelayHostConnection,
} from "./relayHostConfig";

describe("relayHostConfig", () => {
  it("stores relay host registration tokens in a local secrets file", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wobex-relay-host-"));
    const secretsDir = join(baseDir, "secrets");

    const saved = await saveRelayHostConnection({
      secretsDir,
      relayUrl: "https://code.example.com/",
      hostId: "host-1",
      registrationToken: "relay-token",
      hostKeyId: "host-key-1",
      hostPublicKeyPem: "public-key-pem",
      hostPrivateKeyPem: "private-key-pem",
      trustedRelaySigningKeyId: "relay-key-1",
      trustedRelaySigningKey: "relay-signing-key",
      now: new Date("2026-04-15T10:00:00.000Z"),
    });

    expect(saved.relayUrl).toBe("https://code.example.com");
    expect(saved.hostKeyId).toBe("host-key-1");
    expect(saved.trustedRelaySigningKeyId).toBe("relay-key-1");
    expect(saved.trustedRelaySigningKey).toBe("relay-signing-key");
    const path = resolveRelayHostConnectionPath(secretsDir);
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readRelayHostConnection(secretsDir)).toEqual(saved);
    expect(await readFile(path, "utf8")).toContain("relay-token");
  });

  it("formats status without revealing the registration token", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wobex-relay-host-"));
    const saved = await saveRelayHostConnection({
      secretsDir: join(baseDir, "secrets"),
      relayUrl: "https://code.example.com",
      hostId: "host-1",
      registrationToken: "secret-token",
      trustedRelaySigningKeyId: "relay-key-1",
      now: new Date("2026-04-15T10:00:00.000Z"),
    });

    const status = formatRelayHostConnectionStatus(saved);

    expect(status).toContain("Relay: https://code.example.com");
    expect(status).toContain("Host: host-1");
    expect(status).toContain("Host key: not configured");
    expect(status).not.toContain("secret-token");
    expect(status).not.toContain("relay-key-1");
  });

  it("clears the local relay host connection", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wobex-relay-host-"));
    const secretsDir = join(baseDir, "secrets");
    await saveRelayHostConnection({
      secretsDir,
      relayUrl: "https://code.example.com",
      hostId: "host-1",
      registrationToken: "relay-token",
    });

    expect(await clearRelayHostConnection(secretsDir)).toBe(true);
    expect(await clearRelayHostConnection(secretsDir)).toBe(false);
    expect(await readRelayHostConnection(secretsDir)).toBeNull();
  });
});
