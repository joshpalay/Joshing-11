/** Max length for Question.breadcrumb_context (product: ~30 chars). */
export const BREADCRUMB_MAX_LENGTH = 30;

const GENERIC_BLOCKLIST = new Set(
  [
    'music',
    'history',
    'sports',
    'sport',
    'science',
    'literature',
    'film',
    'tv',
    'philosophy',
    'language',
    'other',
    'general',
    'trivia',
    'question',
    'answer',
  ].map((s) => s.toLowerCase()),
);

/**
 * Returns an error message if invalid, or null if OK.
 */
export function validateBreadcrumbContext(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Add a short context clue (up to six words).';
  if (s.length > BREADCRUMB_MAX_LENGTH) {
    return `Keep context to ${BREADCRUMB_MAX_LENGTH} characters or fewer.`;
  }
  const wordCount = s.split(/\s+/).filter(Boolean).length;
  if (wordCount > 6) return 'Use six words or fewer.';
  const lower = s.toLowerCase();
  if (GENERIC_BLOCKLIST.has(lower)) {
    return 'Pick something more specific than a broad category label.';
  }
  return null;
}
