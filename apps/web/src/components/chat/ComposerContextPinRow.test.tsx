import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerContextPinRow } from "./ComposerContextPinRow";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import type { TerminalContextDraft } from "../../lib/terminalContext";

const noop = () => undefined;
const emptyProps = {
  images: [] as ComposerImageAttachment[],
  terminalContexts: [] as TerminalContextDraft[],
  branchName: null,
  onRemoveImage: noop,
  onOpenImagePreview: noop,
  onRemoveTerminalContext: noop,
  onFocusTerminalContext: noop,
  onAddImage: noop,
};

const makeImage = (id: string, name: string): ComposerImageAttachment =>
  ({
    id,
    name,
    previewUrl: "",
    type: "image",
    mimeType: "image/png",
    sizeBytes: 0,
    file: {} as File,
  }) as unknown as ComposerImageAttachment;

const makeCtx = (id: string, terminalLabel: string): TerminalContextDraft =>
  ({
    id,
    terminalLabel,
    terminalId: `term-${id}`,
    threadId: "thread-1",
    createdAt: new Date().toISOString(),
    lineStart: 0,
    lineEnd: 5,
    text: "some text",
  }) as unknown as TerminalContextDraft;

describe("ComposerContextPinRow", () => {
  it("returns null when there are no pins", () => {
    const html = renderToStaticMarkup(<ComposerContextPinRow {...emptyProps} />);
    expect(html).toBe("");
  });

  it("renders an image pin with count", () => {
    const html = renderToStaticMarkup(
      <ComposerContextPinRow
        {...emptyProps}
        images={[makeImage("1", "a.png"), makeImage("2", "b.png")]}
      />,
    );
    expect(html).toMatch(/2 images/i);
  });

  it("renders a terminal-context pin per entry", () => {
    const html = renderToStaticMarkup(
      <ComposerContextPinRow {...emptyProps} terminalContexts={[makeCtx("t1", "bash")]} />,
    );
    expect(html).toMatch(/bash/i);
  });

  it("renders a branch pin without a remove button", () => {
    const html = renderToStaticMarkup(<ComposerContextPinRow {...emptyProps} branchName="main" />);
    expect(html).toMatch(/main/i);
    // No remove button on the branch pin — the X button should not have "main" in aria-label
    expect(html).not.toMatch(/remove.*main/i);
  });

  it("renders a remove button for the image pin with the correct aria-label", () => {
    const html = renderToStaticMarkup(
      <ComposerContextPinRow {...emptyProps} images={[makeImage("1", "a.png")]} />,
    );
    expect(html).toMatch(/aria-label="Remove images"/i);
  });
});
