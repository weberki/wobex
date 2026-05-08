import { describe, expect, it } from "vitest";
import { scopeThreadRef } from "@wobex/client-runtime";
import { ThreadId } from "@wobex/contracts";
import { DraftId } from "./composerDraftStore";

import {
  buildDraftThreadRouteParams,
  buildThreadRouteRefKey,
  buildThreadRouteParams,
  resolveThreadRouteRef,
  resolveThreadRouteRefFromKey,
  resolveThreadRouteRefKey,
  resolveThreadRouteTarget,
  resolveThreadRouteTargetFromKey,
  resolveThreadRouteTargetKey,
} from "./threadRoutes";

describe("threadRoutes", () => {
  it("builds canonical thread route params from a scoped ref", () => {
    const ref = scopeThreadRef("env-1" as never, ThreadId.make("thread-1"));

    expect(buildThreadRouteParams(ref)).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });
  });

  it("resolves a scoped ref only when both params are present", () => {
    expect(
      resolveThreadRouteRef({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });

    expect(resolveThreadRouteRef({ environmentId: "env-1" })).toBeNull();
    expect(resolveThreadRouteRef({ threadId: "thread-1" })).toBeNull();
  });

  it("round-trips route refs through primitive keys", () => {
    const ref = scopeThreadRef("env-1" as never, ThreadId.make("thread-1"));
    const key = buildThreadRouteRefKey(ref);

    expect(
      resolveThreadRouteRefKey({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toBe(key);
    expect(resolveThreadRouteRefFromKey(key)).toEqual(ref);
    expect(resolveThreadRouteRefFromKey(null)).toBeNull();
    expect(resolveThreadRouteRefFromKey("env-1")).toBeNull();
  });

  it("builds canonical draft route params from a draft id", () => {
    expect(buildDraftThreadRouteParams(DraftId.make("draft-1"))).toEqual({
      draftId: "draft-1",
    });
  });

  it("resolves draft and server route targets", () => {
    expect(
      resolveThreadRouteTarget({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "server",
      threadRef: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
    });

    expect(
      resolveThreadRouteTarget({
        draftId: "draft-1",
      }),
    ).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
  });

  it("round-trips route targets through primitive keys", () => {
    const serverKey = resolveThreadRouteTargetKey({
      environmentId: "env-1",
      threadId: "thread-1",
    });
    const draftKey = resolveThreadRouteTargetKey({
      draftId: "draft-1",
    });

    expect(resolveThreadRouteTargetFromKey(serverKey)).toEqual({
      kind: "server",
      threadRef: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
    });
    expect(resolveThreadRouteTargetFromKey(draftKey)).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
    expect(resolveThreadRouteTargetFromKey(null)).toBeNull();
    expect(resolveThreadRouteTargetFromKey("server")).toBeNull();
  });
});
