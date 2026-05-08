import { randomUUID } from "node:crypto";

import { createOpaqueToken } from "./crypto";
import { HostRegistrationTokenService } from "./hostRegistration";
import { RelayMetadataStore } from "./metadataStore";
import { type Clock, isoNow, systemClock } from "./time";

interface HostPairingIntent {
  id: string;
  hostLabel: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  deviceCode: string;
  qrToken: string;
  approvedAt?: number;
  approvedByUserId?: string;
  hostId?: string;
}

export interface HostPairingServiceOptions {
  pairingTtlMs?: number;
}

export class HostPairingService {
  #clock: Clock;
  #store: RelayMetadataStore;
  #tokenService: HostRegistrationTokenService;
  #pairingTtlMs: number;
  #intents = new Map<string, HostPairingIntent>();
  #intentByDeviceCode = new Map<string, HostPairingIntent>();

  constructor(
    store: RelayMetadataStore,
    tokenService: HostRegistrationTokenService,
    options: HostPairingServiceOptions = {},
    clock: Clock = systemClock,
  ) {
    this.#store = store;
    this.#tokenService = tokenService;
    this.#clock = clock;
    this.#pairingTtlMs = options.pairingTtlMs ?? 10 * 60 * 1000;
  }

  createIntent(params: { userId: string; hostLabel: string }): {
    intentId: string;
    userId: string;
    hostLabel: string;
    deviceCode: string;
    qrToken: string;
    expiresAt: string;
  } {
    const now = this.#clock.now().getTime();
    const intent: HostPairingIntent = {
      id: randomUUID(),
      userId: params.userId,
      hostLabel: params.hostLabel,
      createdAt: now,
      expiresAt: now + this.#pairingTtlMs,
      deviceCode: createOpaqueToken(6),
      qrToken: createOpaqueToken(18),
    };
    this.#intents.set(intent.id, intent);
    this.#intentByDeviceCode.set(intent.deviceCode, intent);
    return {
      intentId: intent.id,
      userId: intent.userId,
      hostLabel: intent.hostLabel,
      deviceCode: intent.deviceCode,
      qrToken: intent.qrToken,
      expiresAt: new Date(intent.expiresAt).toISOString(),
    };
  }

  approveIntent(params: { deviceCode: string; approvedByUserId: string }): {
    intentId: string;
    hostId: string;
    hostRegistrationToken: string;
    hostRegistrationTokenId: string;
    approvedAt: string;
  } {
    const intent = this.#intentByDeviceCode.get(params.deviceCode);
    const now = this.#clock.now().getTime();
    if (!intent || intent.expiresAt <= now) {
      throw new Error("Pairing intent is missing or expired");
    }
    if (intent.approvedAt) {
      throw new Error("Pairing intent already approved");
    }
    if (intent.userId !== params.approvedByUserId) {
      throw new Error("Pairing intent approver mismatch");
    }
    const host = this.#store.createHost(intent.userId, intent.hostLabel);
    const token = this.#tokenService.issue(host.id);
    intent.approvedAt = now;
    intent.approvedByUserId = params.approvedByUserId;
    intent.hostId = host.id;

    return {
      intentId: intent.id,
      hostId: host.id,
      hostRegistrationToken: token.token,
      hostRegistrationTokenId: token.tokenId,
      approvedAt: isoNow(this.#clock),
    };
  }

  getIntentStatus(intentId: string): {
    intentId: string;
    state: "pending" | "approved" | "expired";
    approvedAt?: string;
    expiresAt: string;
  } | null {
    const intent = this.#intents.get(intentId);
    if (!intent) {
      return null;
    }
    const now = this.#clock.now().getTime();
    if (intent.approvedAt) {
      return {
        intentId,
        state: "approved",
        approvedAt: new Date(intent.approvedAt).toISOString(),
        expiresAt: new Date(intent.expiresAt).toISOString(),
      };
    }
    if (intent.expiresAt <= now) {
      return {
        intentId,
        state: "expired",
        expiresAt: new Date(intent.expiresAt).toISOString(),
      };
    }
    return {
      intentId,
      state: "pending",
      expiresAt: new Date(intent.expiresAt).toISOString(),
    };
  }
}
