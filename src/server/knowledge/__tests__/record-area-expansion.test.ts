import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture what the (mocked) db insert receives, and let a test force the write to
// throw so we can prove the fail-soft contract.
const state = vi.hoisted(() => ({
  values: undefined as Record<string, unknown> | undefined,
  insertCalls: 0,
  shouldThrow: false,
}));

vi.mock('@/server/db', () => {
  const insertChain = () => {
    const c: Record<string, unknown> = {};
    c.values = (v: Record<string, unknown>) => {
      state.values = v;
      return c;
    };
    c.onConflictDoNothing = () =>
      state.shouldThrow ? Promise.reject(new Error('boom')) : Promise.resolve();
    return c;
  };
  return {
    db: {
      insert: () => {
        state.insertCalls += 1;
        return insertChain();
      },
    },
    masteryEvents: { answerId: 'masteryEvents.answerId' },
    playerMastery: {},
    questions: {},
    activityItems: {},
  };
});

import { recordAreaExpansion } from '@/server/knowledge/open-domain';

describe('recordAreaExpansion', () => {
  beforeEach(() => {
    state.values = undefined;
    state.insertCalls = 0;
    state.shouldThrow = false;
  });

  it('writes a zero-point expansion event on the target carrying expandedFrom', async () => {
    const result = await recordAreaExpansion({
      userId: 'u1',
      sourceDomain: 'Pride',
      targetDomain: 'Moral Philosophy',
    });

    expect(result).toEqual({ recorded: true });
    expect(state.values).toMatchObject({
      userId: 'u1',
      canonicalSubcategory: 'Moral Philosophy',
      sourceType: 'expansion',
      answerId: 'expansion:Pride:Moral Philosophy:u1',
      basePoints: 0,
      weight: 0,
      awardedPoints: 0,
      sessionContext: 'expansion',
      metadata: { expandedFrom: 'Pride' },
    });
  });

  it('fails soft (recorded:false, no throw) when the write errors', async () => {
    state.shouldThrow = true;
    await expect(
      recordAreaExpansion({ userId: 'u1', sourceDomain: 'Pride', targetDomain: 'Moral Philosophy' }),
    ).resolves.toEqual({ recorded: false });
  });

  it('is a no-op when an input is missing — never touches the db', async () => {
    expect(await recordAreaExpansion({ userId: 'u1', sourceDomain: '', targetDomain: 'X' })).toEqual({
      recorded: false,
    });
    expect(await recordAreaExpansion({ userId: '', sourceDomain: 'Pride', targetDomain: 'X' })).toEqual(
      { recorded: false },
    );
    expect(state.insertCalls).toBe(0);
  });
});
