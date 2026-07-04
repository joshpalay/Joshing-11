/**
 * Read/write layer for DomainReferencePassage (0108, D-FANDOM-GROUNDING-01) —
 * the per-domain reference-passage cache. Retrieval/orchestration lives in
 * src/server/daily/domain-reference.ts; this module only touches the table.
 */
import { inArray, sql } from 'drizzle-orm';

import { db, domainReferencePassage } from '@/server/db';

export type ReferenceSource = 'wikipedia' | 'fandom' | 'none';

export type DomainReferenceRow = {
  canonicalSubcategory: string;
  source: ReferenceSource;
  passage: string | null;
  fetchedAt: Date;
};

/** Cached rows for the given domains (fresh or stale — the caller applies TTL). */
export async function getReferencePassageRows(
  domains: string[],
): Promise<Map<string, DomainReferenceRow>> {
  if (domains.length === 0) return new Map();
  const rows = await db
    .select({
      canonicalSubcategory: domainReferencePassage.canonicalSubcategory,
      source: domainReferencePassage.source,
      passage: domainReferencePassage.passage,
      fetchedAt: domainReferencePassage.fetchedAt,
    })
    .from(domainReferencePassage)
    .where(inArray(domainReferencePassage.canonicalSubcategory, domains));
  return new Map(
    rows.map((r) => [
      r.canonicalSubcategory,
      { ...r, source: r.source as ReferenceSource },
    ]),
  );
}

/**
 * Upsert one domain's retrieval outcome (including the 'none' negative cache —
 * a covered-by-neither-wiki result is still a result; re-billing it daily is
 * exactly the waste the cache exists to prevent).
 */
export async function upsertReferencePassage(row: {
  canonicalSubcategory: string;
  source: ReferenceSource;
  passage: string | null;
  sourceUrl: string | null;
}): Promise<void> {
  await db
    .insert(domainReferencePassage)
    .values({ ...row, fetchedAt: sql`now()` })
    .onConflictDoUpdate({
      target: domainReferencePassage.canonicalSubcategory,
      set: {
        source: row.source,
        passage: row.passage,
        sourceUrl: row.sourceUrl,
        fetchedAt: sql`now()`,
      },
    });
}
