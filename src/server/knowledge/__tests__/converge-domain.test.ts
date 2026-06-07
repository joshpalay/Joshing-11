import { beforeEach, describe, expect, it, vi } from 'vitest';

import { domainKey } from '@/lib/knowledge/domain-key';

const findExactCanonicalMatch = vi.fn();
const findFuzzyCanonicalMatches = vi.fn();

vi.mock('@/server/db/queries/knowledge', () => ({
  findExactCanonicalMatch: (...args: unknown[]) => findExactCanonicalMatch(...args),
  findFuzzyCanonicalMatches: (...args: unknown[]) => findFuzzyCanonicalMatches(...args),
}));

import {
  convergeDomain,
  DEFAULT_CONVERGE_FUZZY_MIN_PREVALENCE,
} from '@/server/knowledge/converge-domain';

describe('convergeDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findExactCanonicalMatch.mockResolvedValue(null);
    findFuzzyCanonicalMatches.mockResolvedValue([]);
  });

  it('always appends a "create new" candidate when nothing matches', async () => {
    const result = await convergeDomain('  Sondheim   Musicals ');
    // input is trimmed + whitespace-collapsed
    expect(result.raw).toBe('Sondheim Musicals');
    expect(result.candidates).toEqual([
      { label: 'Sondheim Musicals', broadCategory: null, kind: 'new', similarity: 0 },
    ]);
  });

  it('ranks exact first, then fuzzy by similarity desc, then create-new', async () => {
    findExactCanonicalMatch.mockResolvedValue(null);
    findFuzzyCanonicalMatches.mockResolvedValue([
      { label: 'Delta Blues', broadCategory: 'Music', prevalence: 9, similarity: 0.71 },
      { label: 'Chicago Blues', broadCategory: 'Music', prevalence: 5, similarity: 0.63 },
    ]);

    const result = await convergeDomain('Blues');

    expect(result.candidates.map((c) => [c.kind, c.label])).toEqual([
      ['fuzzy', 'Delta Blues'],
      ['fuzzy', 'Chicago Blues'],
      ['new', 'Blues'],
    ]);
  });

  it('puts the exact match first and suppresses the redundant create-new', async () => {
    findExactCanonicalMatch.mockResolvedValue({
      label: 'Late Tchaikovsky Symphonies',
      broadCategory: 'Music',
      prevalence: 12,
      similarity: 1,
    });
    findFuzzyCanonicalMatches.mockResolvedValue([]);

    // Input folds to the same domainKey as the exact match's label.
    const result = await convergeDomain('late tchaikovsky symphonies');

    expect(result.candidates).toEqual([
      {
        label: 'Late Tchaikovsky Symphonies',
        broadCategory: 'Music',
        kind: 'exact',
        similarity: 1,
      },
    ]);
    expect(result.candidates.some((c) => c.kind === 'new')).toBe(false);
  });

  it('keeps create-new when only fuzzy matches exist (escape hatch)', async () => {
    findFuzzyCanonicalMatches.mockResolvedValue([
      { label: 'Holy Roman Empire', broadCategory: 'History', prevalence: 8, similarity: 0.6 },
    ]);

    const result = await convergeDomain('Roman Empire');

    expect(result.candidates.map((c) => c.kind)).toEqual(['fuzzy', 'new']);
    expect(result.candidates.at(-1)?.label).toBe('Roman Empire');
  });

  it('drops fuzzy candidates below the privacy prevalence floor', async () => {
    findFuzzyCanonicalMatches.mockResolvedValue([
      {
        label: 'Shared Domain',
        broadCategory: 'Music',
        prevalence: DEFAULT_CONVERGE_FUZZY_MIN_PREVALENCE,
        similarity: 0.7,
      },
      { label: 'One Persons Private Phrase', broadCategory: null, prevalence: 1, similarity: 0.69 },
    ]);

    const result = await convergeDomain('Domain');

    expect(result.candidates.map((c) => c.label)).toEqual(['Shared Domain', 'Domain']);
    expect(result.candidates.some((c) => c.label === 'One Persons Private Phrase')).toBe(false);
  });

  it('does not duplicate a fuzzy match that equals the exact match key', async () => {
    findExactCanonicalMatch.mockResolvedValue({
      label: 'Jazz Fusion',
      broadCategory: 'Music',
      prevalence: 4,
      similarity: 1,
    });
    findFuzzyCanonicalMatches.mockResolvedValue([
      { label: 'jazz fusion', broadCategory: 'Music', prevalence: 4, similarity: 0.95 },
      { label: 'Acid Jazz', broadCategory: 'Music', prevalence: 6, similarity: 0.55 },
    ]);

    const result = await convergeDomain('Jazz Fusion');

    expect(result.candidates.map((c) => [c.kind, c.label])).toEqual([
      ['exact', 'Jazz Fusion'],
      ['fuzzy', 'Acid Jazz'],
    ]);
  });

  it('degrades to exact + create-new when the fuzzy query throws (pg_trgm absent)', async () => {
    findExactCanonicalMatch.mockResolvedValue(null);
    findFuzzyCanonicalMatches.mockRejectedValue(
      new Error('function similarity(text, text) does not exist'),
    );

    const result = await convergeDomain('Weimar Cinema');

    expect(result.candidates).toEqual([
      { label: 'Weimar Cinema', broadCategory: null, kind: 'new', similarity: 0 },
    ]);
  });

  it('returns an empty candidate list for blank input', async () => {
    const result = await convergeDomain('   ');
    expect(result.raw).toBe('');
    expect(result.candidates).toEqual([]);
    expect(findExactCanonicalMatch).not.toHaveBeenCalled();
  });

  it('respects the configured fuzzy limit', async () => {
    findFuzzyCanonicalMatches.mockResolvedValue([
      { label: 'A', broadCategory: null, prevalence: 5, similarity: 0.9 },
      { label: 'B', broadCategory: null, prevalence: 5, similarity: 0.8 },
      { label: 'C', broadCategory: null, prevalence: 5, similarity: 0.7 },
    ]);

    const result = await convergeDomain('thing', { limit: 2 });
    const fuzzy = result.candidates.filter((c) => c.kind === 'fuzzy');
    expect(fuzzy).toHaveLength(2);
  });

  // Guards the JS domainKey() the service uses for dedup against the corpus.
  it('uses domainKey folding so curly/straight apostrophes collapse', () => {
    expect(domainKey('90’s Hip-Hop')).toBe(domainKey("90's Hip-Hop"));
    expect(domainKey('  Mixed   CASE ')).toBe('mixed case');
  });
});
