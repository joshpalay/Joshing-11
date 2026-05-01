/**
 * Canonical subcategory resolution for hyper-specific territories (PRD §8.2 / §8.31).
 * See Docs/qa-hyper-specific-categories.md for QA when LLM tagging is off or fails.
 */
import type { Category, PrismaClient } from '@prisma/client';
import { resolveCanonicalSubcategoryWithLLM } from '@/lib/llm';

type DbClient = Pick<PrismaClient, 'question'>;

const BROAD_TO_CATEGORY: Array<{ patterns: RegExp[]; category: Category }> = [
  { patterns: [/music/i], category: 'music' },
  { patterns: [/literature|poetry|novel|playwriting/i], category: 'literature' },
  { patterns: [/history|historical/i], category: 'history' },
  { patterns: [/film|television|tv/i], category: 'film_tv' },
  { patterns: [/sport|sports|athletic/i], category: 'sport' },
  { patterns: [/science|math|mathematics|biology|chemistry|physics/i], category: 'science' },
  { patterns: [/philosophy|ethics|logic/i], category: 'philosophy' },
  { patterns: [/pop culture|internet culture|gaming|celebrity/i], category: 'pop_culture' },
  { patterns: [/language|linguistics|words|etymology/i], category: 'language' },
];

const CATEGORY_TO_BROAD: Record<Category, string> = {
  music: 'Music',
  literature: 'Literature',
  history: 'History',
  film_tv: 'Film & Television',
  sport: 'Sports',
  science: 'Science',
  philosophy: 'Philosophy',
  pop_culture: 'Pop Culture',
  language: 'Language',
  other: 'Other',
};

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(era|style|broadway|musicals|music|modernism|the|of|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenJaccard(a: string, b: string): number {
  const as = new Set(normalizeLabel(a).split(' ').filter(Boolean));
  const bs = new Set(normalizeLabel(b).split(' ').filter(Boolean));
  if (as.size === 0 || bs.size === 0) return 0;
  let overlap = 0;
  for (const token of as) {
    if (bs.has(token)) overlap += 1;
  }
  const union = new Set([...as, ...bs]).size;
  return union === 0 ? 0 : overlap / union;
}

function titleize(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function mapBroadCategoryToCategory(broadCategory: string): Category {
  const matched = BROAD_TO_CATEGORY.find((rule) => rule.patterns.some((pattern) => pattern.test(broadCategory)));
  return matched?.category ?? 'other';
}

export function mapCategoryToBroadCategory(category: Category): string {
  return CATEGORY_TO_BROAD[category] ?? 'Other';
}

export async function canonicalizeSubcategoryLabel(
  db: DbClient,
  subcategory: string,
  broadCategory: string
): Promise<string> {
  const cleaned = titleize(subcategory);

  const existing = await db.question.findMany({
    where: {
      broad_category: broadCategory,
      canonical_subcategory: { not: null },
    },
    distinct: ['canonical_subcategory'],
    select: { canonical_subcategory: true },
    take: 200,
  });

  const candidates = existing
    .map((row) => row.canonical_subcategory)
    .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);

  if (candidates.length === 0) return cleaned;

  const scored = candidates
    .map((candidate) => ({ candidate, score: tokenJaccard(cleaned, candidate) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score >= 0.72) {
    return best.candidate;
  }

  const fuzzyCandidates = scored.filter((item) => item.score >= 0.45).slice(0, 5).map((item) => item.candidate);
  if (fuzzyCandidates.length === 0) return cleaned;

  const llmChoice = await resolveCanonicalSubcategoryWithLLM(cleaned, broadCategory, fuzzyCandidates);
  if (!llmChoice) return cleaned;

  return fuzzyCandidates.includes(llmChoice) ? llmChoice : cleaned;
}

export async function countQuestionsInCanonicalSubcategory(
  db: DbClient,
  canonicalSubcategory: string
): Promise<number> {
  return db.question.count({ where: { canonical_subcategory: canonicalSubcategory } });
}
