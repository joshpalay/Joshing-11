const SUPPRESSED_CATEGORY_LABELS = new Set([
  'other',
  'uncategorized',
  'general',
  'general knowledge',
]);

export function visibleFeedCategory(category?: string | null) {
  const trimmed = category?.trim();
  if (!trimmed) return null;

  if (SUPPRESSED_CATEGORY_LABELS.has(trimmed.toLowerCase())) return null;

  return trimmed;
}
