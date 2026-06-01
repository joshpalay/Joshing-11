/**
 * fact_key normalization for daily question dedup.
 *
 * The LLM produces a short label identifying the underlying fact (not the
 * wording) — e.g. "Gotterdammerung — Hagen summons vassals (instrument)".
 * We normalize it to a stable hyphen-slug that's safe to compare across
 * re-wordings of the same trivia.
 *
 * Output shape: lowercase ASCII-ish, words joined by single hyphens, no
 * leading/trailing hyphens, capped at FACT_KEY_MAX_CHARS so a runaway label
 * can't blow up the index row width.
 */

export const FACT_KEY_MAX_CHARS = 80;

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeFactKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const ascii = value.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return null;
  return slug.length > FACT_KEY_MAX_CHARS
    ? slug.slice(0, FACT_KEY_MAX_CHARS).replace(/-+$/g, '')
    : slug;
}
