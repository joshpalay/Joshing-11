import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<{ parent: string; metadata: unknown }>,
  selectCalls: 0,
}));

vi.mock('@/server/db', () => {
  const selectChain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => Promise.resolve(state.rows);
    return c;
  };
  return {
    db: {
      select: () => {
        state.selectCalls += 1;
        return selectChain();
      },
    },
    masteryEvents: {
      userId: 'm.userId',
      sourceType: 'm.sourceType',
      canonicalSubcategory: 'm.canonicalSubcategory',
      metadata: 'm.metadata',
      createdAt: 'm.createdAt',
    },
    playerMastery: {},
    questions: {},
    activityItems: {},
  };
});

import { getExpansionParents } from '@/server/knowledge/open-domain';

describe('getExpansionParents', () => {
  beforeEach(() => {
    state.rows = [];
    state.selectCalls = 0;
  });

  it('maps each wanted child to its parent, ignoring unrelated expansions', async () => {
    state.rows = [
      { parent: 'Moral Philosophy', metadata: { expandedFrom: 'Pride' } },
      { parent: 'The Norman Conquest', metadata: { expandedFrom: 'The Battle of Hastings' } },
    ];
    const map = await getExpansionParents('u1', ['Pride']);
    expect([...map.entries()]).toEqual([['Pride', 'Moral Philosophy']]);
  });

  it('takes the most recent expansion when a child was expanded more than once', async () => {
    // Mock returns rows already ordered created_at DESC (newest first).
    state.rows = [
      { parent: "Dante's Inferno", metadata: { expandedFrom: 'Pride' } },
      { parent: 'Moral Philosophy', metadata: { expandedFrom: 'Pride' } },
    ];
    const map = await getExpansionParents('u1', ['Pride']);
    expect(map.get('Pride')).toBe("Dante's Inferno");
  });

  it('ignores rows whose metadata has no string expandedFrom', async () => {
    state.rows = [
      { parent: 'Moral Philosophy', metadata: null },
      { parent: 'Something', metadata: { expandedFrom: 42 } },
    ];
    const map = await getExpansionParents('u1', ['Pride']);
    expect(map.size).toBe(0);
  });

  it('short-circuits on empty input without touching the db', async () => {
    const map = await getExpansionParents('u1', []);
    expect(map.size).toBe(0);
    expect(state.selectCalls).toBe(0);
  });
});
