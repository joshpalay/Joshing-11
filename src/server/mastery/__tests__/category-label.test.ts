import { describe, expect, it, vi } from 'vitest';
import {
  resolveCanonicalSubcategoryLabel,
  resolveMasteryRoundBucketLabel,
  resolveReviewCategoryDisplayLabel,
  UNCATEGORIZED_SUBCATEGORY_DISPLAY,
} from '@/server/mastery/category-label';

describe('resolveCanonicalSubcategoryLabel', () => {
  it('uses canonical_subcategory first', () => {
    expect(
      resolveCanonicalSubcategoryLabel({
        canonical_subcategory: 'North American Geography',
        normalized_subcategory: 'Fallback',
        source_canonical_subcategory: 'Source',
        context: 'test',
      }),
    ).toBe('North American Geography');
  });

  it('falls back deterministically and never allows Other', () => {
    expect(
      resolveCanonicalSubcategoryLabel({
        canonical_subcategory: 'Other',
        normalized_subcategory: 'Late Bach Works',
        source_canonical_subcategory: 'Source',
        context: 'test',
      }),
    ).toBe('Late Bach Works');
  });

  it('suppresses unresolved rows and emits telemetry', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(
      resolveCanonicalSubcategoryLabel({
        canonical_subcategory: 'Other',
        normalized_subcategory: ' ',
        source_canonical_subcategory: null,
        context: 'test',
      }),
    ).toBeNull();
    expect(infoSpy).toHaveBeenCalledWith(
      '[telemetry] missing_canonical_subcategory_row_suppressed',
      expect.objectContaining({
        event: 'missing_canonical_subcategory_row_suppressed',
        context: 'test',
      }),
    );
    infoSpy.mockRestore();
  });
});

describe('resolveReviewCategoryDisplayLabel', () => {
  it('uses hyper-specific labels first', () => {
    expect(
      resolveReviewCategoryDisplayLabel({
        canonical_subcategory: 'Baroque Ornamentation',
        broad_category_key: 'music',
        context: 'test',
      }),
    ).toBe('Baroque Ornamentation');
  });

  it('falls back to broad category when hyper-specific is missing', () => {
    expect(
      resolveReviewCategoryDisplayLabel({
        canonical_subcategory: null,
        normalized_subcategory: null,
        source_canonical_subcategory: null,
        broad_category_key: 'science',
        context: 'test',
      }),
    ).toBe('Science');
  });

  it('uses Potpourri when only broad is other', () => {
    expect(
      resolveReviewCategoryDisplayLabel({
        canonical_subcategory: null,
        broad_category_key: 'other',
        context: 'test',
      }),
    ).toBe(UNCATEGORIZED_SUBCATEGORY_DISPLAY);
  });

  it('uses Potpourri when nothing else applies', () => {
    expect(
      resolveReviewCategoryDisplayLabel({
        canonical_subcategory: null,
        broad_category_key: null,
        context: 'test',
      }),
    ).toBe(UNCATEGORIZED_SUBCATEGORY_DISPLAY);
  });

  it('does not emit telemetry when falling back to Potpourri', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(
      resolveReviewCategoryDisplayLabel({
        canonical_subcategory: null,
        broad_category_key: null,
        context: 'test',
      }),
    ).toBe(UNCATEGORIZED_SUBCATEGORY_DISPLAY);
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });
});

describe('resolveMasteryRoundBucketLabel', () => {
  it('returns hyper-specific when present', () => {
    expect(
      resolveMasteryRoundBucketLabel({
        canonical_subcategory: 'Cell Biology',
        context: 'mastery.round_delta',
      }),
    ).toBe('Cell Biology');
  });

  it('returns Potpourri instead of broad category', () => {
    expect(
      resolveMasteryRoundBucketLabel({
        canonical_subcategory: null,
        normalized_subcategory: null,
        source_canonical_subcategory: null,
        context: 'mastery.round_delta',
      }),
    ).toBe(UNCATEGORIZED_SUBCATEGORY_DISPLAY);
  });
});
