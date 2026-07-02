import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { db, generatedQuestions, retrievalDomainHealth } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { getClusterContext, substantiveDescendants } from '@/server/knowledge/graph';
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
  /** Adaptive timeout exclusion (0/undefined disables): drop domains that have
   *  timed out this many times consecutively and are still within the cooldown. */
  excludeTimeoutThreshold?: number;
  timeoutCooldownDays?: number;
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

  // Adaptive timeout exclusion (B-SUPPLY-REFILL-THROUGHPUT-01 follow-up): drop
  // domains still cooling off after repeated timeouts BEFORE the cap, so a
  // chronically-slow domain doesn't keep consuming a refill slot every run. The
  // exclusion only affects refill demand — getDurablePoolDepthForDomains (the
  // guard / expansion) is untouched.
  const coolingOff = await getCoolingOffDomains(opts.excludeTimeoutThreshold, opts.timeoutCooldownDays);

  return rows
    .map((row) => ({
      domain: row.domain,
      depth: Number(row.depth),
      lastActivity: row.lastActivity instanceof Date ? row.lastActivity : new Date(row.lastActivity),
    }))
    .filter((row) => !isGenericSubcategory(row.domain) && !coolingOff.has(row.domain))
    .sort((a, b) => a.depth - b.depth || b.lastActivity.getTime() - a.lastActivity.getTime())
    .slice(0, opts.limit);
}

// Domains currently excluded from refill demand because they have timed out
// `threshold`+ times consecutively and are still within `cooldownDays`. Empty when
// the feature is disabled (threshold <= 0) or nothing qualifies.
async function getCoolingOffDomains(threshold?: number, cooldownDays?: number): Promise<Set<string>> {
  if (!threshold || threshold <= 0) return new Set();
  const cutoff = new Date(Date.now() - Math.max(1, cooldownDays ?? 7) * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ domain: retrievalDomainHealth.domain })
    .from(retrievalDomainHealth)
    .where(and(
      gte(retrievalDomainHealth.consecutiveTimeouts, threshold),
      gte(retrievalDomainHealth.lastTimeoutAt, cutoff),
    ));
  return new Set(rows.map((r) => r.domain));
}

// Record each processed domain's refill outcome for the adaptive timeout
// exclusion. A timeout increments the consecutive-timeout counter; a completed
// generation resets it to zero; a domain that neither timed out nor generated
// (rare empty result) is left unchanged. Best-effort and per-domain isolated —
// a health write must never sink the refill run.
export async function recordDomainRefillHealth(
  outcomes: readonly { domain: string; timedOut: boolean; completed: boolean }[],
): Promise<void> {
  for (const o of outcomes) {
    try {
      if (o.timedOut) {
        await db.execute(sql`
          insert into "RetrievalDomainHealth" ("domain", "consecutive_timeouts", "last_timeout_at", "updated_at")
          values (${o.domain}, 1, now(), now())
          on conflict ("domain") do update set
            "consecutive_timeouts" = "RetrievalDomainHealth"."consecutive_timeouts" + 1,
            "last_timeout_at" = now(),
            "updated_at" = now()
        `);
      } else if (o.completed) {
        await db.execute(sql`
          insert into "RetrievalDomainHealth" ("domain", "consecutive_timeouts", "last_success_at", "updated_at")
          values (${o.domain}, 0, now(), now())
          on conflict ("domain") do update set
            "consecutive_timeouts" = 0,
            "last_success_at" = now(),
            "updated_at" = now()
        `);
      }
    } catch (err) {
      console.warn('[pool-refill] recordDomainRefillHealth failed (best-effort)', {
        domain: o.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Durable machine-pool depth (distinct non-duplicate, fact-keyed rows) for a
// specific set of domains, as a Map keyed by canonical_subcategory. Same depth
// metric getThinActiveDomains derives demand from — reused by the narrow-KB
// exhaustion guard (src/server/daily/kb-exhaustion.ts) so "thin" means the same
// thing on both the grounding (supply) and the guard (suppress-fabrication)
// side. Domains with no pooled facts are simply absent from the map (caller
// treats a miss as depth 0).
//
// GRAPH-AWARE (B-SUPPLY-GRAPH-DEPTH-01): when a requested domain has an
// authored KnowledgeNode, its depth counts distinct facts across its
// substantive descendant subtree too — questions filed under "Medici Family"
// count toward "Renaissance Florence" once that edge is authored. With an
// empty graph (or on any graph fault) the exact-label counts below are the
// whole answer, byte-identical to the pre-graph behavior.
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

  try {
    const ctx = await getClusterContext();
    if (ctx.nodeKeys.size === 0 || ctx.edges.length === 0) return result;

    // Requested domains that are authored nodes with at least one substantive
    // descendant — the only ones whose depth can differ from the base count.
    const descendantsByDomain = new Map<string, Set<string>>();
    for (const domain of domains) {
      const key = domainKey(domain);
      if (!ctx.nodeKeys.has(key)) continue;
      const descendants = substantiveDescendants(key, ctx.edges);
      if (descendants.size > 0) descendantsByDomain.set(domain, descendants);
    }
    if (descendantsByDomain.size === 0) return result;

    const involvedKeys = new Set<string>();
    for (const [domain, descendants] of descendantsByDomain) {
      involvedKeys.add(domainKey(domain));
      for (const key of descendants) involvedKeys.add(key);
    }
    const involvedLabels = [...involvedKeys]
      .map((key) => ctx.labelByKey.get(key))
      .filter((label): label is string => Boolean(label));

    // Distinct (label, key, fact) triples over the involved subtrees, deduped
    // in memory per cluster — summing per-label distinct counts would double-
    // count a fact minted under two sibling labels. Rows whose stored
    // domain_key is NULL (pre-backfill) fall back to folding the label here.
    const pairRows = await db
      .selectDistinct({
        label: generatedQuestions.canonicalSubcategory,
        storedKey: generatedQuestions.domainKey,
        factKey: generatedQuestions.factKey,
      })
      .from(generatedQuestions)
      .where(and(
        eq(generatedQuestions.isDuplicate, false),
        isNotNull(generatedQuestions.factKey),
        or(
          inArray(generatedQuestions.domainKey, [...involvedKeys]),
          inArray(generatedQuestions.canonicalSubcategory, involvedLabels),
        ),
      ));

    for (const [domain, descendants] of descendantsByDomain) {
      const clusterKeys = new Set([domainKey(domain), ...descendants]);
      const facts = new Set<string>();
      for (const row of pairRows) {
        if (!row.factKey) continue;
        const rowKey = row.storedKey ?? domainKey(row.label);
        if (clusterKeys.has(rowKey)) facts.add(row.factKey);
      }
      // Never below the base exact-label count: the roll-up only adds.
      if (facts.size > (result.get(domain) ?? 0)) result.set(domain, facts.size);
    }
  } catch (err) {
    console.warn('[pool-depth] graph roll-up skipped (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
