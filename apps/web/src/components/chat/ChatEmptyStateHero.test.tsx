import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatEmptyStateHero } from "./ChatEmptyStateHero";

describe("ChatEmptyStateHero", () => {
  it("renders the Let's build heading", () => {
    const html = renderToStaticMarkup(<ChatEmptyStateHero projectName={undefined} />);
    // HTML-encodes apostrophe as &#x27;
    expect(html).toMatch(/Let&#x27;s build/);
  });

  it("renders the project name when provided", () => {
    const html = renderToStaticMarkup(<ChatEmptyStateHero projectName="server" />);
    expect(html).toContain("server");
  });

  it("omits the project name when undefined", () => {
    const html = renderToStaticMarkup(<ChatEmptyStateHero projectName={undefined} />);
    // Should not contain any span with project text
    expect(html).not.toMatch(/<span[^>]*>(?!.*empty-state)[^<]*<\/span>/);
  });

  it("exposes a logo slot via data attribute", () => {
    const html = renderToStaticMarkup(<ChatEmptyStateHero projectName={undefined} />);
    expect(html).toContain("data-empty-state-logo-slot");
  });
});
