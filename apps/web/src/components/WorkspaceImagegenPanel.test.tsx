import { EnvironmentId } from "@wobex/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceImagegenPanel } from "./WorkspaceImagegenPanel";

describe("WorkspaceImagegenPanel", () => {
  it("renders the direct image generation controls and batch surface", () => {
    const html = renderToStaticMarkup(
      <WorkspaceImagegenPanel
        environmentId={EnvironmentId.make("environment-local")}
        workspaceRoot="D:\\2Dev\\wbr\\wobex"
      />,
    );

    expect(html).toContain("Imagegen");
    expect(html).toContain("Prompt");
    expect(html).toContain("Batch");
    expect(html).toContain("16:9");
    expect(html).toContain("1920x1080");
    expect(html).toContain("$imagegen");
  });
});
