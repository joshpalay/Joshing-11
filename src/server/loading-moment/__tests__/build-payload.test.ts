import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMasteryOverviewMock } = vi.hoisted(() => ({
  getUserMasteryOverviewMock: vi.fn(),
}));

vi.mock("@/server/db/queries/knowledge", () => ({
  getUserMasteryOverview: getUserMasteryOverviewMock,
}));

import { buildLoadingMomentPayload } from "../build-payload";

const NOW = 1_700_000_000_000;

type DomainOverrides = Partial<{
  displayName: string;
  points: number;
  questionsAnswered: number;
  isDemonstrated: boolean;
  isHidden: boolean;
}>;

function domain(overrides: DomainOverrides = {}) {
  return {
    domain: "italian-renaissance",
    displayName: "Italian Renaissance",
    points: 120,
    tier: "solid",
    tierProgress: 0.5,
    questionsAnswered: 8,
    questionsCorrect: 6,
    correctRate: 0.75,
    lastActivityAt: null,
    broadCategory: "Art",
    iconKey: "art",
    isDeclared: false,
    isDeclaredInterest: false,
    isDemonstrated: true,
    territoryType: "demonstrated" as const,
    isHidden: false,
    ...overrides,
  };
}

function overview(domains: ReturnType<typeof domain>[]) {
  return {
    totalPoints: 0,
    currentTier: "solid",
    tierProgress: 0,
    nextTier: null,
    pointsToNextTier: null,
    domains,
    recentActivity: [],
  };
}

describe("buildLoadingMomentPayload (C-2 truth gate)", () => {
  beforeEach(() => getUserMasteryOverviewMock.mockReset());

  it("populates deepest territory from the top qualifying domain", async () => {
    getUserMasteryOverviewMock.mockResolvedValue(
      overview([domain({ displayName: "Italian Renaissance" })]),
    );
    const payload = await buildLoadingMomentPayload("u1", NOW);
    expect(payload).toEqual({
      generatedAt: NOW,
      deepestTerritory: { subcategory: "Italian Renaissance" },
    });
  });

  it("skips domains that are not demonstrated, hidden, or below the question threshold", async () => {
    getUserMasteryOverviewMock.mockResolvedValue(
      overview([
        domain({ displayName: "Undemonstrated", isDemonstrated: false }),
        domain({ displayName: "Hidden", isHidden: true }),
        domain({ displayName: "Barely Touched", questionsAnswered: 2 }),
        domain({ displayName: "Real Territory", questionsAnswered: 5 }),
      ]),
    );
    const payload = await buildLoadingMomentPayload("u1", NOW);
    expect(payload.deepestTerritory).toEqual({ subcategory: "Real Territory" });
  });

  it("emits no card for a new user with no qualifying domain (→ selector sparse)", async () => {
    getUserMasteryOverviewMock.mockResolvedValue(overview([]));
    const payload = await buildLoadingMomentPayload("u1", NOW);
    expect(payload).toEqual({ generatedAt: NOW });
    expect(payload.deepestTerritory).toBeUndefined();
  });

  it("does not populate the deferred cards (turnaround/overlap/etc.)", async () => {
    getUserMasteryOverviewMock.mockResolvedValue(
      overview([domain({ displayName: "Italian Renaissance" })]),
    );
    const payload = await buildLoadingMomentPayload("u1", NOW);
    expect(payload.turnaround).toBeUndefined();
    expect(payload.overlap).toBeUndefined();
    expect(payload.deepestCut).toBeUndefined();
    expect(payload.waitingDiscovery).toBeUndefined();
    expect(payload.rareKnowledge).toBeUndefined();
  });
});
