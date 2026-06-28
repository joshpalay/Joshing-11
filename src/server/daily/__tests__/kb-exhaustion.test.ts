import { afterEach, describe, expect, it } from 'vitest';

import {
  isAreaExpansionThinnessTriggerEnabled,
  isNarrowKbGuardEnabled,
  narrowKbThinnessThreshold,
  selectThinnestEligibleArea,
  selectUngroundedExcludedDomains,
  type DomainGuardInput,
} from '@/server/daily/kb-exhaustion';

const GUARD_VARS = [
  'NARROW_KB_GUARD_ENABLED',
  'RETRIEVAL_POOL_DEPTH_THRESHOLD',
  'AREA_EXPANSION_THINNESS_TRIGGER_ENABLED',
] as const;
const saved: Record<string, string | undefined> = {};
for (const v of GUARD_VARS) saved[v] = process.env[v];

afterEach(() => {
  for (const v of GUARD_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

function input(domain: string, isDeclaredInterest: boolean, poolDepth: number): DomainGuardInput {
  return { domain, isDeclaredInterest, poolDepth };
}

describe('selectUngroundedExcludedDomains', () => {
  it('excludes a declared-interest domain whose pool is thinner than the threshold', () => {
    const excluded = selectUngroundedExcludedDomains([input('Spy School Books 1-6', true, 7)], 8);
    expect([...excluded]).toEqual(['Spy School Books 1-6']);
  });

  it('keeps a declared-interest domain whose pool has reached the threshold', () => {
    // depth === threshold is NOT thin (boundary is strictly `< threshold`): a
    // domain mined/grounded up to the threshold rejoins normal generation.
    const excluded = selectUngroundedExcludedDomains([input('World War II', true, 8)], 8);
    expect(excluded.size).toBe(0);
  });

  it('keeps a declared-interest domain whose pool is well past the threshold', () => {
    const excluded = selectUngroundedExcludedDomains([input('World War II', true, 250)], 8);
    expect(excluded.size).toBe(0);
  });

  it('never excludes a demonstrated (non-declared) domain even when thin', () => {
    // A thin demonstrated domain is usually just new, not a narrow fan KB.
    const excluded = selectUngroundedExcludedDomains([input('Cricket', false, 1)], 8);
    expect(excluded.size).toBe(0);
  });

  it('partitions a mixed batch correctly', () => {
    const excluded = selectUngroundedExcludedDomains(
      [
        input('Spy School Books 1-6', true, 7), // declared + thin  -> excluded
        input('Wagner Ring Cycle', true, 3), // declared + thin  -> excluded
        input('Renaissance Painting', true, 40), // declared + deep  -> kept
        input('Local Geography', false, 2), // demonstrated     -> kept
      ],
      8,
    );
    expect([...excluded].sort()).toEqual(['Spy School Books 1-6', 'Wagner Ring Cycle']);
  });

  it('returns an empty set for an empty batch', () => {
    expect(selectUngroundedExcludedDomains([], 8).size).toBe(0);
  });
});

describe('selectThinnestEligibleArea', () => {
  const none = new Set<string>();

  it('returns null when nothing is thin', () => {
    expect(
      selectThinnestEligibleArea([{ domain: 'World War II', poolDepth: 40 }], 8, none),
    ).toBeNull();
  });

  it('picks the single thinnest area among several thin ones (A3: one graduation)', () => {
    const picked = selectThinnestEligibleArea(
      [
        { domain: 'Pride', poolDepth: 5 },
        { domain: 'Wagner Ring Cycle', poolDepth: 2 },
        { domain: 'Hamlet', poolDepth: 7 },
        { domain: 'Renaissance Painting', poolDepth: 40 }, // not thin
      ],
      8,
      none,
    );
    expect(picked).toBe('Wagner Ring Cycle');
  });

  it('treats depth === threshold as NOT thin (same boundary as the guard)', () => {
    expect(selectThinnestEligibleArea([{ domain: 'Pride', poolDepth: 8 }], 8, none)).toBeNull();
  });

  it('skips an area already offered, falling through to the next thinnest', () => {
    const picked = selectThinnestEligibleArea(
      [
        { domain: 'Wagner Ring Cycle', poolDepth: 2 },
        { domain: 'Pride', poolDepth: 5 },
      ],
      8,
      new Set(['Wagner Ring Cycle']),
    );
    expect(picked).toBe('Pride');
  });

  it('breaks ties on depth by domain name for determinism', () => {
    const picked = selectThinnestEligibleArea(
      [
        { domain: 'Sloth', poolDepth: 3 },
        { domain: 'Envy', poolDepth: 3 },
      ],
      8,
      none,
    );
    expect(picked).toBe('Envy');
  });
});

describe('area-expansion thinness trigger config', () => {
  it('defaults the thinness trigger OFF', () => {
    delete process.env.AREA_EXPANSION_THINNESS_TRIGGER_ENABLED;
    expect(isAreaExpansionThinnessTriggerEnabled()).toBe(false);
  });

  it('honors common truthy spellings of the flag', () => {
    for (const truthy of ['true', '1', 'yes', 'on']) {
      process.env.AREA_EXPANSION_THINNESS_TRIGGER_ENABLED = truthy;
      expect(isAreaExpansionThinnessTriggerEnabled()).toBe(true);
    }
  });
});

describe('narrow-KB guard config', () => {
  it('defaults the guard OFF', () => {
    delete process.env.NARROW_KB_GUARD_ENABLED;
    expect(isNarrowKbGuardEnabled()).toBe(false);
  });

  it('honors common truthy spellings of the flag', () => {
    for (const truthy of ['true', '1', 'yes', 'on', 'TRUE']) {
      process.env.NARROW_KB_GUARD_ENABLED = truthy;
      expect(isNarrowKbGuardEnabled()).toBe(true);
    }
  });

  it('shares grounding’s pool-depth threshold (no drift between supply and guard)', () => {
    process.env.RETRIEVAL_POOL_DEPTH_THRESHOLD = '12';
    expect(narrowKbThinnessThreshold()).toBe(12);
  });

  it('falls back to the default threshold of 8 when unset', () => {
    delete process.env.RETRIEVAL_POOL_DEPTH_THRESHOLD;
    expect(narrowKbThinnessThreshold()).toBe(8);
  });
});
