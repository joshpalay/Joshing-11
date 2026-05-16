/**
 * F4.5 — write-boundary guard against generic bucket labels landing in
 * questions.canonical_subcategory.
 *
 * PRD principle: "Other is never used as a category; hyper-specific labels
 * are preserved." The categorization LLM re-prompts when it returns a
 * generic value (see GENERIC_SUBCATEGORY_NORMALIZED in src/lib/llm.ts).
 * This module is the LAST line of defense — if a generic label somehow
 * makes it past the LLM helpers, the DB write should refuse it.
 *
 * The set below is intentionally smaller than the LLM helper's superset:
 * only the strictly-forbidden bucket terms. Broad-category words like
 * "music" or "history" are re-prompted but allowed in other columns.
 */

const FORBIDDEN_CANONICAL_SUBCATEGORIES = new Set<string>([
  'other',
  'general',
  'general knowledge',
  'general_knowledge',
  'trivia',
  'potpourri',
])

function normalizeForCheck(value: string): string {
  return value
    .trim()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function isGenericSubcategory(value: string | null | undefined): boolean {
  if (!value) return true
  return FORBIDDEN_CANONICAL_SUBCATEGORIES.has(normalizeForCheck(value))
}

export class GenericCanonicalSubcategoryError extends Error {
  constructor(public readonly attempted: string | null | undefined) {
    super(
      `Refusing to persist question with generic canonical_subcategory '${
        attempted ?? '(empty)'
      }'. The categorizer must return a hyper-specific label.`,
    )
    this.name = 'GenericCanonicalSubcategoryError'
  }
}

/**
 * Throw if the value is a generic bucket label (or empty). Use this at
 * every write boundary that lands on questions.canonical_subcategory.
 */
export function assertSpecificCanonicalSubcategory(
  value: string | null | undefined,
): asserts value is string {
  if (isGenericSubcategory(value)) {
    throw new GenericCanonicalSubcategoryError(value)
  }
}
