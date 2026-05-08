import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RelayHostConnectionConfig {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly registrationToken: string;
  readonly hostKeyId?: string;
  readonly hostPublicKeyPem?: string;
  readonly hostPrivateKeyPem?: string;
  readonly trustedRelaySigningKeyId?: string;
  readonly trustedRelaySigningKey?: string;
  readonly connectedAt: string;
  readonly updatedAt: string;
}

export interface SaveRelayHostConnectionInput {
  readonly secretsDir: string;
  readonly relayUrl: string;
  readonly hostId: string;
  readonly registrationToken: string;
  readonly hostKeyId?: string;
  readonly hostPublicKeyPem?: string;
  readonly hostPrivateKeyPem?: string;
  readonly trustedRelaySigningKeyId?: string;
  readonly trustedRelaySigningKey?: string;
  readonly now?: Date;
}

export function resolveRelayHostConnectionPath(secretsDir: string): string {
  return join(secretsDir, "relay-host.json");
}

export async function saveRelayHostConnection(
  input: SaveRelayHostConnectionInput,
): Promise<RelayHostConnectionConfig> {
  const path = resolveRelayHostConnectionPath(input.secretsDir);
  const existing = await readRelayHostConnection(input.secretsDir);
  const now = (input.now ?? new Date()).toISOString();
  const config = {
    relayUrl: normalizeRelayUrl(input.relayUrl),
    hostId: requireNonEmpty("hostId", input.hostId),
    registrationToken: requireNonEmpty("registrationToken", input.registrationToken),
    connectedAt: existing?.connectedAt ?? now,
    updatedAt: now,
  } as {
    relayUrl: string;
    hostId: string;
    registrationToken: string;
    hostKeyId?: string;
    hostPublicKeyPem?: string;
    hostPrivateKeyPem?: string;
    trustedRelaySigningKeyId?: string;
    trustedRelaySigningKey?: string;
    connectedAt: string;
    updatedAt: string;
  };
  const trustedRelaySigningKeyId = normalizeOptionalNonEmpty(
    "trustedRelaySigningKeyId",
    input.trustedRelaySigningKeyId ?? existing?.trustedRelaySigningKeyId,
  );
  if (trustedRelaySigningKeyId !== undefined) {
    config.trustedRelaySigningKeyId = trustedRelaySigningKeyId;
  }
  const trustedRelaySigningKey = normalizeOptionalNonEmpty(
    "trustedRelaySigningKey",
    input.trustedRelaySigningKey ?? existing?.trustedRelaySigningKey,
  );
  if (trustedRelaySigningKey !== undefined) {
    config.trustedRelaySigningKey = trustedRelaySigningKey;
  }
  const hostKeyId = normalizeOptionalNonEmpty("hostKeyId", input.hostKeyId ?? existing?.hostKeyId);
  if (hostKeyId !== undefined) {
    config.hostKeyId = hostKeyId;
  }
  const hostPublicKeyPem = normalizeOptionalNonEmpty(
    "hostPublicKeyPem",
    input.hostPublicKeyPem ?? existing?.hostPublicKeyPem,
  );
  if (hostPublicKeyPem !== undefined) {
    config.hostPublicKeyPem = hostPublicKeyPem;
  }
  const hostPrivateKeyPem = normalizeOptionalNonEmpty(
    "hostPrivateKeyPem",
    input.hostPrivateKeyPem ?? existing?.hostPrivateKeyPem,
  );
  if (hostPrivateKeyPem !== undefined) {
    config.hostPrivateKeyPem = hostPrivateKeyPem;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

export async function readRelayHostConnection(
  secretsDir: string,
): Promise<RelayHostConnectionConfig | null> {
  const path = resolveRelayHostConnectionPath(secretsDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<RelayHostConnectionConfig>;
  return {
    relayUrl: normalizeRelayUrl(String(parsed.relayUrl ?? "")),
    hostId: requireNonEmpty("hostId", String(parsed.hostId ?? "")),
    registrationToken: requireNonEmpty("registrationToken", String(parsed.registrationToken ?? "")),
    connectedAt: requireNonEmpty("connectedAt", String(parsed.connectedAt ?? "")),
    updatedAt: requireNonEmpty("updatedAt", String(parsed.updatedAt ?? "")),
    ...(typeof parsed.hostKeyId === "string" && parsed.hostKeyId.trim().length > 0
      ? {
          hostKeyId: parsed.hostKeyId.trim(),
        }
      : {}),
    ...(typeof parsed.hostPublicKeyPem === "string" && parsed.hostPublicKeyPem.trim().length > 0
      ? {
          hostPublicKeyPem: parsed.hostPublicKeyPem.trim(),
        }
      : {}),
    ...(typeof parsed.hostPrivateKeyPem === "string" && parsed.hostPrivateKeyPem.trim().length > 0
      ? {
          hostPrivateKeyPem: parsed.hostPrivateKeyPem.trim(),
        }
      : {}),
    ...(typeof parsed.trustedRelaySigningKeyId === "string" &&
    parsed.trustedRelaySigningKeyId.trim().length > 0
      ? {
          trustedRelaySigningKeyId: parsed.trustedRelaySigningKeyId.trim(),
        }
      : {}),
    ...(typeof parsed.trustedRelaySigningKey === "string" &&
    parsed.trustedRelaySigningKey.trim().length > 0
      ? {
          trustedRelaySigningKey: parsed.trustedRelaySigningKey.trim(),
        }
      : {}),
  } satisfies RelayHostConnectionConfig;
}

export async function clearRelayHostConnection(secretsDir: string): Promise<boolean> {
  const path = resolveRelayHostConnectionPath(secretsDir);
  try {
    await rm(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export function formatRelayHostConnectionStatus(config: RelayHostConnectionConfig | null): string {
  if (!config) {
    return "Relay cloud connection is not configured.";
  }
  return [
    "Relay cloud connection configured.",
    `Relay: ${config.relayUrl}`,
    `Host: ${config.hostId}`,
    `Connected: ${config.connectedAt}`,
    `Updated: ${config.updatedAt}`,
    "Registration token: stored locally and hidden",
    `Host key: ${config.hostKeyId ? "configured" : "not configured"}`,
  ].join("\n");
}

function normalizeRelayUrl(value: string): string {
  const trimmed = requireNonEmpty("relayUrl", value);
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("relayUrl must use https:// or http:// for local development");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function requireNonEmpty(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
  return trimmed;
}

function normalizeOptionalNonEmpty(name: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmpty(name, value);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
