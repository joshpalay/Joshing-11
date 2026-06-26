import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LoadingPreview } from "../LoadingPreview";
import { PREVIEW_STATES } from "../preview-states";

/**
 * Render-level coverage of the preview route's component (B-LOADING-MOMENT-01
 * Phase 4): each forced state renders the expected copy in the loading screen,
 * and the cycler exposes a control for every state.
 */
describe("LoadingPreview", () => {
  it("renders the moment artifact for a forced card state", () => {
    const html = renderToStaticMarkup(<LoadingPreview initialKey="turnaround" />);
    expect(html).toContain("A DISCOVERY");
    expect(html).toContain("Something you once got wrong, you now know cold — Tudor England.");
  });

  it("renders the exact locked sparse string for the sparse state", () => {
    const html = renderToStaticMarkup(<LoadingPreview initialKey="sparse" />);
    expect(html).toContain("Your knowledge map starts filling in as you play.");
  });

  it("renders the plain rotating copy (no moment) for the plain state", () => {
    const html = renderToStaticMarkup(<LoadingPreview initialKey="plain" />);
    expect(html).toContain("Crafting your bespoke questions");
    // No card copy leaks into the plain state.
    expect(html).not.toContain("A DISCOVERY");
  });

  it("exposes a cycler control for every preview state", () => {
    const html = renderToStaticMarkup(<LoadingPreview />);
    for (const state of PREVIEW_STATES) {
      expect(html).toContain(`>${state.key}</button>`);
    }
  });
});
