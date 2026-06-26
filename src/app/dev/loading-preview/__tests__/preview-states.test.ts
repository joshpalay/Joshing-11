import { describe, expect, it } from "vitest";

import type { LoadingMomentCardKind } from "@/components/loading-moment/types";

import { PREVIEW_STATES, resolvePreviewState } from "../preview-states";

/**
 * The dev preview must cycle EVERY card type plus the sparse fallback and the
 * plain state (B-LOADING-MOMENT-01 Phase 4). These assert the forced states
 * resolve through the real selector — route-passing is not enough.
 */
describe("loading-preview states", () => {
  it("covers all six card kinds + sparse + plain", () => {
    const keys = PREVIEW_STATES.map((s) => s.key);
    expect(keys).toEqual([
      "deepest-territory",
      "rare-knowledge",
      "turnaround",
      "deepest-cut",
      "overlap",
      "waiting-discovery",
      "sparse",
      "plain",
    ]);
  });

  it("each card-kind state resolves through the real selector to its own kind", () => {
    const expected: Record<string, LoadingMomentCardKind> = {
      "deepest-territory": "deepest-territory",
      "rare-knowledge": "rare-knowledge",
      turnaround: "turnaround",
      "deepest-cut": "deepest-cut",
      overlap: "overlap",
      "waiting-discovery": "waiting-discovery",
    };
    for (const [key, kind] of Object.entries(expected)) {
      const state = PREVIEW_STATES.find((s) => s.key === key)!;
      expect(resolvePreviewState(state)?.kind).toBe(kind);
    }
  });

  it("the sparse state resolves to the exact locked string", () => {
    const sparse = PREVIEW_STATES.find((s) => s.key === "sparse")!;
    expect(resolvePreviewState(sparse)).toEqual({
      kind: "sparse",
      label: "YOUR KNOWLEDGE MAP",
      artifact: "Your knowledge map starts filling in as you play.",
    });
  });

  it("the plain state resolves to null (no card)", () => {
    const plain = PREVIEW_STATES.find((s) => s.key === "plain")!;
    expect(resolvePreviewState(plain)).toBeNull();
  });
});
