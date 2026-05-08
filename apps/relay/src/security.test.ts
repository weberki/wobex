import { describe, expect, it } from "vitest";

import { isAllowedWebSocketOrigin } from "./security";

describe("isAllowedWebSocketOrigin", () => {
  it("accepts exact and local host origins", () => {
    expect(isAllowedWebSocketOrigin("https://code.example.com", ["https://code.example.com"])).toBe(
      true,
    );
    expect(isAllowedWebSocketOrigin("http://127.0.0.1:5173", ["http://127.0.0.1"])).toBe(true);
  });

  it("rejects origins outside the allowlist", () => {
    expect(isAllowedWebSocketOrigin("https://evil.example", ["https://code.example.com"])).toBe(
      false,
    );
  });
});
