import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ClientSettingsSchema,
  DEFAULT_CHAT_FONT_SIZE_PX,
  DEFAULT_CLIENT_SETTINGS,
  MAX_CHAT_FONT_SIZE_PX,
  MIN_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
} from "./settings";

describe("ClientSettingsSchema", () => {
  it("decodes typography defaults for missing client settings", () => {
    expect(Schema.decodeSync(ClientSettingsSchema)({})).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      uiFontFamily: "",
      chatCodeFontFamily: "",
      chatFontSizePx: DEFAULT_CHAT_FONT_SIZE_PX,
    });
  });

  it("clamps chat font size while decoding persisted settings", () => {
    expect(Schema.decodeSync(ClientSettingsSchema)({ chatFontSizePx: 7 }).chatFontSizePx).toBe(
      MIN_CHAT_FONT_SIZE_PX,
    );
    expect(Schema.decodeSync(ClientSettingsSchema)({ chatFontSizePx: 24 }).chatFontSizePx).toBe(
      MAX_CHAT_FONT_SIZE_PX,
    );
    expect(Schema.decodeSync(ClientSettingsSchema)({ chatFontSizePx: 13.6 }).chatFontSizePx).toBe(
      14,
    );
  });
});

describe("normalizeChatFontSizePx", () => {
  it("normalizes invalid values to the default chat font size", () => {
    expect(normalizeChatFontSizePx(null)).toBe(DEFAULT_CHAT_FONT_SIZE_PX);
    expect(normalizeChatFontSizePx(undefined)).toBe(DEFAULT_CHAT_FONT_SIZE_PX);
    expect(normalizeChatFontSizePx(Number.NaN)).toBe(DEFAULT_CHAT_FONT_SIZE_PX);
  });
});
