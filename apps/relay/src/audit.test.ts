import { describe, expect, it } from "vitest";

import { InMemoryAuditLog } from "./audit";
import { TestClock } from "./testClock";

describe("InMemoryAuditLog", () => {
  it("stores metadata only and strips content payload fields", () => {
    const clock = new TestClock();
    const log = new InMemoryAuditLog(clock);

    const event = log.write({
      action: "capability.denied",
      actorUserId: "user-1",
      metadata: {
        hostId: "host-1",
        requestId: "req-1",
        payload: "sensitive payload text",
        prompt: "sensitive prompt text",
        message: "sensitive message text",
        statusCode: 403,
        allowed: false,
      },
    });

    expect(event.metadata).toEqual({
      hostId: "host-1",
      requestId: "req-1",
      statusCode: 403,
      allowed: false,
    });
    const listed = log.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.metadata.payload).toBeUndefined();
    expect(listed[0]?.metadata.prompt).toBeUndefined();
    expect(listed[0]?.metadata.message).toBeUndefined();
  });
});
