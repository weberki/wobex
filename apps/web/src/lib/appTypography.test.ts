import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  MAX_CHAT_FONT_SIZE_PX,
  MIN_CHAT_FONT_SIZE_PX,
} from "@wobex/contracts/settings";
import { getAppTypographyScale } from "./appTypography";

describe("getAppTypographyScale", () => {
  it("derives the default UI and chat typography scale", () => {
    expect(getAppTypographyScale(DEFAULT_CHAT_FONT_SIZE_PX)).toEqual({
      basePx: 12,
      uiPx: 12,
      uiLgPx: 13,
      uiSmPx: 11,
      uiXsPx: 10,
      ui2XsPx: 9,
      uiMetaPx: 10,
      uiTimestampPx: 9,
      chatPx: 12,
      chatCodePx: 11,
      chatMetaPx: 9,
      chatTinyPx: 8,
    });
  });

  it("keeps UI and chat typography dense without negative tracking", () => {
    expect(getAppTypographyScale(12)).toMatchObject({
      basePx: 12,
      uiPx: 12,
      uiLgPx: 13,
      uiSmPx: 11,
      uiXsPx: 10,
      ui2XsPx: 9,
      chatPx: 12,
      chatCodePx: 11,
    });
  });

  it("uses the same bounds as persisted chat font settings", () => {
    expect(getAppTypographyScale(4).basePx).toBe(MIN_CHAT_FONT_SIZE_PX);
    expect(getAppTypographyScale(99).basePx).toBe(MAX_CHAT_FONT_SIZE_PX);
  });
});
