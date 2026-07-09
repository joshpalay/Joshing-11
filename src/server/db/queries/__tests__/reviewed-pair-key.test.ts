import { describe, expect, it } from 'vitest';

import { reviewedPairKey } from '@/server/db/queries/domain-fragmentation';

// D-DOMAIN-MERGE-REVIEW-REDESIGN-01 Part 1 — the Dismiss key must be
// order-independent and ID-based (folded domainKey), so (A,B) and (B,A) collapse
// to one row AND a cosmetic rename that folds to the same key can't resurrect a
// dismissed pair.
describe('reviewedPairKey', () => {
  it('is order-independent: (A,B) and (B,A) produce the same key', () => {
    expect(reviewedPairKey('Spy School', 'Evil Spy School')).toBe(
      reviewedPairKey('Evil Spy School', 'Spy School'),
    );
  });

  it('folds typographic/connector spelling variants to one key (survives rename)', () => {
    // Curly vs straight apostrophe, and colon-connector vs space — both fold in
    // domainKey, so a rename between these spellings keeps the pair dismissed.
    expect(reviewedPairKey('90’s Hip Hop', 'Rap')).toBe(reviewedPairKey("90's Hip Hop", 'Rap'));
    expect(reviewedPairKey('Star Trek: TNG', 'Star Wars')).toBe(
      reviewedPairKey('Star Trek - TNG', 'Star Wars'),
    );
  });

  it('keeps genuinely different domains on distinct keys', () => {
    expect(reviewedPairKey('Alien', 'Predator')).not.toBe(
      reviewedPairKey('Alien: Covenant', 'Predator'),
    );
  });

  it('joins the two folded keys sorted ascending with "::"', () => {
    expect(reviewedPairKey('Beta', 'Alpha')).toBe('alpha::beta');
  });
});
