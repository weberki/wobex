import type { IncomingMessage, ServerResponse } from "node:http";

export interface CookieOptions {
  httpOnly?: boolean;
  maxAgeSeconds?: number;
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
}

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload, "utf8"));
  response.end(payload);
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function methodNotAllowed(
  response: ServerResponse,
  allowedMethods: readonly string[],
): void {
  response.setHeader("allow", allowedMethods.join(", "));
  sendJson(response, 405, {
    error: "Method not allowed",
    allowedMethods,
  });
}

export async function readRequestBodyBuffer(
  request: IncomingMessage,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseCookieHeader(
  cookieHeader: string | string[] | undefined,
): Record<string, string> {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : (cookieHeader ?? "");
  const cookies: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const entry = part.trim();
    if (!entry) {
      continue;
    }
    const separator = entry.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly) {
    segments.push("HttpOnly");
  }
  if (options.secure) {
    segments.push("Secure");
  }
  if (options.sameSite) {
    segments.push(
      `SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`,
    );
  }
  if (typeof options.maxAgeSeconds === "number") {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  return segments.join("; ");
}

export function sendText(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body, "utf8"));
  response.end(body);
}

export function sendNoContent(response: ServerResponse): void {
  response.statusCode = 204;
  response.end();
}
