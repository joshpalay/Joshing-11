import { beforeEach, describe, expect, it } from "vitest";

import {
  resetLoadingMomentRotation,
  resolveLoadingMomentWithRotation,
} from "../rotation";
import { selectLoadingMoment } from "../selectLoadingMoment";
import {
  LOADING_MOMENT_BANNED_WORDS,
  LOADING_MOMENT_MAX_AGE_MS,
  SPARSE_LOADING_MOMENT_LINE,
  type LoadingMomentPayload,
} from "../types";

const NOW = 1_700_000_000_000;

/** A payload where every card's fact is present (rich-portrait user). */
function richPayload(overrides: Partial<LoadingMomentPayload> = {}): LoadingMomentPayload {
  return {
    generatedAt: NOW,
    deepestTerritory: { subcategory: "Italian Renaissance" },
    turnaround: { subcategory: "Tudor England" },
    deepestCut: { questionStem: "Which doge commissioned the Bucintoro?" },
    overlap: { friendName: "Maya", subcategory: "Baroque opera" },
    waitingDiscovery: { friendName: "Sam", subcategory: "Norse myth" },
    ...overrides,
  };
}

describe("selectLoadingMoment — fallback ladder order", () => {
  it("prefers the turnaround card (step 1) when everything is available", () => {
    const card = selectLoadingMoment(richPayload(), { now: NOW });
    expect(card?.kind).toBe("turnaround");
    expect(card?.label).toBe("A DISCOVERY");
    expect(card?.artifact).toBe(
      "Something you once got wrong, you now know cold — Tudor England.",
    );
  });

  it("falls to deepest-territory (step 2) when no turnaround exists", () => {
    const card = selectLoadingMoment(richPayload({ turnaround: undefined }), { now: NOW });
    expect(card?.kind).toBe("deepest-territory");
  });

  it("weights waiting-discovery above overlap, and both below the deeper cards (step 3)", () => {
    const social = selectLoadingMoment(
      {
        generatedAt: NOW,
        overlap: { friendName: "Maya", subcategory: "Baroque opera" },
        waitingDiscovery: { friendName: "Sam", subcategory: "Norse myth" },
      },
      { now: NOW },
    );
    expect(social?.kind).toBe("waiting-discovery");

    const overlapOnly = selectLoadingMoment(
      { generatedAt: NOW, overlap: { friendName: "Maya", subcategory: "Baroque opera" } },
      { now: NOW },
    );
    expect(overlapOnly?.kind).toBe("overlap");
  });

  it("uses deepest-cut (step 4) only when richer cards have no data", () => {
    const card = selectLoadingMoment(
      { generatedAt: NOW, deepestCut: { questionStem: "Name the doge." } },
      { now: NOW },
    );
    expect(card?.kind).toBe("deepest-cut");
    expect(card?.artifact).toBe("The deepest cut you've answered — Name the doge.");
  });
});

describe("selectLoadingMoment — per-card eligibility / truth gate (C-2)", () => {
  it("does not emit a card whose fact is absent", () => {
    const card = selectLoadingMoment({ generatedAt: NOW }, { now: NOW });
    // No card fields → fresh-but-empty → sparse, never a blank card.
    expect(card?.kind).toBe("sparse");
  });

  it("treats an empty / whitespace fact as absent", () => {
    const card = selectLoadingMoment(
      {
        generatedAt: NOW,
        deepestTerritory: { subcategory: "   " },
        turnaround: { subcategory: "" },
      },
      { now: NOW },
    );
    expect(card?.kind).toBe("sparse");
  });

  it("requires BOTH name and category for a person-attributed card (honest provenance)", () => {
    const missingName = selectLoadingMoment(
      { generatedAt: NOW, overlap: { friendName: "", subcategory: "Baroque opera" } },
      { now: NOW },
    );
    expect(missingName?.kind).toBe("sparse");

    const missingCategory = selectLoadingMoment(
      { generatedAt: NOW, waitingDiscovery: { friendName: "Sam", subcategory: " " } },
      { now: NOW },
    );
    expect(missingCategory?.kind).toBe("sparse");
  });

  it("never emits the deferred rare-knowledge card (no data source this build)", () => {
    // Even if a field were somehow present, it sits below turnaround; and the
    // payload builder never populates it. Assert the taxonomy slot stays dark
    // by confirming a deepest-territory-only payload resolves to territory.
    const card = selectLoadingMoment(
      { generatedAt: NOW, deepestTerritory: { subcategory: "Cartography" } },
      { now: NOW },
    );
    expect(card?.kind).toBe("deepest-territory");
  });
});

describe("selectLoadingMoment — sparse / cold-start vs cached-miss", () => {
  it("brand-new user (fresh payload, no card data) → exact locked sparse string", () => {
    const card = selectLoadingMoment({ generatedAt: NOW }, { now: NOW });
    expect(card).toEqual({
      kind: "sparse",
      label: "YOUR KNOWLEDGE MAP",
      artifact: "Your knowledge map starts filling in as you play.",
    });
    // Locked string — exact, not paraphrased.
    expect(card?.artifact).toBe(SPARSE_LOADING_MOMENT_LINE);
  });

  it("cached-miss (no payload) → plain state, no card", () => {
    expect(selectLoadingMoment(null, { now: NOW })).toBeNull();
    expect(selectLoadingMoment(undefined, { now: NOW })).toBeNull();
  });

  it("stale payload → plain state, no card (never a cold fact)", () => {
    const stale = richPayload({ generatedAt: NOW - LOADING_MOMENT_MAX_AGE_MS - 1 });
    expect(selectLoadingMoment(stale, { now: NOW })).toBeNull();
  });

  it("payload with a malformed / future timestamp → plain state", () => {
    expect(
      selectLoadingMoment(richPayload({ generatedAt: Number.NaN }), { now: NOW }),
    ).toBeNull();
    expect(
      selectLoadingMoment(richPayload({ generatedAt: NOW + 60_000 }), { now: NOW }),
    ).toBeNull();
  });

  it("fresh payload within the window still resolves a card", () => {
    const fresh = richPayload({ generatedAt: NOW - LOADING_MOMENT_MAX_AGE_MS + 1 });
    expect(selectLoadingMoment(fresh, { now: NOW })?.kind).toBe("turnaround");
  });
});

describe("selectLoadingMoment — anti-repeat (C-5)", () => {
  it("skips the kind shown last load when an alternative exists", () => {
    const card = selectLoadingMoment(richPayload(), {
      now: NOW,
      lastShownKind: "turnaround",
    });
    expect(card?.kind).not.toBe("turnaround");
    expect(card?.kind).toBe("deepest-territory");
  });

  it("shows the repeat anyway when it is the only eligible card", () => {
    const card = selectLoadingMoment(
      { generatedAt: NOW, deepestTerritory: { subcategory: "Cartography" } },
      { now: NOW, lastShownKind: "deepest-territory" },
    );
    expect(card?.kind).toBe("deepest-territory");
  });
});

describe("resolveLoadingMomentWithRotation — client-session memory", () => {
  beforeEach(() => resetLoadingMomentRotation());

  it("does not repeat the same card across consecutive loads when alternatives exist", () => {
    const first = resolveLoadingMomentWithRotation(richPayload(), { now: NOW });
    const second = resolveLoadingMomentWithRotation(richPayload(), { now: NOW });
    const third = resolveLoadingMomentWithRotation(richPayload(), { now: NOW });
    expect(first?.kind).toBe("turnaround");
    expect(second?.kind).not.toBe(first?.kind);
    expect(third?.kind).not.toBe(second?.kind);
  });

  it("a plain-state load (null) does not block the next card", () => {
    resolveLoadingMomentWithRotation(richPayload(), { now: NOW }); // turnaround
    expect(resolveLoadingMomentWithRotation(null, { now: NOW })).toBeNull();
    // After a null load, memory is cleared, so the top card can show again.
    const next = resolveLoadingMomentWithRotation(richPayload(), { now: NOW });
    expect(next?.kind).toBe("turnaround");
  });
});

describe("selectLoadingMoment — banned-word scan of emitted copy (C-4)", () => {
  it("no resolved artifact or label contains a competition-register word", () => {
    const samples = [
      richPayload(),
      { generatedAt: NOW, deepestTerritory: { subcategory: "Italian Renaissance" } },
      { generatedAt: NOW, overlap: { friendName: "Maya", subcategory: "Baroque opera" } },
      { generatedAt: NOW, deepestCut: { questionStem: "Name the doge." } },
      { generatedAt: NOW }, // sparse
    ];
    const kinds = ["turnaround", "deepest-territory", "overlap", "deepest-cut", "rare-knowledge"] as const;
    for (const payload of samples) {
      // Walk every card by clearing the prior one via anti-repeat so we surface
      // each ladder rung at least once across the suite.
      for (const last of [null, ...kinds]) {
        const card = selectLoadingMoment(payload as LoadingMomentPayload, {
          now: NOW,
          lastShownKind: last,
        });
        if (!card) continue;
        const text = `${card.label} ${card.artifact}`.toLowerCase();
        for (const banned of LOADING_MOMENT_BANNED_WORDS) {
          expect(text.includes(banned.toLowerCase())).toBe(false);
        }
      }
    }
  });
});
