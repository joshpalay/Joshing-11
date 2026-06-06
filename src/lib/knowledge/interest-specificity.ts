/**
 * Granularity guard for declared interests.
 *
 * A declared interest must be hyper-specific — the thing a player is actually
 * passionate about — not a top-level category. "Technology", "Music", "general"
 * are exactly what we reject here so the add-topic field can expand them into
 * specific choices instead of saving the bucket verbatim.
 *
 * This is intentionally STRICTER than the question-subcategory guard
 * (src/server/questions/canonical-subcategory.ts), which deliberately ALLOWS
 * broad-category words like "music"/"history" in other columns. For interests
 * those bucket words are precisely what's too broad.
 *
 * Pure (no server/LLM imports) so it can run on both the client add-topic field
 * and the server write boundary.
 */
import { isBroadCategoryLabel } from '@/lib/knowledge/broad-category';

// Catch-all fillers that aren't broad-category buckets but are still too generic
// to be a passion-level interest. Mirrors FORBIDDEN_CANONICAL_SUBCATEGORIES
// (canonical-subcategory.ts) plus a few interest-specific fillers.
const GENERIC_INTEREST_LABELS = new Set<string>([
  'other',
  'general',
  'general knowledge',
  'trivia',
  'potpourri',
  'miscellaneous',
  'misc',
  'random',
  'stuff',
  'things',
  'everything',
  'anything',
]);

function normalizeForCheck(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a typed interest is too broad to stand on its own — a top-level
 * category bucket (or alias) or a generic catch-all. Callers should expand it
 * into specific choices rather than saving it as-is.
 */
export function isTooBroadInterest(topic: string | null | undefined): boolean {
  if (!topic) return true;
  const normalized = normalizeForCheck(topic);
  if (!normalized) return true;
  if (GENERIC_INTEREST_LABELS.has(normalized)) return true;
  return isBroadCategoryLabel(topic);
}

export class TooBroadInterestError extends Error {
  constructor(public readonly attempted: string) {
    super(
      `Refusing to save "${attempted}" as a declared interest: it is a broad category, not a specific topic.`,
    );
    this.name = 'TooBroadInterestError';
  }
}

/**
 * Throw if the topic is too broad to be a declared interest. Use at the
 * declared-interest write boundary as a last line of defense behind the
 * client-side add-topic field.
 */
export function assertSpecificInterest(topic: string): void {
  if (isTooBroadInterest(topic)) {
    throw new TooBroadInterestError(topic);
  }
}
