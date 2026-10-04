/**
 * Aggregate, read-only Cassian bank audit. Prints no user IDs, topic names,
 * candidate text, or question content. The rollout cutoff is the successful
 * production deployment of PR #1744, not its merge time.
 *
 * CASSIAN_ENV_FILE=.env.local npx tsx scripts/cassian-bank-audit.ts
 */
import { config } from 'dotenv';
import pg from 'pg';
import { domainKey } from '../src/lib/knowledge/domain-key';

config({ path: process.env.CASSIAN_ENV_FILE || '.env.local', quiet: true });
const deployedAt = '2026-10-03T17:28:30Z';
const key = (fact: string, text: string) =>
  `${fact}\u0000${text.trim().toLowerCase().replace(/\s+/g, ' ')}`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const builds = await client.query(
      `SELECT CASE WHEN completed_at < $1::timestamptz THEN 'pre_7d' ELSE 'post' END AS period,
        count(*)::int AS builds, count(DISTINCT user_id)::int AS users,
        sum(final_size)::int AS final_slots, sum(bank_hit_count)::int AS bank_hits,
        sum(bank_miss_count)::int AS bank_misses, sum(generate_call_count)::int AS generate_calls,
        count(*) FILTER (WHERE generate_call_count=0)::int AS zero_generate_builds,
        sum((SELECT count(*) FROM jsonb_array_elements(bank_attempts) a WHERE a->>'loosened'='true'))::int AS loosened_hits,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY user_visible_ms) AS ready_p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY user_visible_ms) AS ready_p95_ms
        FROM "DailyBuildMetric" WHERE outcome='built' AND NOT aborted
          AND completed_at >= $1::timestamptz - interval '7 days'
        GROUP BY 1 ORDER BY 1`,
      [deployedAt],
    );
    const reasons = await client.query(
      `SELECT CASE WHEN m.completed_at < $1::timestamptz THEN 'pre_7d' ELSE 'post' END AS period,
        COALESCE(a->>'missReason','none') AS reason, count(*)::int AS attempts
        FROM "DailyBuildMetric" m CROSS JOIN LATERAL jsonb_array_elements(m.bank_attempts) a
        WHERE m.outcome='built' AND NOT m.aborted AND a->>'outcome'='miss'
          AND m.completed_at >= $1::timestamptz - interval '7 days'
        GROUP BY 1,2 ORDER BY 1,2`,
      [deployedAt],
    );
    const daily =
      await client.query(`SELECT date(completed_at AT TIME ZONE 'America/New_York') AS day,
        count(*)::int AS builds, sum(final_size)::int AS final_slots,
        sum(bank_hit_count)::int AS bank_hits, sum(generate_call_count)::int AS generate_calls
        FROM "DailyBuildMetric" WHERE outcome='built' AND NOT aborted
          AND completed_at >= now() - interval '12 days' GROUP BY 1 ORDER BY 1`);
    const interest = await client.query(
      `SELECT "userId" AS user_id, domain FROM "DeclaredInterest" WHERE "isActive"=true`,
    );
    const bank =
      await client.query(`SELECT id, user_id, domain_key, canonical_subcategory, difficulty_estimate,
        fact_key, question_text, used_in_queue, is_duplicate, trust_tier, n_answered, empirical_correct_rate,
        created_at
        FROM "GeneratedQuestion" WHERE fact_key IS NOT NULL`);
    const answered =
      await client.query(`SELECT DISTINCT me.answered_by_user_id AS user_id, g.fact_key
        FROM "MASTERY_EVENTS" me JOIN "Question" q ON q.id=me.question_id
        JOIN "GeneratedQuestion" g ON g.id=q.generated_question_id WHERE g.fact_key IS NOT NULL`);
    const cassian = await client.query(`SELECT DISTINCT r.admin_user_id AS user_id, c.fact_key
        FROM "CassianReview" r JOIN "CassianCandidate" c ON c.id=r.candidate_id`);
    const ledger = await client.query(
      `SELECT spent_usd, reserved_usd FROM "CassianRun" WHERE id='cassian-pilot-2026-10-03'`,
    );
    const reference = await client.query(`SELECT count(*)::int AS cached_topics,
        count(*) FILTER (WHERE fetched_at >= now()-interval '1 day')::int AS fresh_24h,
        count(*) FILTER (WHERE fetched_at >= now()-interval '7 days')::int AS fresh_7d
        FROM "DomainReferencePassage"`);
    const seen = new Set<string>(
      [...answered.rows, ...cassian.rows].map((r) => `${r.user_id}\u0000${r.fact_key}`),
    );
    const byDomain = new Map<string, typeof bank.rows>();
    for (const row of bank.rows) {
      const d = row.domain_key || domainKey(row.canonical_subcategory);
      const list = byDomain.get(d) ?? [];
      list.push(row);
      byDomain.set(d, list);
    }
    const pairKeys = new Set<string>();
    const pairStats: Array<{
      eligible: number;
      raw: number;
      tiers: Record<string, number>;
      answeredOut: number;
    }> = [];
    for (const row of interest.rows) {
      const d = domainKey(row.domain);
      const p = `${row.user_id}\u0000${d}`;
      if (pairKeys.has(p)) continue;
      pairKeys.add(p);
      const stock = (byDomain.get(d) ?? []).filter((q) => !q.is_duplicate);
      const eligible = stock.filter(
        (q) =>
          (q.user_id !== row.user_id || !q.used_in_queue) &&
          !seen.has(`${row.user_id}\u0000${q.fact_key}`) &&
          !(q.empirical_correct_rate === 0 && q.n_answered >= 5),
      );
      const tiers: Record<string, number> = {};
      for (const q of eligible)
        tiers[q.difficulty_estimate] = (tiers[q.difficulty_estimate] ?? 0) + 1;
      pairStats.push({
        raw: stock.length,
        eligible: eligible.length,
        tiers,
        answeredOut: stock.filter((q) => seen.has(`${row.user_id}\u0000${q.fact_key}`)).length,
      });
    }
    const groups = new Map<string, { users: Set<string>; rows: number; recentRows: number }>();
    const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const row of bank.rows.filter((q) => q.used_in_queue)) {
      const k = key(row.fact_key, row.question_text);
      const g = groups.get(k) ?? { users: new Set<string>(), rows: 0, recentRows: 0 };
      g.users.add(row.user_id);
      g.rows++;
      if (new Date(row.created_at).getTime() >= recentCutoff) g.recentRows++;
      groups.set(k, g);
    }
    const cross = [...groups.values()].filter((g) => g.users.size >= 2);
    const activeDomains = new Set(interest.rows.map((r) => domainKey(r.domain)));
    console.log(
      JSON.stringify(
        {
          deployedAt,
          builds: builds.rows,
          missReasons: reasons.rows,
          daily: daily.rows,
          supply: {
            activeDeclaredDomains: activeDomains.size,
            userDomainPairs: pairStats.length,
            pairsNoRawStock: pairStats.filter((p) => p.raw === 0).length,
            pairsNoEligibleStock: pairStats.filter((p) => p.eligible === 0).length,
            pairsOneToTwoEligible: pairStats.filter((p) => p.eligible >= 1 && p.eligible <= 2)
              .length,
            pairsThreePlusEligible: pairStats.filter((p) => p.eligible >= 3).length,
            eligibleByTier: Object.fromEntries(
              ['accessible', 'moderate', 'specialist'].map((t) => [
                t,
                pairStats.reduce((n, p) => n + (p.tiers[t] ?? 0), 0),
              ]),
            ),
            answeredOutRowsAcrossPairs: pairStats.reduce((n, p) => n + p.answeredOut, 0),
          },
          crossPlayerExactText: {
            queuePlacedRows: bank.rows.filter((q) => q.used_in_queue).length,
            uniqueFactTextGroups: groups.size,
            groupsWithMultipleUsers: cross.length,
            placementsInMultiUserGroups: cross.reduce((n, g) => n + g.rows, 0),
            additionalUserPlacements: cross.reduce((n, g) => n + g.users.size - 1, 0),
            last30dPlacedRows: [...groups.values()].reduce((n, g) => n + g.recentRows, 0),
            last30dRowsInMultiUserGroups: cross.reduce((n, g) => n + g.recentRows, 0),
          },
          ledger: ledger.rows[0],
          referenceCache: reference.rows[0],
          caveat:
            'Supply is a declared-interest approximation; it omits selected-mode preferences, open-report suppression, same-build avoidance, domain floor and the tier ladder. Cross-user exact-text groups are a conservative proxy for shared-bank placements, not explicit source lineage.',
        },
        null,
        2,
      ),
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
