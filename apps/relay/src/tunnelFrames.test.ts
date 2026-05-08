import { describe, expect, it } from "vitest";

import { isTunnelFrame, validateTunnelFrame } from "./tunnelFrames";

describe("tunnel frame validation", () => {
  it("accepts valid relay tunnel frames", () => {
    const frame = {
      version: 1,
      type: "http.request",
      hostId: "host-1",
      deviceId: "device-1",
      requestId: "request-1",
      timestamp: "2026-04-15T10:00:00.000Z",
      payload: {
        method: "POST",
        path: "/api/auth/login/start",
        headers: { "content-type": "application/json" },
        bodyBase64: "eyJlbWFpbCI6ImFAZXhhbXBsZS5jb20ifQ==",
      },
    };

    expect(isTunnelFrame(frame)).toBe(true);
    expect(validateTunnelFrame(frame).ok).toBe(true);
  });

  it("rejects malformed relay tunnel frames", () => {
    const invalid = {
      version: 1,
      type: "http.response",
      hostId: "host-1",
      requestId: "request-1",
      timestamp: "2026-04-15T10:00:00.000Z",
      payload: {
        statusCode: "200",
      },
    };
    expect(isTunnelFrame(invalid)).toBe(false);
    expect(validateTunnelFrame(invalid)).toEqual({
      ok: false,
      error: "Invalid tunnel frame",
    });
  });
});
