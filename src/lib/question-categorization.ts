import { CATEGORIES, categoryLabel } from '@/lib/questions-types';

export type BroadQuestionCategory = (typeof CATEGORIES)[number];

const CATEGORY_VALUES = new Set<string>(CATEGORIES);
const CATEGORY_LABEL_TO_VALUE = new Map<string, BroadQuestionCategory>(
  CATEGORIES.map((category) => [categoryLabel(category).toLowerCase(), category]),
);

export function isBroadQuestionCategory(value: string): value is BroadQuestionCategory {
  return CATEGORY_VALUES.has(value);
}

export function normalizeBroadQuestionCategory(value: string): BroadQuestionCategory | null {
  const normalized = value.trim();
  if (isBroadQuestionCategory(normalized)) return normalized;
  return CATEGORY_LABEL_TO_VALUE.get(normalized.toLowerCase()) ?? null;
}

export function normalizeCanonicalSubcategory(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const eliotNormalized = normalized.replace(/\./g, '').replace(/\s+/g, ' ').toLowerCase();
  if (eliotNormalized === 'ts eliot' || eliotNormalized === 't s eliot') {
    return 'T. S. Eliot';
  }
  return normalized;
}

export function broadCategoryDisplayName(category: string): string {
  return isBroadQuestionCategory(category) ? categoryLabel(category) : category;
}
