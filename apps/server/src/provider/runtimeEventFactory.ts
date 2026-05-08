import {
  EventId,
  RuntimeItemId,
  RuntimeRequestId,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@wobex/contracts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomEventId(): EventId {
  return EventId.make(crypto.randomUUID());
}

export function asRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.make(value);
}

export function asRuntimeRequestId(value: string): RuntimeRequestId {
  return RuntimeRequestId.make(value);
}

export function runtimeEventBase(input: {
  readonly provider: ProviderKind;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly itemId?: RuntimeItemId;
  readonly requestId?: RuntimeRequestId;
  readonly raw?: ProviderRuntimeEvent["raw"];
  readonly providerRefs?: ProviderRuntimeEvent["providerRefs"];
}): Omit<ProviderRuntimeEvent, "type" | "payload"> {
  return {
    eventId: randomEventId(),
    provider: input.provider,
    threadId: input.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: input.itemId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.raw ? { raw: input.raw } : {}),
    ...(input.providerRefs ? { providerRefs: input.providerRefs } : {}),
  };
}
