import { beforeEach, describe, expect, it, vi } from 'vitest';

// Distinct-answered comes from a db.select().from().where().groupBy() chain; the
// pool depth + designation/invite writes are separate query modules. Mock all
// three (via vi.hoisted, since vi.mock factories are hoisted above the file) so
// the evaluator's orchestration is testable without a live DB.
const {
  state,
  getDurablePoolDepthForDomains,
  getTargetQuestionCountForDomains,
  hasDesignation,
  markDomainDesignated,
  inviteToAuthorAutomatic,
  markDomainExpansionEligible,
} = vi.hoisted(() => ({
  state: { answeredRows: [] as Array<{ domain: string; answered: number }> },
  getDurablePoolDepthForDomains: vi.fn(),
  getTargetQuestionCountForDomains: vi.fn(),
  hasDesignation: vi.fn(),
  markDomainDesignated: vi.fn(),
  inviteToAuthorAutomatic: vi.fn(),
  markDomainExpansionEligible: vi.fn(),
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
// Depth sizing is the default completion size source; mock it (minPossibleTargetCount
// is the candidate gate floor).
vi.mock('@/server/daily/domain-size', () => ({
  getTargetQuestionCountForDomains,
  minPossibleTargetCount: () => 12,
}));
vi.mock('@/server/db/queries/author-invitations', () => ({
  hasDesignation,
  markDomainDesignated,
  inviteToAuthorAutomatic,
}));
vi.mock('@/server/adaptive-difficulty', () => ({ markDomainExpansionEligible }));

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
    getTargetQuestionCountForDomains.mockResolvedValue(new Map());
    inviteToAuthorAutomatic.mockResolvedValue({ ok: true, action: 'invited' });
    markDomainExpansionEligible.mockResolvedValue(undefined);
  });

  it('designates + invites a domain whose depth-sized set the player just covered', async () => {
    // Spy School depth-sized target = 18; the player has answered 18 distinct.
    state.answeredRows = [{ domain: 'Spy School', answered: 18 }];
    getTargetQuestionCountForDomains.mockResolvedValue(new Map([['Spy School', 18]]));

    const completed = await evaluateSetCompletions('u1', ['Spy School']);

    expect(completed).toEqual(['Spy School']);
    expect(markDomainDesignated).toHaveBeenCalledWith('u1', 'Spy School', expect.any(Date));
    expect(inviteToAuthorAutomatic).toHaveBeenCalledWith({ userId: 'u1', domain: 'Spy School' });
    // Phase 1b: completing the set makes the domain eligible for the graduation offer.
    expect(markDomainExpansionEligible).toHaveBeenCalledWith('u1', 'Spy School');
  });

  it('does not even size a domain below the candidate gate floor', async () => {
    state.answeredRows = [{ domain: 'Tiny Topic', answered: 4 }];

    const completed = await evaluateSetCompletions('u1', ['Tiny Topic']);

    expect(completed).toEqual([]);
    // Below the gate (12) → never pays the depth sizing call.
    expect(getTargetQuestionCountForDomains).not.toHaveBeenCalled();
    expect(markDomainDesignated).not.toHaveBeenCalled();
  });

  it('does not designate a deep topic still short of its (large) target', async () => {
    // Star Wars depth-sized target = 128; 40 distinct answered → long runway left.
    state.answeredRows = [{ domain: 'Star Wars', answered: 40 }];
    getTargetQuestionCountForDomains.mockResolvedValue(new Map([['Star Wars', 128]]));

    expect(await evaluateSetCompletions('u1', ['Star Wars'])).toEqual([]);
    expect(inviteToAuthorAutomatic).not.toHaveBeenCalled();
  });

  it('is idempotent — already-designated domains are skipped without writes', async () => {
    state.answeredRows = [{ domain: 'Spy School', answered: 18 }];
    getTargetQuestionCountForDomains.mockResolvedValue(new Map([['Spy School', 18]]));
    hasDesignation.mockResolvedValue(true);

    const completed = await evaluateSetCompletions('u1', ['Spy School']);

    expect(completed).toEqual([]);
    expect(markDomainDesignated).not.toHaveBeenCalled();
    expect(inviteToAuthorAutomatic).not.toHaveBeenCalled();
  });

  it('falls back to pool depth when depth sizing faults (never blocks the trophy)', async () => {
    // A sizing outage must not silently stop every completion from firing.
    state.answeredRows = [{ domain: 'Spy School', answered: 18 }];
    getTargetQuestionCountForDomains.mockRejectedValue(new Error('haiku down'));
    getDurablePoolDepthForDomains.mockResolvedValue(new Map([['Spy School', 15]]));

    const completed = await evaluateSetCompletions('u1', ['Spy School']);

    expect(completed).toEqual(['Spy School']); // 18 >= pool depth 15
    expect(getDurablePoolDepthForDomains).toHaveBeenCalled();
  });

  it('never throws — a query fault returns no completions', async () => {
    getTargetQuestionCountForDomains.mockRejectedValue(new Error('down'));
    getDurablePoolDepthForDomains.mockRejectedValue(new Error('db down'));
    state.answeredRows = [{ domain: 'Spy School', answered: 18 }];
    expect(await evaluateSetCompletions('u1', ['Spy School'])).toEqual([]);
  });

  it('returns early for an empty domain list (no queries)', async () => {
    expect(await evaluateSetCompletions('u1', [])).toEqual([]);
    expect(getTargetQuestionCountForDomains).not.toHaveBeenCalled();
  });
});
