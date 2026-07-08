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
  state: {
    answeredRows: [] as Array<{ domain: string; answered: number }>,
    // Distinct (label, question) pairs for the graph roll-up numerator.
    pairRows: [] as Array<{ label: string; questionId: string | null }>,
    graph: {
      nodeKeys: [] as string[],
      edges: [] as Array<{ parentDomainKey: string; childDomainKey: string }>,
    },
  },
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
  const distinctChain = {
    from: () => distinctChain,
    where: () => Promise.resolve(state.pairRows),
  };
  return {
    db: { select: () => dbChain, selectDistinct: () => distinctChain },
    masteryEvents: { canonicalSubcategory: 'cs', answeredByUserId: 'a', questionId: 'q' },
  };
});
// Graph context for the D-MASTERY-FINEST-NODE-01 §3/P4 subtree roll-up; the
// default (empty) graph keeps every pre-existing test on the exact-label path.
vi.mock('@/server/knowledge/graph', () => ({
  getClusterContext: async () => ({
    nodeKeys: new Set(state.graph.nodeKeys),
    labelByKey: new Map(state.graph.nodeKeys.map((key: string) => [key, key])),
    edges: state.graph.edges,
  }),
  substantiveDescendants: (
    nodeKey: string,
    edges: readonly { parentDomainKey: string; childDomainKey: string }[],
  ) => {
    const out = new Set<string>();
    const stack = [nodeKey];
    while (stack.length > 0) {
      const key = stack.pop()!;
      for (const edge of edges) {
        if (edge.parentDomainKey === key && !out.has(edge.childDomainKey)) {
          out.add(edge.childDomainKey);
          stack.push(edge.childDomainKey);
        }
      }
    }
    return out;
  },
}));
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
    state.pairRows = [];
    state.graph = { nodeKeys: [], edges: [] };
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

  it('a parent completes on SUBTREE coverage (D-MASTERY-FINEST-NODE-01 §3/P4)', async () => {
    // "Complete Shakespearean Tragedies" = breadth across the plays. The
    // exact-label count alone (5) is below the candidate gate; the distinct
    // questions answered across the substantive subtree (17) both clear the
    // gate and cover the subtree-union-sized target.
    state.graph = {
      nodeKeys: ['shakespearean tragedies', 'hamlet', 'king lear'],
      edges: [
        { parentDomainKey: 'shakespearean tragedies', childDomainKey: 'hamlet' },
        { parentDomainKey: 'shakespearean tragedies', childDomainKey: 'king lear' },
      ],
    };
    state.answeredRows = [{ domain: 'Shakespearean Tragedies', answered: 5 }];
    state.pairRows = [
      ...Array.from({ length: 5 }, (_, i) => ({ label: 'Shakespearean Tragedies', questionId: `t${i}` })),
      ...Array.from({ length: 7 }, (_, i) => ({ label: 'Hamlet', questionId: `h${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ label: 'King Lear', questionId: `l${i}` })),
    ];
    getTargetQuestionCountForDomains.mockResolvedValue(
      new Map([['Shakespearean Tragedies', 17]]),
    );

    const completed = await evaluateSetCompletions('u1', ['Shakespearean Tragedies']);

    expect(completed).toEqual(['Shakespearean Tragedies']);
    expect(markDomainDesignated).toHaveBeenCalledWith(
      'u1',
      'Shakespearean Tragedies',
      expect.any(Date),
    );
  });

  it('answers outside the subtree never count toward a parent', async () => {
    state.graph = {
      nodeKeys: ['shakespearean tragedies', 'hamlet'],
      edges: [{ parentDomainKey: 'shakespearean tragedies', childDomainKey: 'hamlet' }],
    };
    state.answeredRows = [{ domain: 'Shakespearean Tragedies', answered: 12 }];
    state.pairRows = [
      ...Array.from({ length: 12 }, (_, i) => ({ label: 'Shakespearean Tragedies', questionId: `t${i}` })),
      // Unrelated domain — must not inflate the parent's coverage.
      ...Array.from({ length: 10 }, (_, i) => ({ label: 'Star Wars', questionId: `s${i}` })),
    ];
    getTargetQuestionCountForDomains.mockResolvedValue(
      new Map([['Shakespearean Tragedies', 20]]),
    );

    expect(await evaluateSetCompletions('u1', ['Shakespearean Tragedies'])).toEqual([]);
  });
});
