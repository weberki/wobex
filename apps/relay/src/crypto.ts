import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_TOKEN_BYTES = 32;

export function createOpaqueToken(size = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(size).toString("base64url");
}

export function createSalt(size = 16): string {
  return randomBytes(size).toString("hex");
}

export function hashToken(token: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

export function tokenMatchesHash(token: string, salt: string, expectedHash: string): boolean {
  const nextHash = hashToken(token, salt);
  const left = Buffer.from(nextHash, "utf8");
  const right = Buffer.from(expectedHash, "utf8");
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function newHashedToken(): {
  token: string;
  salt: string;
  tokenHash: string;
} {
  const token = createOpaqueToken();
  const salt = createSalt();
  return {
    token,
    salt,
    tokenHash: hashToken(token, salt),
  };
}
