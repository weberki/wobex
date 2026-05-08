import { randomUUID } from "node:crypto";

import { newHashedToken, tokenMatchesHash } from "./crypto";
import { RelayMetadataStore } from "./metadataStore";
import { type Clock, isoNow, systemClock } from "./time";

interface LoginChallenge {
  id: string;
  userId: string;
  email: string;
  tokenHash: string;
  tokenSalt: string;
  expiresAt: number;
  consumedAt?: number;
}

interface UserSession {
  id: string;
  userId: string;
  deviceLabel?: string;
  sessionTokenHash: string;
  sessionTokenSalt: string;
  expiresAt: number;
  revokedAt?: number;
}

export interface LoginServiceOptions {
  challengeTtlMs?: number;
  sessionTtlMs?: number;
}

export class PasswordlessLoginService {
  #clock: Clock;
  #store: RelayMetadataStore;
  #challengeTtlMs: number;
  #sessionTtlMs: number;
  #challenges = new Map<string, LoginChallenge>();
  #sessions = new Map<string, UserSession>();

  constructor(
    store: RelayMetadataStore,
    options: LoginServiceOptions = {},
    clock: Clock = systemClock,
  ) {
    this.#store = store;
    this.#clock = clock;
    this.#challengeTtlMs = options.challengeTtlMs ?? 10 * 60 * 1000;
    this.#sessionTtlMs = options.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  startLogin(email: string): {
    challengeId: string;
    email: string;
    verificationToken: string;
    expiresAt: string;
    userId: string;
  } {
    const user = this.#store.upsertUserByEmail(email);
    const hashedToken = newHashedToken();
    const challengeId = randomUUID();
    const expiresAt = this.#clock.now().getTime() + this.#challengeTtlMs;

    this.#challenges.set(challengeId, {
      id: challengeId,
      userId: user.id,
      email: user.email,
      tokenHash: hashedToken.tokenHash,
      tokenSalt: hashedToken.salt,
      expiresAt,
    });

    return {
      challengeId,
      email: user.email,
      verificationToken: hashedToken.token,
      expiresAt: new Date(expiresAt).toISOString(),
      userId: user.id,
    };
  }

  verifyLogin(
    challengeId: string,
    verificationToken: string,
    deviceLabel?: string,
  ): { sessionId: string; sessionToken: string; userId: string; expiresAt: string } {
    const challenge = this.#challenges.get(challengeId);
    const nowMs = this.#clock.now().getTime();

    if (!challenge || challenge.expiresAt <= nowMs || challenge.consumedAt) {
      throw new Error("Invalid or expired login challenge");
    }

    const validToken = tokenMatchesHash(
      verificationToken,
      challenge.tokenSalt,
      challenge.tokenHash,
    );
    if (!validToken) {
      throw new Error("Invalid login token");
    }

    challenge.consumedAt = nowMs;

    const sessionId = randomUUID();
    const sessionToken = newHashedToken();
    const sessionExpiresAt = nowMs + this.#sessionTtlMs;
    const nextSession: UserSession = {
      id: sessionId,
      userId: challenge.userId,
      sessionTokenHash: sessionToken.tokenHash,
      sessionTokenSalt: sessionToken.salt,
      expiresAt: sessionExpiresAt,
    };
    if (deviceLabel) {
      nextSession.deviceLabel = deviceLabel;
    }
    this.#sessions.set(sessionId, nextSession);

    return {
      sessionId,
      sessionToken: sessionToken.token,
      userId: challenge.userId,
      expiresAt: new Date(sessionExpiresAt).toISOString(),
    };
  }

  validateSession(sessionId: string, sessionToken: string): { userId: string } | null {
    const session = this.#sessions.get(sessionId);
    const nowMs = this.#clock.now().getTime();
    if (!session || session.expiresAt <= nowMs || session.revokedAt) {
      return null;
    }
    const valid = tokenMatchesHash(
      sessionToken,
      session.sessionTokenSalt,
      session.sessionTokenHash,
    );
    if (!valid) {
      return null;
    }
    return { userId: session.userId };
  }

  revokeSession(sessionId: string): void {
    const current = this.#sessions.get(sessionId);
    if (!current || current.revokedAt) {
      return;
    }
    current.revokedAt = this.#clock.now().getTime();
  }

  listSessionsForUser(userId: string): readonly {
    id: string;
    userId: string;
    deviceLabel?: string;
    expiresAt: string;
    revokedAt?: string;
  }[] {
    return [...this.#sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => {
        const summary: {
          id: string;
          userId: string;
          expiresAt: string;
          deviceLabel?: string;
          revokedAt?: string;
        } = {
          id: session.id,
          userId: session.userId,
          expiresAt: new Date(session.expiresAt).toISOString(),
        };
        if (session.deviceLabel) {
          summary.deviceLabel = session.deviceLabel;
        }
        if (session.revokedAt !== undefined) {
          summary.revokedAt = new Date(session.revokedAt).toISOString();
        }
        return summary;
      });
  }

  getNowIso(): string {
    return isoNow(this.#clock);
  }
}
