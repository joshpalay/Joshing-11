import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ db: {}, masteryEvents: {}, playerMastery: {} }));
vi.mock('@/server/db/queries/knowledge-graph', () => ({
  getCanonicalQuestionDomain: vi.fn(),
  isGraphAncestor: vi.fn(),
}));
vi.mock('@/server/activity/invite-onboarding', () => ({ maybeNotifyInviterOfFirstFive: vi.fn() }));
vi.mock('@/server/db/queries/trust-promotion', () => ({ evaluateQuestionTrustOnPlay: vi.fn() }));

import { resolveCreditDomain, type CreditDomainDeps } from '@/server/mastery/write-mastery-event';

// "shakespearean tragedy" > "hamlet"; "literature" > "shakespearean tragedy".
const EDGES: Record<string, string[]> = {
  hamlet: ['shakespearean tragedy'],
  'shakespearean tragedy': ['literature'],
};

function deps(questionDomain: string | null): CreditDomainDeps {
  return {
    getQuestionDomain: async () => questionDomain,
    isAncestor: async (childKey, ancestorKey) => {
      const seen = new Set<string>();
      const queue = [...(EDGES[childKey] ?? [])];
      while (queue.length) {
        const next = queue.pop()!;
        if (next === ancestorKey) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(...(EDGES[next] ?? []));
      }
      return false;
    },
  };
}

describe('resolveCreditDomain', () => {
  it('credits the finer area when the question is filed under a child of the served domain', async () => {
    await expect(resolveCreditDomain('Shakespearean Tragedy', 'q1', deps('Hamlet'))).resolves.toBe('Hamlet');
  });

  it('follows the graph transitively', async () => {
    await expect(resolveCreditDomain('Literature', 'q1', deps('Hamlet'))).resolves.toBe('Hamlet');
  });

  it('keeps the served domain when the question is filed at the same area', async () => {
    await expect(resolveCreditDomain('Hamlet', 'q1', deps('hamlet'))).resolves.toBe('Hamlet');
  });

  it('keeps the served domain for an unrelated re-file (never a sideways move)', async () => {
    await expect(resolveCreditDomain('Shakespearean Tragedy', 'q1', deps('Opera'))).resolves.toBe(
      'Shakespearean Tragedy',
    );
  });

  it('never credits a coarser area than the one served', async () => {
    await expect(resolveCreditDomain('Hamlet', 'q1', deps('Shakespearean Tragedy'))).resolves.toBe('Hamlet');
  });

  it('keeps the served domain with no canonical question or no label', async () => {
    await expect(resolveCreditDomain('Shakespearean Tragedy', null, deps('Hamlet'))).resolves.toBe(
      'Shakespearean Tragedy',
    );
    await expect(resolveCreditDomain('Shakespearean Tragedy', 'q1', deps(null))).resolves.toBe(
      'Shakespearean Tragedy',
    );
  });

  it('fails open on a lookup fault', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: CreditDomainDeps = {
      getQuestionDomain: async () => {
        throw new Error('db down');
      },
      isAncestor: async () => true,
    };
    await expect(resolveCreditDomain('Shakespearean Tragedy', 'q1', failing)).resolves.toBe(
      'Shakespearean Tragedy',
    );
    warn.mockRestore();
  });
});
