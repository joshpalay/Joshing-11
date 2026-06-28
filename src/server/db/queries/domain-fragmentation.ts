import { sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

/**
 * Tier-2 fragmentation surfacing (D-NARROW-KB-FABRICATION-01 follow-up). Tier-1
 * prevention (strengthened domainKey + authored reconcile) auto-folds the easy,
 * same-key spelling variants at write time. What it deliberately does NOT do is
 * silently merge labels that are LEXICALLY similar but whose sameness is a
 * judgment call — "Spy School" vs "Evil Spy School", "James Joyce" vs "Joyce's
 * Ulysses", or a work vs the genre that contains it. Those are exactly the
 * clusters a human should eyeball. This query finds them so the weekly digest
 * can mail them out; it never mutates anything.
 */

export type FragmentationPair = {
  domainA: string;
  depthA: number;
  domainB: string;
  depthB: number;
  /** pg_trgm trigram similarity, 0..1. */
  similarity: number;
};

type FragmentationRow = {
  domain_a: string;
  depth_a: number;
  domain_b: string;
  depth_b: number;
  sim: number;
};

// Trigram floor: low enough to catch real near-duplicates ("Spy School" /
// "Spy School Books 1-6"), high enough to keep the digest reviewable. Overridable
// without a deploy. Distinct-domain count is in the low hundreds, so the O(n^2)
// self-join is trivially cheap.
const DEFAULT_FRAGMENTATION_TRGM_THRESHOLD = 0.4;

export function getFragmentationTrgmThreshold(): number {
  const raw = process.env.DOMAIN_FRAGMENTATION_TRGM_THRESHOLD?.trim();
  if (!raw) return DEFAULT_FRAGMENTATION_TRGM_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_FRAGMENTATION_TRGM_THRESHOLD;
  }
  return parsed;
}

export async function getDomainFragmentationCandidates(
  opts: { threshold?: number; limit?: number } = {},
): Promise<FragmentationPair[]> {
  const threshold = opts.threshold ?? getFragmentationTrgmThreshold();
  const limit = opts.limit ?? 25;

  // Combined per-domain depth across the generated + authored corpus, then a
  // similarity self-join. a.domain < b.domain dedupes the symmetric pair.
  const result = await db.execute(sql`
    with corpus as (
      select canonical_subcategory as domain, count(*)::int as depth
      from "GeneratedQuestion"
      where canonical_subcategory is not null and canonical_subcategory <> ''
      group by canonical_subcategory
      union all
      select canonical_subcategory as domain, count(*)::int as depth
      from "Question"
      where canonical_subcategory is not null and canonical_subcategory <> '' and deleted_at is null
      group by canonical_subcategory
    ),
    agg as (
      select domain, sum(depth)::int as depth from corpus group by domain
    )
    select a.domain as domain_a, a.depth as depth_a,
           b.domain as domain_b, b.depth as depth_b,
           similarity(a.domain, b.domain) as sim
    from agg a
    join agg b
      on a.domain < b.domain
     and similarity(a.domain, b.domain) >= ${threshold}
    order by sim desc, (a.depth + b.depth) desc
    limit ${limit * 4}
  `);

  const rows =
    (result as unknown as { rows?: FragmentationRow[] }).rows ??
    (result as unknown as FragmentationRow[]);

  const pairs: FragmentationPair[] = [];
  for (const row of rows) {
    // Drop pairs the strengthened domainKey() already auto-folds at write time —
    // those converge on their own and need no human. Surface only distinct-key
    // near-duplicates, the genuine judgment calls.
    if (domainKey(row.domain_a) === domainKey(row.domain_b)) continue;
    pairs.push({
      domainA: row.domain_a,
      depthA: Number(row.depth_a),
      domainB: row.domain_b,
      depthB: Number(row.depth_b),
      similarity: Number(row.sim),
    });
    if (pairs.length >= limit) break;
  }
  return pairs;
}
