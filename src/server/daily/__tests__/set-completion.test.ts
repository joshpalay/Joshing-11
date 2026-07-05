import { beforeEach, describe, expect, it, vi } from 'vitest';

// Distinct-answered comes from a db.select().from().where().groupBy() chain; the
// pool depth + designation/invite writes are separate query modules. Mock all
// three (via vi.hoisted, since vi.mock factories are hoisted above the file) so
// the evaluator's orchestration is testable without a live DB.
const {
  state,
  getDurablePoolDepthForDomains,
  hasDesignation,
  markDomainDesignated,
  inviteToAuthorAutomatic,
} = vi.hoisted(() => ({
  state: { answeredRows: [] as Array<{ domain: string; answered: number }> },
  getDurablePoolDepthForDomains: vi.fn(),
  hasDesignation: vi.fn(),
  markDomainDesignated: vi.fn(),
  inviteToAuthorAutomatic: vi.fn(),
}));

vi.mock('@/server/db', () => {
  const dbChain = {
    from: () => dbChain,
    where: () => dbChain,
    groupBy: () => Promise.resolve(state.answeredRows),
  };
  return {
    db: { select: () => dbChain },
    masteryEvents: { canonicalSubcategory: 'cs', answeredByUserId: 'a', questionId: 'q' },
  };
});
vi.mock('@/server/db/queries/retrieval-demand', () => ({ getDurablePoolDepthForDomains }));
vi.mock('@/server/db/queries/author-invitations', () => ({
  hasDesignation,
  markDomainDesignated,
  inviteToAuthorAutomatic,
}));

import {
  evaluateSetCompletions,
  isSetComplete,
  SET_COMPLETION_MIN_SIZE,
} from '@/server/daily/set-completion';

describe('isSetComplete', () => {
  it('is false below the floor even when fully answered', () => {
    expect(isSetComplete({ distinctAnswered: 5, setSize: 5 })).toBe(false); // 5 < floor 8
  });

  it('is false when the set is big enough but not fully covered', () => {
    expect(isSetComplete({ distinctAnswered: 9, setSize: 12 })).toBe(false);
  });

  it('is true at the floor when fully answered', () => {
    expect(isSetComplete({ distinctAnswered: 8, setSize: 8 })).toBe(true);
  });

  it('is true when answered exceeds the set (over-coverage still completes)', () => {
    expect(isSetComplete({ distinctAnswered: 20, setSize: 12 })).toBe(true);
  });

  it('honors an override floor', () => {
    expect(isSetComplete({ distinctAnswered: 3, setSize: 3, minSize: 3 })).toBe(true);
  });

  it('exports the documented floor', () => {
    expect(SET_COMPLETION_MIN_SIZE).toBe(8);
  });
});

describe('evaluateSetCompletions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.answeredRows = [];
    hasDesignation.mockResolvedValue(false);
    getDurablePoolDepthForDomains.mockResolvedValue(new Map());
    inviteToAuthorAutomatic.mockResolvedValue({ ok: true, action: 'invited' });
  });

  it('designates + invites a domain the player just completed', async () => {
    state.answeredRows = [{ domain: 'Spy School', answered: 12 }];
    getDurablePoolDepthForDomains.mockResolvedValue(new Map([['Spy School', 10]]));

    const completed = await evaluateSetCompletions('u1', ['Spy School']);

    expect(completed).toEqual(['Spy School']);
    expect(markDomainDesignated).toHaveBeenCalledWith('u1', 'Spy School', expect.any(Date));
    expect(inviteToAuthorAutomatic).toHaveBeenCalledWith({ userId: 'u1', domain: 'Spy School' });
  });

  it('does not designate a below-floor domain', async () => {
    state.answeredRows = [{ domain: 'Tiny Topic', answered: 4 }];
    getDurablePoolDepthForDomains.mockResolvedValue(new Map([['Tiny Topic', 4]]));

    const completed = await evaluateSetCompletions('u1', ['Tiny Topic']);

    expect(completed).toEqual([]);
    expect(markDomainDesignated).not.toHaveBeenCalled();
    expect(inviteToAuthorAutomatic).not.toHaveBeenCalled();
  });

  it('does not designate a not-yet-covered domain', async () => {
    state.answeredRows = [{ domain: 'Big Topic', answered: 9 }];
    getDurablePoolDepthForDomains.mockResolvedValue(new Map([['Big Topic', 30]]));

    expect(await evaluateSetCompletions('u1', ['Big Topic'])).toEqual([]);
    expect(inviteToAuthorAutomatic).not.toHaveBeenCalled();
  });

  it('is idempotent — already-designated domains are skipped without writes', async () => {
    state.answeredRows = [{ domain: 'Spy School', answered: 12 }];
    getDurablePoolDepthForDomains.mockResolvedValue(new Map([['Spy School', 10]]));
    hasDesignation.mockResolvedValue(true);

    const completed = await evaluateSetCompletions('u1', ['Spy School']);

    expect(completed).toEqual([]);
    expect(markDomainDesignated).not.toHaveBeenCalled();
    expect(inviteToAuthorAutomatic).not.toHaveBeenCalled();
  });

  it('never throws — a query fault returns no completions', async () => {
    getDurablePoolDepthForDomains.mockRejectedValue(new Error('db down'));
    state.answeredRows = [{ domain: 'Spy School', answered: 12 }];
    expect(await evaluateSetCompletions('u1', ['Spy School'])).toEqual([]);
  });

  it('returns early for an empty domain list (no queries)', async () => {
    expect(await evaluateSetCompletions('u1', [])).toEqual([]);
    expect(getDurablePoolDepthForDomains).not.toHaveBeenCalled();
  });
});
