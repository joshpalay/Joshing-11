import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// AccountActions calls useRouter() at render; stub it so the component can be
// statically rendered in the node test environment.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { AccountActions } from "../AccountActions";

/**
 * The "Preview the loading screen" link lives inside the Developer-tools
 * section, which is gated by the same `isAdmin` (ADMIN_USER_IDS via
 * isAdminUser) mechanism as every other dev tool (B-LOADING-MOMENT-01 Phase 4).
 */
describe("AccountActions — loading-screen preview link", () => {
  it("renders the preview link, pointing at /dev/loading-preview, inside the Developer-tools section", () => {
    const html = renderToStaticMarkup(<AccountActions isAdmin />);

    expect(html).toContain("Preview the loading screen");
    expect(html).toContain('href="/dev/loading-preview"');

    // It sits within the Developer-tools section: after that heading and before
    // the Account heading — i.e. inside the `showDeveloperTools` gate, not the
    // always-visible Account block.
    const devHeading = html.indexOf("Developer tools");
    const accountHeading = html.indexOf("Account</h2>");
    const previewLink = html.indexOf("Preview the loading screen");
    expect(devHeading).toBeGreaterThanOrEqual(0);
    expect(accountHeading).toBeGreaterThan(devHeading);
    expect(previewLink).toBeGreaterThan(devHeading);
    expect(previewLink).toBeLessThan(accountHeading);
  });
});
