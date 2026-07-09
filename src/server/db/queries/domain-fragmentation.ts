import { sql } from 'drizzle-orm';

import { db, reviewedDomainPairs } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';

/**
 * The canonical, order-independent key for a reviewed pair (Part 1 of
 * D-DOMAIN-MERGE-REVIEW-REDESIGN-01). The two domains' FOLDED keys sorted
 * ascending and '::'-joined, so (A,B) and (B,A) collapse to one key and a
 * cosmetic rename that folds to the same key does not resurrect a dismissed
 * pair. Deliberately keyed on domainKey(), never the raw label.
 */
export function reviewedPairKey(a: string, b: string): string {
  return [domainKey(a), domainKey(b)].sort().join('::');
}

/** The set of pair keys a curator has permanently dismissed (Part 1). */
export async function getReviewedPairKeys(): Promise<Set<string>> {
  const rows = await db.select({ pairKey: reviewedDomainPairs.pairKey }).from(reviewedDomainPairs);
  return new Set(rows.map((r) => r.pairKey));
}

/**
 * Record a permanent Dismiss for a near-duplicate pair. Idempotent on the
 * order-independent key — a re-dismiss (or a (B,A) re-order) is a no-op that
 * refreshes the display spellings. Never surfaces again after this.
 */
export async function recordReviewedDomainPair(domainA: string, domainB: string): Promise<void> {
  const pairKey = reviewedPairKey(domainA, domainB);
  await db
    .insert(reviewedDomainPairs)
    .values({ pairKey, domainA, domainB })
    .onConflictDoUpdate({
      target: reviewedDomainPairs.pairKey,
      set: { domainA, domainB, reviewedAt: sql`now()` },
    });
}

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

  // Permanently dismissed pairs never resurface, including after a similarity
  // recompute (Part 1). Loaded once and filtered in JS because the pair key is
  // the folded domainKey() (a TS function), not a raw column comparison.
  const dismissed = await getReviewedPairKeys();

  const pairs: FragmentationPair[] = [];
  for (const row of rows) {
    // Drop pairs the strengthened domainKey() already auto-folds at write time —
    // those converge on their own and need no human. Surface only distinct-key
    // near-duplicates, the genuine judgment calls.
    if (domainKey(row.domain_a) === domainKey(row.domain_b)) continue;
    if (dismissed.has(reviewedPairKey(row.domain_a, row.domain_b))) continue;
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

/**
 * Lever A — "broad domain serving narrow" detector. Reuses the per-question
 * sub_angles the generator already emits: within a domain, if one facet tag
 * dominates a large share of the pool, the domain is leaning narrow (e.g. a
 * "Shakespearean Tragedy" pool that is mostly Hamlet). The reactive sub-angle
 * coverage loop pushes breadth over time; this just makes a regression VISIBLE
 * so a human can check whether the pool genuinely spans the domain's range.
 * Read-only. Based on GeneratedQuestion (sub_angles lives there).
 */
export type NarrowDomain = {
  domain: string;
  depth: number;
  topAngle: string;
  topAngleCount: number;
  /** topAngleCount / depth, 0..1. */
  topAngleShare: number;
  distinctAngles: number;
};

const DEFAULT_NARROW_MIN_DEPTH = 8;
const DEFAULT_NARROW_SHARE_THRESHOLD = 0.5;

function readUnitEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

export async function getNarrowlyServedDomains(
  opts: { minDepth?: number; shareThreshold?: number; limit?: number } = {},
): Promise<NarrowDomain[]> {
  const minDepth =
    opts.minDepth ?? (Number(process.env.DOMAIN_NARROW_MIN_DEPTH) || DEFAULT_NARROW_MIN_DEPTH);
  const shareThreshold =
    opts.shareThreshold ?? readUnitEnv('DOMAIN_NARROW_SHARE_THRESHOLD', DEFAULT_NARROW_SHARE_THRESHOLD);
  const limit = opts.limit ?? 25;

  const result = await db.execute(sql`
    with dq as (
      select id, canonical_subcategory as domain, sub_angles
      from "GeneratedQuestion"
      where canonical_subcategory is not null and canonical_subcategory <> ''
    ),
    domain_counts as (
      select domain, count(*)::int as depth from dq group by domain
    ),
    angle_counts as (
      select dq.domain, angle, count(distinct dq.id)::int as q_with_angle
      from dq, unnest(dq.sub_angles) as angle
      where angle is not null and angle <> ''
      group by dq.domain, angle
    ),
    ranked as (
      select ac.domain, ac.angle, ac.q_with_angle,
             row_number() over (partition by ac.domain order by ac.q_with_angle desc, ac.angle) as rn,
             count(*) over (partition by ac.domain)::int as distinct_angles
      from angle_counts ac
    )
    select r.domain, dc.depth, r.angle as top_angle, r.q_with_angle, r.distinct_angles,
           round((r.q_with_angle::numeric / dc.depth), 2) as top_share
    from ranked r
    join domain_counts dc on dc.domain = r.domain
    where r.rn = 1
      and dc.depth >= ${minDepth}
      and (r.q_with_angle::numeric / dc.depth) >= ${shareThreshold}
    order by top_share desc, dc.depth desc
    limit ${limit}
  `);

  type NarrowRow = {
    domain: string;
    depth: number;
    top_angle: string;
    q_with_angle: number;
    distinct_angles: number;
    top_share: number;
  };
  const rows = (result as unknown as { rows?: NarrowRow[] }).rows ?? (result as unknown as NarrowRow[]);

  return rows.map((r) => ({
    domain: r.domain,
    depth: Number(r.depth),
    topAngle: r.top_angle,
    topAngleCount: Number(r.q_with_angle),
    topAngleShare: Number(r.top_share),
    distinctAngles: Number(r.distinct_angles),
  }));
}
