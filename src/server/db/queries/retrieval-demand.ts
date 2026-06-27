import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db, generatedQuestions } from '@/server/db';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import type { RecentDailyQuestionEntry, RecentFactKeyEntry } from '@/server/db/queries/daily';

export type ThinActiveDomain = {
  domain: string;
  /** Distinct facts currently in the durable machine pool for this domain. */
  depth: number;
  /** Most recent machine-pool activity for the domain (the "active" proxy). */
  lastActivity: Date;
};

// Derive the demand signal for B3 pool refill WITHOUT a new backlog table: the
// domains real users are being served (recent machine-pool activity) whose
// durable pool is THIN (few distinct facts). This is the reconstructed "on-miss"
// set — exactly the domains a per-user build keeps falling through to fresh
// generation on because pickBankSource can't satisfy them. Thinnest-first so a
// capped run spends on the domains that need it most.
export async function getThinActiveDomains(opts: {
  depthThreshold: number;
  activeLookbackDays: number;
  limit: number;
}): Promise<ThinActiveDomain[]> {
  const sinceMs = Date.now() - opts.activeLookbackDays * 24 * 60 * 60 * 1000;
  const since = new Date(sinceMs);

  const rows = await db
    .select({
      domain: generatedQuestions.canonicalSubcategory,
      depth: sql<number>`count(distinct ${generatedQuestions.factKey})`,
      lastActivity: sql<Date>`max(${generatedQuestions.createdAt})`,
    })
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.isDuplicate, false),
      isNotNull(generatedQuestions.factKey),
    ))
    .groupBy(generatedQuestions.canonicalSubcategory)
    .having(
      sql`max(${generatedQuestions.createdAt}) >= ${since} and count(distinct ${generatedQuestions.factKey}) < ${opts.depthThreshold}`,
    );

  return rows
    .map((row) => ({
      domain: row.domain,
      depth: Number(row.depth),
      lastActivity: row.lastActivity instanceof Date ? row.lastActivity : new Date(row.lastActivity),
    }))
    .filter((row) => !isGenericSubcategory(row.domain))
    .sort((a, b) => a.depth - b.depth || b.lastActivity.getTime() - a.lastActivity.getTime())
    .slice(0, opts.limit);
}

// Durable machine-pool depth (distinct non-duplicate, fact-keyed rows) for a
// specific set of domains, as a Map keyed by canonical_subcategory. Same depth
// metric getThinActiveDomains derives demand from — reused by the narrow-KB
// exhaustion guard (src/server/daily/kb-exhaustion.ts) so "thin" means the same
// thing on both the grounding (supply) and the guard (suppress-fabrication)
// side. Domains with no pooled facts are simply absent from the map (caller
// treats a miss as depth 0).
export async function getDurablePoolDepthForDomains(
  domains: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (domains.length === 0) return result;

  const rows = await db
    .select({
      domain: generatedQuestions.canonicalSubcategory,
      depth: sql<number>`count(distinct ${generatedQuestions.factKey})`,
    })
    .from(generatedQuestions)
    .where(and(
      inArray(generatedQuestions.canonicalSubcategory, [...domains]),
      eq(generatedQuestions.isDuplicate, false),
      isNotNull(generatedQuestions.factKey),
    ))
    .groupBy(generatedQuestions.canonicalSubcategory);

  for (const row of rows) result.set(row.domain, Number(row.depth));
  return result;
}

// Existing pool facts for a domain, shaped as the avoid lists buildUserPrompt
// expects, so the grounded call doesn't re-mint a fact the pool already holds.
export async function getDomainPoolAvoidLists(
  domain: string,
  limit: number,
): Promise<{ questionTexts: RecentDailyQuestionEntry[]; factKeys: RecentFactKeyEntry[] }> {
  const rows = await db
    .select({
      questionText: generatedQuestions.questionText,
      factKey: generatedQuestions.factKey,
    })
    .from(generatedQuestions)
    .where(and(
      eq(generatedQuestions.canonicalSubcategory, domain),
      eq(generatedQuestions.isDuplicate, false),
      isNotNull(generatedQuestions.factKey),
    ))
    .orderBy(desc(generatedQuestions.createdAt))
    .limit(limit);

  const questionTexts: RecentDailyQuestionEntry[] = [];
  const factKeys: RecentFactKeyEntry[] = [];
  for (const row of rows) {
    questionTexts.push({ domain, text: row.questionText });
    if (row.factKey) factKeys.push({ domain, factKey: row.factKey });
  }
  return { questionTexts, factKeys };
}
