import { randomUUID } from "node:crypto";

import { type Clock, isoNow, systemClock } from "./time";
import type { RelayAuditEvent } from "./types";

type AuditMetadataPrimitive = string | number | boolean | null;

const BANNED_METADATA_KEYS = new Set([
  "content",
  "payload",
  "prompt",
  "message",
  "messages",
  "diff",
  "terminalOutput",
  "body",
  "data",
  "text",
]);

function sanitizeAuditMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, AuditMetadataPrimitive>> {
  if (!metadata) {
    return {};
  }
  const sanitized: Record<string, AuditMetadataPrimitive> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BANNED_METADATA_KEYS.has(key)) {
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export type AuditEventInput = Omit<RelayAuditEvent, "id" | "createdAt" | "metadata"> & {
  metadata?: Readonly<Record<string, unknown>>;
};

export class InMemoryAuditLog {
  #clock: Clock;
  #events: RelayAuditEvent[] = [];

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  write(input: AuditEventInput): RelayAuditEvent {
    const entry: RelayAuditEvent = {
      ...input,
      id: randomUUID(),
      createdAt: isoNow(this.#clock),
      metadata: sanitizeAuditMetadata(input.metadata),
    };
    this.#events.push(entry);
    return entry;
  }

  list(): readonly RelayAuditEvent[] {
    return this.#events;
  }
}
