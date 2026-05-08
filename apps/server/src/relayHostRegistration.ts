import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import {
  RelayCreateHostPairingIntentInput,
  RelayCreateHostPairingIntentResult,
  RelayHostPublicKeyRegistrationResult,
  RelayHostTunnelChallengeInput,
  RelayHostTunnelChallengeResult,
  RelayHostPairingPollResult,
  type RelayHostPairingIntent,
  type RelayHostListItem,
  type RelayHostRegistrationToken,
} from "@wobex/contracts";
import { Schema } from "effect";

import { saveRelayHostConnection, type RelayHostConnectionConfig } from "./relayHostConfig";
import type { RelayHostKeyMaterial } from "./relayHostKeys";

const decodeCreateIntentResult = Schema.decodeUnknownSync(RelayCreateHostPairingIntentResult);
const decodePairingPollResult = Schema.decodeUnknownSync(RelayHostPairingPollResult);
const decodePublicKeyRegistrationResult = Schema.decodeUnknownSync(
  RelayHostPublicKeyRegistrationResult,
);
const decodeTunnelChallengeResult = Schema.decodeUnknownSync(RelayHostTunnelChallengeResult);

export const DEFAULT_RELAY_HOST_PAIRING_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_RELAY_HOST_PAIRING_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_RELAY_HOST_LABEL = "Wobex host";

export interface RelayHostPairingIntentStartResult {
  readonly intent: RelayHostPairingIntent;
  readonly deviceCode: string;
  readonly approvalUrl: string;
}

export interface StartRelayHostPairingIntentInput {
  readonly relayUrl: string;
  readonly hostLabel: string;
  readonly fetchImpl?: typeof fetch;
}

export interface PollRelayHostPairingIntentInput {
  readonly relayUrl: string;
  readonly intentId: string;
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
}

export interface RevokeRelayHostRegistrationInput {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly registrationToken: string;
  readonly fetchImpl?: typeof fetch;
}

export interface RegisterRelayHostPublicKeyInput {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly registrationToken: string;
  readonly keyMaterial: RelayHostKeyMaterial;
  readonly fetchImpl?: typeof fetch;
}

export interface RequestRelayHostTunnelChallengeInput {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly registrationToken: string;
  readonly hostKeyId: string;
  readonly fetchImpl?: typeof fetch;
}

export interface SaveApprovedRelayHostConnectionInput {
  readonly secretsDir: string;
  readonly relayUrl: string;
  readonly host: RelayHostListItem;
  readonly registrationToken: RelayHostRegistrationToken;
  readonly trustedRelaySigningKeyId?: string;
  readonly trustedRelaySigningKey?: string;
  readonly now?: Date;
}

export function resolveRelayHostLabel(input?: string): string {
  const fallback = input ?? hostname();
  const trimmed = fallback.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_RELAY_HOST_LABEL;
}

export function resolveRelayHostTunnelUrl(relayUrl: string): string {
  const url = new URL(resolveRelayHttpBaseUrl(relayUrl));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/host-tunnel`;
  return url.toString();
}

export function resolveRelayHostApprovalUrl(
  intent: RelayHostPairingIntent,
  relayUrl: string,
): string {
  if (intent.qrCodeUrl) {
    return intent.qrCodeUrl;
  }
  const url = new URL(normalizeRelayHttpOrigin(relayUrl));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/pair/${encodeURIComponent(intent.deviceCode)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveRelayHttpBaseUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("relayUrl must use http:// or https://");
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}

export async function startRelayHostPairingIntent(
  input: StartRelayHostPairingIntentInput,
): Promise<RelayHostPairingIntentStartResult> {
  const request = {
    hostLabel: input.hostLabel.trim(),
  } satisfies typeof RelayCreateHostPairingIntentInput.Type;
  const url = new URL("/api/hosts/pairing-intents", normalizeRelayHttpOrigin(input.relayUrl));
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(
      `Relay pairing intent creation failed with status ${response.status}: ${await readErrorText(response)}`,
    );
  }
  const decoded = decodeCreateIntentResult(await response.json());
  return {
    intent: decoded.intent,
    deviceCode: decoded.intent.deviceCode,
    approvalUrl: resolveRelayHostApprovalUrl(decoded.intent, input.relayUrl),
  };
}

export async function pollRelayHostPairingIntent(input: PollRelayHostPairingIntentInput): Promise<{
  readonly intent: RelayHostPairingIntent;
  readonly host: RelayHostListItem;
  readonly registrationToken: RelayHostRegistrationToken;
  readonly trustedRelaySigningKeyId?: string;
  readonly trustedRelaySigningKey?: string;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_RELAY_HOST_PAIRING_POLL_INTERVAL_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_RELAY_HOST_PAIRING_TIMEOUT_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const url = new URL(
      `/api/hosts/pairing-intents/${encodeURIComponent(input.intentId)}`,
      normalizeRelayHttpOrigin(input.relayUrl),
    );
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Relay pairing intent poll failed with status ${response.status}: ${await readErrorText(response)}`,
      );
    }

    const decoded = decodePairingPollResult(await response.json());
    if (decoded.registrationToken && decoded.host) {
      return {
        intent: decoded.intent,
        host: decoded.host,
        registrationToken: decoded.registrationToken,
        ...(decoded.trustedRelaySigningKeyId
          ? { trustedRelaySigningKeyId: decoded.trustedRelaySigningKeyId }
          : {}),
        ...(decoded.trustedRelaySigningKey
          ? { trustedRelaySigningKey: decoded.trustedRelaySigningKey }
          : {}),
      };
    }
    if (decoded.intent.status === "approved") {
      throw new Error("Relay pairing intent was approved but no host token was returned.");
    }

    if (decoded.intent.status === "expired") {
      throw new Error("Relay pairing intent expired before approval.");
    }
    if (decoded.intent.status === "revoked") {
      throw new Error("Relay pairing intent was revoked.");
    }
    if (decoded.intent.status === "consumed") {
      throw new Error("Relay pairing intent was already consumed.");
    }

    await delay(pollIntervalMs);
  }

  throw new Error("Timed out waiting for Relay host pairing approval.");
}

export async function revokeRelayHostRegistration(
  input: RevokeRelayHostRegistrationInput,
): Promise<void> {
  const url = new URL(
    `/api/hosts/${encodeURIComponent(input.hostId)}/revoke`,
    normalizeRelayHttpOrigin(input.relayUrl),
  );
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.registrationToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Relay host revoke failed with status ${response.status}: ${await readErrorText(response)}`,
    );
  }
}

export async function registerRelayHostPublicKey(
  input: RegisterRelayHostPublicKeyInput,
): Promise<typeof RelayHostPublicKeyRegistrationResult.Type> {
  const url = new URL(
    `/api/hosts/${encodeURIComponent(input.hostId)}/public-key`,
    normalizeRelayHttpOrigin(input.relayUrl),
  );
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.registrationToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      hostId: input.hostId,
      registrationToken: input.registrationToken,
      hostKeyId: input.keyMaterial.hostKeyId,
      publicKeyPem: input.keyMaterial.hostPublicKeyPem,
      algorithm: "ed25519",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Relay host key registration failed with status ${response.status}: ${await readErrorText(response)}`,
    );
  }
  return decodePublicKeyRegistrationResult(await response.json());
}

export async function requestRelayHostTunnelChallenge(
  input: RequestRelayHostTunnelChallengeInput,
): Promise<typeof RelayHostTunnelChallengeResult.Type> {
  const request: typeof RelayHostTunnelChallengeInput.Type = {
    hostId: input.hostId as (typeof RelayHostTunnelChallengeInput.Type)["hostId"],
    hostKeyId: input.hostKeyId,
  };
  const url = new URL(
    `/api/hosts/${encodeURIComponent(input.hostId)}/tunnel-challenge`,
    normalizeRelayHttpOrigin(input.relayUrl),
  );
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.registrationToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(
      `Relay tunnel challenge failed with status ${response.status}: ${await readErrorText(response)}`,
    );
  }
  return decodeTunnelChallengeResult(await response.json());
}

export async function saveApprovedRelayHostConnection(
  input: SaveApprovedRelayHostConnectionInput,
): Promise<RelayHostConnectionConfig> {
  const config = {
    secretsDir: input.secretsDir,
    relayUrl: input.relayUrl,
    hostId: input.host.id,
    registrationToken: input.registrationToken.token,
    ...(input.trustedRelaySigningKeyId !== undefined
      ? { trustedRelaySigningKeyId: input.trustedRelaySigningKeyId }
      : {}),
    ...(input.trustedRelaySigningKey !== undefined
      ? { trustedRelaySigningKey: input.trustedRelaySigningKey }
      : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  } satisfies Parameters<typeof saveRelayHostConnection>[0];
  return saveRelayHostConnection(config);
}

function normalizeRelayHttpOrigin(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("relayUrl must use http:// or https://");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function readErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : response.statusText || "Unknown error";
  } catch {
    return response.statusText || "Unknown error";
  }
}
