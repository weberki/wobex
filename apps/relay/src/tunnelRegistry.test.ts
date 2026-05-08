import { describe, expect, it } from "vitest";

import { RelayTunnelRegistry } from "./tunnelRegistry";

describe("RelayTunnelRegistry", () => {
  it("tracks active host tunnel connections in memory", () => {
    const registry = new RelayTunnelRegistry();
    registry.connect({
      connectionId: "connection-1",
      hostId: "host-1",
      send: () => {},
    });

    expect(registry.require("host-1").id).toBe("connection-1");
    expect(registry.disconnect("host-1", "wrong")).toBe(false);
    expect(registry.disconnect("host-1", "connection-1")).toBe(true);
    expect(() => registry.require("host-1")).toThrow(/offline/);
  });

  it("records only frame routing metadata, not proxied payload bodies", () => {
    const registry = new RelayTunnelRegistry();

    const metadata = registry.recordFrame({
      version: 1,
      type: "http.response",
      hostId: "host-1",
      deviceId: "device-1",
      requestId: "request-1",
      timestamp: "2026-04-15T10:00:00.000Z",
      payload: {
        statusCode: 200,
        headers: {
          "content-type": "application/json",
        },
        bodyBase64: "eyJzZWNyZXQiOiJkbyBub3QgcGVyc2lzdCJ9",
        byteCount: 34,
      },
    });

    expect(metadata).toMatchObject({
      hostId: "host-1",
      deviceId: "device-1",
      requestId: "request-1",
      type: "http.response",
      statusCode: 200,
      byteCount: 34,
    });
    expect(JSON.stringify(registry.listFrameMetadata())).not.toContain("bodyBase64");
    expect(JSON.stringify(registry.listFrameMetadata())).not.toContain("secret");
  });
});
