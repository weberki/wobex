import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

export class FixedWindowRateLimiter {
  #limit: number;
  #windowMs: number;
  #hitsByKey = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  consume(key: string, nowMs = Date.now()): RateLimitResult {
    const active = (this.#hitsByKey.get(key) ?? []).filter(
      (timestamp) => nowMs - timestamp < this.#windowMs,
    );
    active.push(nowMs);
    this.#hitsByKey.set(key, active);

    if (active.length > this.#limit) {
      const retryAfterMs = this.#windowMs - (nowMs - (active[0] ?? nowMs));
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.#limit - active.length),
    };
  }
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createSessionCookieSignature(
  sessionId: string,
  sessionToken: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(`${sessionId}.${sessionToken}`).digest("base64url");
}

export function createSessionCookieValue(
  sessionId: string,
  sessionToken: string,
  secret: string,
): string {
  const signature = createSessionCookieSignature(sessionId, sessionToken, secret);
  return `${sessionId}.${sessionToken}.${signature}`;
}

export function parseSessionCookieValue(
  value: string,
  secret: string,
): { sessionId: string; sessionToken: string } | null {
  const separator = value.lastIndexOf(".");
  const secondSeparator = value.lastIndexOf(".", separator - 1);
  if (separator <= 0 || secondSeparator <= 0) {
    return null;
  }
  const sessionId = value.slice(0, secondSeparator);
  const sessionToken = value.slice(secondSeparator + 1, separator);
  const signature = value.slice(separator + 1);
  const expected = createSessionCookieSignature(sessionId, sessionToken, secret);
  if (!timingSafeEqualUtf8(signature, expected)) {
    return null;
  }
  return { sessionId, sessionToken };
}

export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) {
    return false;
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  for (const candidate of allowedOrigins) {
    if (candidate === "*") {
      return true;
    }

    let parsedCandidate: URL;
    try {
      parsedCandidate = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    } catch {
      continue;
    }

    if (parsedCandidate.protocol !== parsedOrigin.protocol) {
      continue;
    }

    if (parsedCandidate.hostname !== parsedOrigin.hostname) {
      continue;
    }

    if (!parsedCandidate.port) {
      return true;
    }

    if (parsedCandidate.port === parsedOrigin.port) {
      return true;
    }
  }

  return false;
}

export function getOriginUrl(origin: string | undefined): URL | null {
  if (!origin) {
    return null;
  }
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function timingSafeEqualUtf8(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
