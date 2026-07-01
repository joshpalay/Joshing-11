import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import { db, generatedQuestions, retrievalDomainHealth } from '@/server/db';
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
