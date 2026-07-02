import { describe, expect, it } from 'vitest';

import { labelSimilarity } from '@/lib/knowledge/label-similarity';

describe('labelSimilarity', () => {
  it('scores word-order variants as identical (the prod polyphony pair)', () => {
    expect(
      labelSimilarity('Medieval & Renaissance Polyphony', 'Renaissance & Medieval Polyphony'),
    ).toBe(1);
  });

  it('scores a shared-core phrasing variant above the converge threshold', () => {
    // Third member of the prod trio: one word swapped, core vocabulary shared.
    const sim = labelSimilarity(
      'Renaissance Polyphony & Imitation',
      'Renaissance & Medieval Polyphony',
    );
    expect(sim).toBeGreaterThanOrEqual(0.55);
    expect(sim).toBeLessThan(1);
  });

  it('keeps semantic-but-lexically-distant siblings apart', () => {
    // These ARE the same cluster semantically, but folding them is the
    // near-ness tree's job — lexical similarity must stay below threshold.
    expect(labelSimilarity('Renaissance Florence', 'Italian Renaissance Painting')).toBeLessThan(
      0.55,
    );
    expect(labelSimilarity('Hamlet', 'Shakespearean Tragedy')).toBeLessThan(0.55);
  });

  it('is symmetric and folds typography via domainKey', () => {
    const a = labelSimilarity("90's Hip Hop", '90’s hip hop');
    expect(a).toBe(1);
    expect(labelSimilarity('Star Trek: TNG', 'Star Trek – TNG')).toBe(1);
    expect(labelSimilarity('Tchaikovsky', 'Stravinsky')).toBe(
      labelSimilarity('Stravinsky', 'Tchaikovsky'),
    );
  });

  it('scores empty or degenerate labels as 0', () => {
    expect(labelSimilarity('', 'Hamlet')).toBe(0);
    expect(labelSimilarity('   ', '')).toBe(0);
  });
});
