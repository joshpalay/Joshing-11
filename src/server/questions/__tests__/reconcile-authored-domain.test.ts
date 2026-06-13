import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const convergeDomain = vi.fn();
const reconcileProposedDomain = vi.fn();

vi.mock('@/server/knowledge/converge-domain', () => ({
  convergeDomain: (...args: unknown[]) => convergeDomain(...args),
}));

vi.mock('@/lib/questions/categorization', () => ({
  reconcileProposedDomain: (...args: unknown[]) => reconcileProposedDomain(...args),
}));

import {
  isReconcileAuthoredDomainsEnabled,
  reconcileAuthoredDomain,
} from '@/server/questions/reconcile-authored-domain';

function convergeResult(candidates: Array<{ label: string; kind: string; similarity: number; broadCategory?: string | null }>) {
  return {
    raw: 'x',
    candidates: candidates.map((c) => ({ broadCategory: null, ...c })),
  };
}

describe('reconcileAuthoredDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convergeDomain.mockResolvedValue(convergeResult([{ label: 'Hamlet', kind: 'new', similarity: 0 }]));
    reconcileProposedDomain.mockResolvedValue({ canonicalDomain: 'Hamlet', reconciled: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adopts a trgm exact-key corpus match and never calls the LLM', async () => {
    convergeDomain.mockResolvedValue(
      convergeResult([
        { label: 'Shakespearean Tragedy', kind: 'exact', similarity: 1 },
        { label: 'Shakespeare Plays', kind: 'fuzzy', similarity: 0.6 },
      ]),
    );

    const outcome = await reconcileAuthoredDomain('shakespearean tragedy', 'user-1');

    expect(outcome.method).toBe('trgm-exact');
    expect(outcome.canonicalDomain).toBe('Shakespearean Tragedy');
    expect(outcome.reconciled).toBe(true);
    expect(outcome.differs).toBe(true);
    expect(outcome.trgmFuzzyCandidates).toEqual([{ label: 'Shakespeare Plays', similarity: 0.6 }]);
    // trgm-first means the LLM is skipped entirely on an exact hit.
    expect(reconcileProposedDomain).not.toHaveBeenCalled();
  });

  it('falls through to the Haiku semantic reconcile on a trgm-exact miss', async () => {
    convergeDomain.mockResolvedValue(
      convergeResult([{ label: 'The Bard’s Tragedies', kind: 'fuzzy', similarity: 0.5 }]),
    );
    reconcileProposedDomain.mockResolvedValue({ canonicalDomain: 'Shakespearean Tragedy', reconciled: true });

    const outcome = await reconcileAuthoredDomain('The Bard’s Tragedies', 'user-1');

    expect(reconcileProposedDomain).toHaveBeenCalledWith('The Bard’s Tragedies', 'user-1');
    expect(outcome.method).toBe('llm');
    expect(outcome.canonicalDomain).toBe('Shakespearean Tragedy');
    expect(outcome.differs).toBe(true);
    expect(outcome.llmReconciled).toBe(true);
    // fuzzy candidate is surfaced for telemetry but was NOT auto-applied.
    expect(outcome.trgmFuzzyCandidates).toEqual([{ label: 'The Bard’s Tragedies', similarity: 0.5 }]);
  });

  it('reports no fold when neither pass matches', async () => {
    const outcome = await reconcileAuthoredDomain('Hamlet', 'user-1');
    expect(outcome.method).toBe('none');
    expect(outcome.differs).toBe(false);
    expect(outcome.canonicalDomain).toBe('Hamlet');
  });

  it('adopts the LLM per-user exact-casing fold even when reconciled=false', async () => {
    reconcileProposedDomain.mockResolvedValue({ canonicalDomain: 'Hamlet', reconciled: false });
    const outcome = await reconcileAuthoredDomain('HAMLET', 'user-1');
    expect(outcome.differs).toBe(true);
    expect(outcome.canonicalDomain).toBe('Hamlet');
    expect(outcome.method).toBe('llm');
  });

  it('degrades to the proposal when convergeDomain throws', async () => {
    convergeDomain.mockRejectedValue(new Error('pg_trgm down'));
    reconcileProposedDomain.mockResolvedValue({ canonicalDomain: 'Hamlet', reconciled: false });
    const outcome = await reconcileAuthoredDomain('Hamlet', 'user-1');
    expect(outcome.canonicalDomain).toBe('Hamlet');
    expect(outcome.method).toBe('none');
  });

  it('reads the RECONCILE_AUTHORED_DOMAINS flag with the repo boolean convention', () => {
    vi.stubEnv('RECONCILE_AUTHORED_DOMAINS', '');
    expect(isReconcileAuthoredDomainsEnabled()).toBe(false);
    for (const truthy of ['true', '1', 'yes', 'on', 'TRUE']) {
      vi.stubEnv('RECONCILE_AUTHORED_DOMAINS', truthy);
      expect(isReconcileAuthoredDomainsEnabled()).toBe(true);
    }
    vi.stubEnv('RECONCILE_AUTHORED_DOMAINS', 'false');
    expect(isReconcileAuthoredDomainsEnabled()).toBe(false);
  });
});
