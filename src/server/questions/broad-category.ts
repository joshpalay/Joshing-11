/**
 * Broad-category normalization (Change 3).
 *
 * `broad_category` on generated/canonical questions is FREE-FORM LLM output — the
 * model emits drifting synonyms for the same bucket ("Literature" vs
 * "Literature & Drama" vs "Literature & Poetry"; "Musical Theatre" vs
 * "Theater & Musicals"). That fragments the one-domain-per-category diversity
 * grouping in selectDiverseDomains and muddies per-category analytics.
 *
 * There is no authoritative broad-category taxonomy in this repo, so this is a
 * deliberately CONSERVATIVE fold: it (a) canonicalizes whitespace, ampersands and
 * casing, then (b) maps a small set of obviously-equivalent labels onto one
 * canonical form. Anything not in the alias map passes through with only the
 * cosmetic normalization applied — we never guess at merging genuinely-distinct
 * categories (e.g. "Science & Nature" is left alone, not folded into "Botany").
 */

/** Cosmetic pass: trim, collapse internal whitespace, normalize " and " → " & ". */
function canonicalizeShape(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+and\s+/gi, ' & ');
}

// Alias map keyed by the lowercased, shape-canonicalized label → canonical label.
// Keep additions to clearly-equivalent variants only.
const BROAD_CATEGORY_ALIASES: Record<string, string> = {
  // Literature family
  'literature & drama': 'Literature',
  'literature & poetry': 'Literature',
  'fiction & literature': 'Literature',
  'literature & fiction': 'Literature',
  'drama & literature': 'Literature',
  // Theater / musical theater family
  'musical theater': 'Theater & Musicals',
  'musical theatre': 'Theater & Musicals',
  'theater': 'Theater & Musicals',
  'theatre': 'Theater & Musicals',
  'theater & musicals': 'Theater & Musicals',
  'theatre & musicals': 'Theater & Musicals',
  // Film / television family
  'television': 'Film & Television',
  'film & tv': 'Film & Television',
  'tv & film': 'Film & Television',
  'television & animation': 'Film & Television',
  'film & television': 'Film & Television',
  // Classical music family
  'classical music & opera': 'Classical Music',
  'classical music': 'Classical Music',
};

/**
 * Fold a broad-category label to its canonical form. Null/blank/undefined pass
 * through unchanged (callers decide the fallback bucket).
 */
export function normalizeBroadCategory<T extends string | null | undefined>(value: T): T {
  if (!value) return value;
  const shaped = canonicalizeShape(value);
  const alias = BROAD_CATEGORY_ALIASES[shaped.toLowerCase()];
  return (alias ?? shaped) as T;
}
