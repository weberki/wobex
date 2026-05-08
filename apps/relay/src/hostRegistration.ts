import { randomUUID } from "node:crypto";

import { newHashedToken, tokenMatchesHash } from "./crypto";
import { type Clock, isoNow, systemClock } from "./time";

interface HostRegistrationTokenRecord {
  id: string;
  hostId: string;
  tokenHash: string;
  tokenSalt: string;
  createdAt: string;
  revokedAt?: string;
}

export class HostRegistrationTokenService {
  #clock: Clock;
  #tokenByHost = new Map<string, HostRegistrationTokenRecord>();
  #tokenById = new Map<string, HostRegistrationTokenRecord>();

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  issue(hostId: string): { tokenId: string; hostId: string; token: string; createdAt: string } {
    const hashed = newHashedToken();
    const record: HostRegistrationTokenRecord = {
      id: randomUUID(),
      hostId,
      tokenHash: hashed.tokenHash,
      tokenSalt: hashed.salt,
      createdAt: isoNow(this.#clock),
    };
    this.#tokenByHost.set(hostId, record);
    this.#tokenById.set(record.id, record);
    return {
      tokenId: record.id,
      hostId,
      token: hashed.token,
      createdAt: record.createdAt,
    };
  }

  rotate(hostId: string): {
    previousTokenId?: string;
    tokenId: string;
    token: string;
  } {
    const previous = this.#tokenByHost.get(hostId);
    if (previous && !previous.revokedAt) {
      previous.revokedAt = isoNow(this.#clock);
    }
    const next = this.issue(hostId);
    if (!previous) {
      return {
        tokenId: next.tokenId,
        token: next.token,
      };
    }
    return {
      previousTokenId: previous.id,
      tokenId: next.tokenId,
      token: next.token,
    };
  }

  revokeByHost(hostId: string): void {
    const current = this.#tokenByHost.get(hostId);
    if (!current || current.revokedAt) {
      return;
    }
    current.revokedAt = isoNow(this.#clock);
  }

  validate(hostId: string, token: string): { tokenId: string } | null {
    const current = this.#tokenByHost.get(hostId);
    if (!current || current.revokedAt) {
      return null;
    }
    const valid = tokenMatchesHash(token, current.tokenSalt, current.tokenHash);
    if (!valid) {
      return null;
    }
    return { tokenId: current.id };
  }

  getTokenRecordForHost(hostId: string): {
    id: string;
    hostId: string;
    createdAt: string;
    revokedAt?: string;
  } | null {
    const token = this.#tokenByHost.get(hostId);
    if (!token) {
      return null;
    }
    const summary = {
      id: token.id,
      hostId: token.hostId,
      createdAt: token.createdAt,
    };
    if (token.revokedAt) {
      return { ...summary, revokedAt: token.revokedAt };
    }
    return summary;
  }
}
