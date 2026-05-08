import { scopeThreadRef } from "@wobex/client-runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@wobex/contracts";
import type { DraftId } from "./composerDraftStore";

const THREAD_ROUTE_KEY_SEPARATOR = "\u0000";

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftId;
    };

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function buildDraftThreadRouteParams(draftId: DraftId): {
  draftId: DraftId;
} {
  return { draftId };
}

export function resolveThreadRouteRef(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (!params.environmentId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId);
}

export function buildThreadRouteRefKey(ref: ScopedThreadRef): string {
  return [ref.environmentId, ref.threadId].join(THREAD_ROUTE_KEY_SEPARATOR);
}

export function resolveThreadRouteRefKey(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): string | null {
  const ref = resolveThreadRouteRef(params);
  return ref ? buildThreadRouteRefKey(ref) : null;
}

export function resolveThreadRouteRefFromKey(key: string | null): ScopedThreadRef | null {
  if (!key) {
    return null;
  }
  const [environmentId, threadId, ...extraParts] = key.split(THREAD_ROUTE_KEY_SEPARATOR);
  if (!environmentId || !threadId || extraParts.length > 0) {
    return null;
  }
  return scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId);
}

export function resolveThreadRouteTarget(
  params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
): ThreadRouteTarget | null {
  if (params.environmentId && params.threadId) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId),
    };
  }

  if (!params.draftId) {
    return null;
  }

  return {
    kind: "draft",
    draftId: params.draftId as DraftId,
  };
}

export function resolveThreadRouteTargetKey(
  params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
): string | null {
  if (params.environmentId && params.threadId) {
    return ["server", params.environmentId, params.threadId].join(THREAD_ROUTE_KEY_SEPARATOR);
  }
  if (params.draftId) {
    return ["draft", params.draftId].join(THREAD_ROUTE_KEY_SEPARATOR);
  }
  return null;
}

export function resolveThreadRouteTargetFromKey(key: string | null): ThreadRouteTarget | null {
  if (!key) {
    return null;
  }
  const parts = key.split(THREAD_ROUTE_KEY_SEPARATOR);
  if (parts[0] === "server" && parts.length === 3) {
    const [, environmentId, threadId] = parts;
    if (!environmentId || !threadId) {
      return null;
    }
    return {
      kind: "server",
      threadRef: scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
    };
  }
  if (parts[0] === "draft" && parts.length === 2) {
    const [, draftId] = parts;
    return draftId
      ? {
          kind: "draft",
          draftId: draftId as DraftId,
        }
      : null;
  }
  return null;
}
