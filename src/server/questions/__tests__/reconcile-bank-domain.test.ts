import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reconcileProposedDomain = vi.fn();
const getDeepGlobalDomains = vi.fn();

vi.mock('@/lib/questions/categorization', () => ({
  reconcileProposedDomain: (...args: unknown[]) => reconcileProposedDomain(...args),
}));

vi.mock('@/server/db/queries/knowledge', () => ({
  getDeepGlobalDomains: (...args: unknown[]) => getDeepGlobalDomains(...args),
}));

import {
  getBankLabelIndex,
  isReconcileBankDomainsEnabled,
  reconcileBankDomain,
} from '@/server/questions/reconcile-bank-domain';

describe('reconcileBankDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileProposedDomain.mockResolvedValue({ canonicalDomain: 'Hamlet', reconciled: false });
    getDeepGlobalDomains.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hands the corpus label index to the reconcile as additionalDomains', async () => {
    getDeepGlobalDomains.mockResolvedValue([
      { domain: 'Renaissance & Medieval Polyphony', depth: 1 },
      { domain: 'Renaissance Florence', depth: 9 },
    ]);
    reconcileProposedDomain.mockResolvedValue({
      canonicalDomain: 'Renaissance & Medieval Polyphony',
      reconciled: true,
    });

    const outcome = await reconcileBankDomain('Renaissance Polyphony & Imitation', 'user-1');

    expect(getDeepGlobalDomains).toHaveBeenCalledWith(1, 400);
    expect(reconcileProposedDomain).toHaveBeenCalledWith(
      'Renaissance Polyphony & Imitation',
      'user-1',
      { additionalDomains: ['Renaissance & Medieval Polyphony', 'Renaissance Florence'] },
    );
    expect(outcome.canonicalDomain).toBe('Renaissance & Medieval Polyphony');
    expect(outcome.reconciled).toBe(true);
    expect(outcome.method).toBe('llm');
  });

  it('reuses a caller-provided label index without refetching', async () => {
    await reconcileBankDomain('Hamlet', 'user-1', {
      labelIndex: [{ domain: 'Hamlet', depth: 12 }],
    });
    expect(getDeepGlobalDomains).not.toHaveBeenCalled();
    expect(reconcileProposedDomain).toHaveBeenCalledWith('Hamlet', 'user-1', {
      additionalDomains: ['Hamlet'],
    });
  });

  it("reports a key-exact fold when the helper folds without a semantic reconcile", async () => {
    // reconciled=false + a different spelling is the helper's deterministic
    // domainKey short-circuit adopting an existing corpus spelling.
    reconcileProposedDomain.mockResolvedValue({
      canonicalDomain: 'Star Trek: TNG',
      reconciled: false,
    });
    const outcome = await reconcileBankDomain('Star Trek – TNG', 'user-1');
    expect(outcome.canonicalDomain).toBe('Star Trek: TNG');
    expect(outcome.reconciled).toBe(true);
    expect(outcome.method).toBe('key-exact');
  });

  it('reports no fold when the proposal survives unchanged', async () => {
    const outcome = await reconcileBankDomain('Hamlet', 'user-1');
    expect(outcome.canonicalDomain).toBe('Hamlet');
    expect(outcome.reconciled).toBe(false);
    expect(outcome.method).toBe('none');
  });

  it('degrades to an empty candidate list when the label index query throws', async () => {
    getDeepGlobalDomains.mockRejectedValue(new Error('db down'));
    const outcome = await reconcileBankDomain('Hamlet', 'user-1');
    expect(reconcileProposedDomain).toHaveBeenCalledWith('Hamlet', 'user-1', {
      additionalDomains: [],
    });
    expect(outcome.canonicalDomain).toBe('Hamlet');
  });

  it('reverts to the legacy player-KB-only reconcile when the kill switch is off', async () => {
    vi.stubEnv('RECONCILE_BANK_DOMAINS', 'off');
    await reconcileBankDomain('Hamlet', 'user-1');
    expect(getDeepGlobalDomains).not.toHaveBeenCalled();
    expect(reconcileProposedDomain).toHaveBeenCalledWith('Hamlet', 'user-1');
  });

  it('defaults the RECONCILE_BANK_DOMAINS flag ON, with falsy values as the kill switch', () => {
    vi.stubEnv('RECONCILE_BANK_DOMAINS', '');
    expect(isReconcileBankDomainsEnabled()).toBe(true);
    for (const truthy of ['true', '1', 'yes', 'on', 'anything-else']) {
      vi.stubEnv('RECONCILE_BANK_DOMAINS', truthy);
      expect(isReconcileBankDomainsEnabled()).toBe(true);
    }
    for (const falsy of ['false', '0', 'no', 'off', 'OFF']) {
      vi.stubEnv('RECONCILE_BANK_DOMAINS', falsy);
      expect(isReconcileBankDomainsEnabled()).toBe(false);
    }
  });
});

describe('getBankLabelIndex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the full-depth index and fails open to empty', async () => {
    getDeepGlobalDomains.mockResolvedValue([{ domain: 'Hamlet', depth: 1 }]);
    expect(await getBankLabelIndex()).toEqual([{ domain: 'Hamlet', depth: 1 }]);
    expect(getDeepGlobalDomains).toHaveBeenCalledWith(1, 400);

    getDeepGlobalDomains.mockRejectedValue(new Error('db down'));
    expect(await getBankLabelIndex()).toEqual([]);
  });
});
