import { categoryLabel } from '@/lib/questions-types';

type ResolveCategoryLabelInput = {
  canonical_subcategory?: string | null;
  normalized_subcategory?: string | null;
  source_canonical_subcategory?: string | null;
  context: string;
  context_meta?: Record<string, string | number | boolean | null | undefined>;
};

/** Display bucket when no hyper-specific or broad label applies (review / round UI). */
export const UNCATEGORIZED_SUBCATEGORY_DISPLAY = 'Potpourri';

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'other') return null;
  return trimmed;
}

function coalesceHyperSpecificLabels(input: {
  canonical_subcategory?: string | null;
  normalized_subcategory?: string | null;
  source_canonical_subcategory?: string | null;
}): string | null {
  return normalizeLabel(input.canonical_subcategory)
    ?? normalizeLabel(input.normalized_subcategory)
    ?? normalizeLabel(input.source_canonical_subcategory);
}

function emitSuppressedRowTelemetry(input: ResolveCategoryLabelInput): void {
  console.info('[telemetry] missing_canonical_subcategory_row_suppressed', {
    event: 'missing_canonical_subcategory_row_suppressed',
    context: input.context,
    ...input.context_meta,
  });
}

/**
 * Product rule: every displayed points row must have a concrete canonical subcategory.
 * Fallback order is deterministic and never returns "Other".
 */
export function resolveCanonicalSubcategoryLabel(input: ResolveCategoryLabelInput): string | null {
  const resolved = coalesceHyperSpecificLabels(input);

  if (!resolved) {
    emitSuppressedRowTelemetry(input);
    return null;
  }

  return resolved;
}

export type ResolveReviewCategoryDisplayInput = ResolveCategoryLabelInput & {
  /** Prisma `Question.category` when hyper-specific fields are empty */
  broad_category_key?: string | null;
};

/**
 * End-of-review category rows: hyper-specific label, else broad category (not `other`), else Potpourri.
 * Does not emit missing-label telemetry (fallback is intentional).
 */
export function resolveReviewCategoryDisplayLabel(input: ResolveReviewCategoryDisplayInput): string {
  const specific = coalesceHyperSpecificLabels(input);
  if (specific) return specific;

  const broadKey = input.broad_category_key;
  if (broadKey && broadKey !== 'other') {
    const fromBroad = normalizeLabel(categoryLabel(broadKey));
    if (fromBroad) return fromBroad;
  }

  return UNCATEGORIZED_SUBCATEGORY_DISPLAY;
}

/**
 * Mastery round-delta buckets: hyper-specific or Potpourri (no broad category — avoids wrong tier priors).
 */
export function resolveMasteryRoundBucketLabel(input: ResolveCategoryLabelInput): string {
  return coalesceHyperSpecificLabels(input) ?? UNCATEGORIZED_SUBCATEGORY_DISPLAY;
}

