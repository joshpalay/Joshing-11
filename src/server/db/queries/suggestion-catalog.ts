import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db, generatedQuestions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

export type CatalogSuggestion = { domain: string; broadCategory: string | null };

// "Add a topic" suggestions were previously bounded to the knowledge tree's
// DIRECT unheld siblings of what the player already owns, plus ~9 hard-coded
// adjacency rules — a small, often-exhausted set (Josh, 2026-07-17: "It seems
// to only suggest what is there now as well. Could it look beyond that?").
// This looks beyond the authored graph into the REAL catalog: any topic with
// actual verified question supply under a broad category the player already
// has some presence in — same relevance test ("related to your interests"),
// far larger candidate space, since it's not limited to hand-authored graph
// edges. Verified-only + a minimum row count is a light quality bar so a
// single stray/low-confidence question doesn't surface as a suggestion.
const MIN_VERIFIED_QUESTIONS = 3;

export async function getCatalogSuggestions(
  broadCategories: readonly string[],
  excludeDomainKeys: ReadonlySet<string>,
  limit = 40,
): Promise<CatalogSuggestion[]> {
  if (broadCategories.length === 0) return [];

  const rows = await db
    .select({
      label: generatedQuestions.canonicalSubcategory,
      broadCategory: generatedQuestions.broadCategory,
    })
    .from(generatedQuestions)
    .where(
      and(
        inArray(generatedQuestions.broadCategory, [...broadCategories]),
        isNotNull(generatedQuestions.verifiedAt),
        eq(generatedQuestions.isDuplicate, false),
      ),
    )
    .groupBy(generatedQuestions.canonicalSubcategory, generatedQuestions.broadCategory)
    .having(sql`count(*) >= ${MIN_VERIFIED_QUESTIONS}`)
    // Over-fetch: some rows will fold onto an already-excluded/duplicate key
    // once normalized below, so ask for more than `limit` up front.
    .limit(limit * 3);

  const seen = new Set<string>();
  const result: CatalogSuggestion[] = [];
  for (const row of rows) {
    const label = row.label?.trim();
    if (!label) continue;
    const key = domainKey(label);
    if (excludeDomainKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({ domain: label, broadCategory: row.broadCategory });
    if (result.length >= limit) break;
  }
  return result;
}
