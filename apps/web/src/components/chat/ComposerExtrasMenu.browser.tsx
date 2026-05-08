import "../../index.css";

import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ComposerExtrasMenu } from "./ComposerExtrasMenu";

describe("ComposerExtrasMenu", () => {
  it("fires onSetPlanMode when Plan mode toggled", async () => {
    const onSetPlanMode = vi.fn();
    render(
      <ComposerExtrasMenu
        interactionMode="default"
        supportsFastMode
        fastModeEnabled={false}
        onAddPhotos={() => undefined}
        onToggleFastMode={() => undefined}
        onSetPlanMode={onSetPlanMode}
      />,
    );
    await page.getByRole("button", { name: /composer extras/i }).click();
    await page.getByText(/plan mode/i).click();
    expect(onSetPlanMode).toHaveBeenCalledWith(true);
  });

  it("fires onToggleFastMode when Fast submenu value changes", async () => {
    const onToggleFastMode = vi.fn();
    render(
      <ComposerExtrasMenu
        interactionMode="default"
        supportsFastMode
        fastModeEnabled={false}
        onAddPhotos={() => undefined}
        onToggleFastMode={onToggleFastMode}
        onSetPlanMode={() => undefined}
      />,
    );
    await page.getByRole("button", { name: /composer extras/i }).click();
    await page.getByText(/^fast$/i).hover();
    await page.getByText(/^fast$/i).click();
    // After hover opens the submenu, click the "Fast" radio item
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Default");
    });
    await page
      .getByText(/^Fast$/i)
      .last()
      .click();
    expect(onToggleFastMode).toHaveBeenCalled();
  });

  it("omits Fast submenu when supportsFastMode is false", async () => {
    render(
      <ComposerExtrasMenu
        interactionMode="default"
        supportsFastMode={false}
        fastModeEnabled={false}
        onAddPhotos={() => undefined}
        onToggleFastMode={() => undefined}
        onSetPlanMode={() => undefined}
      />,
    );
    await page.getByRole("button", { name: /composer extras/i }).click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Plan mode");
    });
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toContain("Fast");
  });
});
