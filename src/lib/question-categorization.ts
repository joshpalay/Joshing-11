import { CATEGORIES, categoryLabel } from '@/lib/questions-types';
import { foldDomainPunctuation } from '@/lib/knowledge/domain-key';

export type BroadQuestionCategory = (typeof CATEGORIES)[number];

export const DEFAULT_BROAD_QUESTION_CATEGORY: BroadQuestionCategory = 'general_knowledge';

const CATEGORY_VALUES = new Set<string>(CATEGORIES);
const CATEGORY_LABEL_TO_VALUE = new Map<string, BroadQuestionCategory>([
  ...CATEGORIES.map((category) => [categoryLabel(category).toLowerCase(), category] as const),
  ['film & television', 'film_tv'],
  ['film and television', 'film_tv'],
  ['film television', 'film_tv'],
  ['tv', 'film_tv'],
  ['television', 'film_tv'],
  ['sports', 'sport'],
  ['general', 'general_knowledge'],
  ['general knowledge', 'general_knowledge'],
  ['potpourri', 'general_knowledge'],
  ['other', 'general_knowledge'],
]);

export function isBroadQuestionCategory(value: string): value is BroadQuestionCategory {
  return CATEGORY_VALUES.has(value);
}

export function normalizeBroadQuestionCategory(value: string): BroadQuestionCategory | null {
  const normalized = value.trim();
  if (isBroadQuestionCategory(normalized)) return normalized;
  return CATEGORY_LABEL_TO_VALUE.get(normalized.toLowerCase()) ?? null;
}

export function normalizeCanonicalSubcategory(value: string): string {
  // Fold curly/typographic apostrophes to ASCII so a subcategory always has one
  // spelling. A declared interest typed as "90's" (curly via iOS auto-correct)
  // and the question pipeline's "90's" (straight) must produce the same
  // canonical subcategory, or their mastery points split across two territories.
  const normalized = foldDomainPunctuation(value).trim().replace(/\s+/g, ' ');
  const eliotNormalized = normalized.replace(/\./g, '').replace(/\s+/g, ' ').toLowerCase();
  if (eliotNormalized === 'ts eliot' || eliotNormalized === 't s eliot') {
    return 'T. S. Eliot';
  }
  return normalized;
}

export function broadCategoryDisplayName(category: string): string {
  return isBroadQuestionCategory(category) ? categoryLabel(category) : category;
}

export function normalizeBroadQuestionCategoryOrDefault(value: string | null | undefined): BroadQuestionCategory {
  if (typeof value !== 'string') return DEFAULT_BROAD_QUESTION_CATEGORY;
  return normalizeBroadQuestionCategory(value) ?? DEFAULT_BROAD_QUESTION_CATEGORY;
}
