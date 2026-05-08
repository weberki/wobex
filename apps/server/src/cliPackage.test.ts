import { describe, expect, it } from "vitest";

import serverPackageJson from "../package.json" with { type: "json" };

describe("server package CLI bins", () => {
  it("publishes Wobex and wobex aliases for the host control CLI", () => {
    expect(serverPackageJson.bin).toEqual({
      wobex: "./dist/bin.mjs",
      Wobex: "./dist/bin.mjs",
    });
  });
});
