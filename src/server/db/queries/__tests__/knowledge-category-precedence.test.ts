import { describe, expect, it } from 'vitest';

import { getKnowledgePageData, type KnowledgeInputs } from '@/server/db/queries/knowledge';

// QA 2026-10-01, S5: PLAYER_MASTERY.broad_category is copied from whichever
// question was last answered, so it drifts; the category on the player's own
// declared topic is the one their map should be filed under.
function inputs(
  mastery: Array<{ domain: string; category: string | null }>,
  declared: Array<{ domain: string; category: string | null }>,
): KnowledgeInputs {
  return {
    masteryRows: mastery.map((row) => ({
      canonicalSubcategory: row.domain,
      broadCategory: row.category,
      totalPoints: 100,
      tier: 'familiar',
    })),
    declaredRows: declared.map((row) => ({
      domain: row.domain,
      broadCategory: row.category,
      territoryType: 'declared',
    })),
    domainAggregates: [],
    recentEvents: [],
    hiddenDomainKeys: new Set<string>(),
    excludedDomainKeys: new Set<string>(),
  } as unknown as KnowledgeInputs;
}

async function categoryOf(data: KnowledgeInputs, domain: string) {
  const page = await getKnowledgePageData('user-1', data);
  return page.allDomains.find((d) => d.domain === domain)?.broadCategory;
}

describe('knowledge page category precedence', () => {
  it("files a declared topic under the player's own category, not the mastery row's catch-all", async () => {
    await expect(
      categoryOf(
        inputs(
          [{ domain: 'Renaissance Florence', category: 'General Knowledge' }],
          [{ domain: 'Renaissance Florence', category: 'History' }],
        ),
        'Renaissance Florence',
      ),
    ).resolves.toBe('History');
  });

  it("prefers the player's category over a different one copied from a question", async () => {
    await expect(
      categoryOf(
        inputs(
          [{ domain: 'Final Fantasy', category: 'Video Games' }],
          [{ domain: 'Final Fantasy', category: 'Pop Culture' }],
        ),
        'Final Fantasy',
      ),
    ).resolves.toBe('Pop Culture');
  });

  it('falls back to the mastery category when the declared one is a catch-all', async () => {
    await expect(
      categoryOf(
        inputs([{ domain: 'Bach', category: 'Music' }], [{ domain: 'Bach', category: 'General Knowledge' }]),
        'Bach',
      ),
    ).resolves.toBe('Music');
  });
});
