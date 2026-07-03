/**
 * B-DOMAIN-FRAGMENT-MERGE-01 — consolidate lexical sibling labels that predate
 * the write-path reconcile (B-CATEGORY-BANK-RECONCILE-01). The reconcile stops
 * NEW variants from minting; existing fragments (e.g. the five "…Polyphony…"
 * labels) stay split until their rows are retargeted onto one canonical
 * spelling — which is what this script does, for the EXPLICIT merge map below.
 *
 * The map is hand-curated on purpose: lexical similarity finds candidates, but
 * whether two labels name the SAME scope is a human call ("Medieval Polyphony
 * & Notre Dame School" is narrower than "Medieval & Renaissance Polyphony" and
 * must NOT fold). Add entries only after eyeballing --scan output.
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/merge-fragmented-domains.ts --scan  # cluster candidates + per-table row census
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/merge-fragmented-domains.ts         # dry-run the merge map
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/merge-fragmented-domains.ts --apply # execute, one transaction
 *
 * Apply semantics per table class:
 *   - retarget:    UPDATE canonical_subcategory/domain → target (GeneratedQuestion
 *                  also refreshes domain_key; Question/MASTERY_EVENTS/
 *                  SkippedDailyQuestion/CrafterDraftDecision are plain retargets).
 *   - consolidate: tables unique on (user, domain) — PLAYER_MASTERY sums points
 *                  into an existing target row (max tier) then deletes the source;
 *                  DeclaredInterest ORs isActive. Others hard-fail if populated —
 *                  extend deliberately, don't guess.
 *   - drop cache:  DomainRelation rows referencing a source label are deleted
 *                  (the near-ness cache rebuilds lazily); RetrievalDomainHealth
 *                  source rows are deleted (disposable health counters).
 * Any OTHER table that holds a source label (scan census) aborts the apply —
 * silent partial merges are how territories drift apart again.
 *
 * Idempotent: re-running after --apply finds 0 source rows everywhere.
 */
import pg from 'pg';

import { domainKey } from '../src/lib/knowledge/domain-key';
import { labelSimilarity } from '../src/lib/knowledge/label-similarity';

const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('No DIRECT_URL/DATABASE_URL in env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const SCAN = process.argv.includes('--scan');
const SCAN_THRESHOLD = 0.55;

// ─── The merge map (hand-curated; see header) ────────────────────────────────
// target = the surviving spelling (the cluster's most-populated label unless a
// better display form exists). sources fold into it and cease to exist.
// Curated from the 2026-07-02 --scan (36 candidate clusters). Included: case/
// spacing/punctuation variants, word-order flips, and unambiguous phrasing
// variants of the SAME scope. Deliberately EXCLUDED (different scope, however
// lexically close): other/Other (generic bucket, not a territory), "80's
// Cartoons" (different decade than the 90's cluster), "Tudor Dynasty" vs
// "Tudor Dynasty Marriages", "Hollywood Golden Age" vs "…Biographies", the Spy
// School BOOKS (distinct titles), "Star Trek" vs TNG, "New Testament" vs
// "…Authorship", "Plant Biology & Taxonomy" vs "Plant Taxonomy & Genera",
// "Neuroanatomy & CNS Physiology" vs "Human Anatomy & Physiology", "NASA
// Apollo Program" vs "…Missions", "Classical Symphonic Music" vs the Romantic
// Era pair. Those are the graph's job (containment), never a string merge.
const MERGES: Array<{ target: string; sources: string[] }> = [
  {
    // Word-order/phrasing variants of one territory. The other two "polyphony"
    // labels in the corpus stay out: "Medieval Polyphony & Notre Dame School"
    // (narrower) and "Polyphony & Western Music Theory" (broader).
    target: 'Renaissance & Medieval Polyphony',
    sources: ['Medieval & Renaissance Polyphony', 'Renaissance Polyphony & Imitation'],
  },
  { target: "1990's Cartoons", sources: ["90's Cartoons", "1990's cartoons"] },
  { target: 'The Golden Girls', sources: ['Golden Girls TV Show'] },
  { target: 'Romantic Era Classical Symphony Music', sources: ['Romantic Era Classical symphony music'] },
  { target: 'CranioSacral Therapy', sources: ['Craniosacral Therapy'] },
  { target: "90's Ballywood", sources: ["90's ballywood"] },
  { target: "Bach's Keyboard Works", sources: ['Bach Keyboard Works'] },
  {
    target: 'Star Trek: The Next Generation',
    sources: ['Star Trek the Next Generation', 'Star Trek: the Next Generation', 'Star Trek TNG'],
  },
  { target: '1980s Action & Adventure Cartoons', sources: ['Action & Adventure Cartoons of the 1980s'] },
  { target: 'UX Design', sources: ['Ux Design'] },
  { target: 'Mrs. Dalloway', sources: ['Mrs Dalloway'] },
  { target: 'The Product Development Lifecycle', sources: ['The product development lifecycle'] },
  { target: 'Baseball Fundamentals', sources: ['Baseball fundamentals'] },
  { target: 'American Lesbian History', sources: ['American lesbian history'] },
  { target: 'Narrative Technique & Time in Mrs. Dalloway', sources: ['Mrs. Dalloway — Narrative Technique & Time'] },
  { target: 'Mortgage Backed Securities', sources: ['Mortgage backed securities'] },
  { target: 'Stephen Sondheim Musicals', sources: ['Stephen Sondheim musicals'] },
  { target: 'Outlander Book Series', sources: ['Outlander book series'] },
  {
    target: 'Ancient Roman History and Republic-to-Empire Transition',
    sources: ['Ancient Roman History and Republic-To-Empire Transition'],
  },
  { target: 'High-End Bourbon', sources: ['High-end bourbon'] },
  { target: 'Early CGI in Film (1980s)', sources: ['Early CGI In Film (1980s)'] },
  { target: 'D-Day Invasion', sources: ['D-day invasion'] },
  { target: 'Rent the Musical', sources: ['Rent The Musical'] },
  { target: 'Early 20th Century American History', sources: ['Early 20th century American History'] },
  { target: "Bach's Fugal Technique", sources: ['Bach Fugue Technique'] },
  { target: 'T. S. Eliot', sources: ['T.S. Eliot'] },
  // Same author-corpus, phrasing variant — the 75-row canonical form wins.
  { target: "Virginia Woolf's Novels and Essays", sources: ['Virginia Woolf Novels'] },
  // 2026-07-03: same scope (the whole series), differ only by an author-name
  // prefix that changes the domainKey so the deterministic fold missed it
  // (lexical sim 0.606). NOT "Harry Potter Book 3" — that's a narrower topic
  // and belongs UNDER the series via a graph edge, never a string merge.
  { target: 'Harry Potter Series', sources: ["J.K. Rowling's Harry Potter Series"] },
];

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Every (table, column) pair that can hold a domain label, discovered from the
// live catalog so a future table can't silently escape the census.
async function domainColumns(client: pg.Client): Promise<Array<{ table: string; column: string }>> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('canonical_subcategory', 'domain', 'child_domain', 'related_domain', 'label')
      AND table_name NOT IN ('KnowledgeNode')  -- graph labels are authored, never auto-merged
    ORDER BY table_name, column_name
  `);
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }));
}

async function census(
  client: pg.Client,
  labels: string[],
): Promise<Array<{ table: string; column: string; label: string; rows: number }>> {
  const out: Array<{ table: string; column: string; label: string; rows: number }> = [];
  for (const { table, column } of await domainColumns(client)) {
    const { rows } = await client.query<{ label: string; n: string }>(
      `SELECT "${column}" AS label, count(*) AS n FROM "${table}"
       WHERE "${column}" = ANY($1) GROUP BY 1`,
      [labels],
    );
    for (const r of rows) out.push({ table, column, label: r.label, rows: Number(r.n) });
  }
  return out;
}

// ─── --scan: lexical cluster candidates over the whole corpus ────────────────
async function scan(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ label: string; n: string }>(`
    SELECT canonical_subcategory AS label, sum(n) AS n FROM (
      SELECT canonical_subcategory, count(*) AS n FROM "GeneratedQuestion" GROUP BY 1
      UNION ALL
      SELECT canonical_subcategory, count(*) AS n FROM "Question" WHERE deleted_at IS NULL GROUP BY 1
      UNION ALL
      SELECT canonical_subcategory, count(*) AS n FROM "PLAYER_MASTERY" GROUP BY 1
    ) t WHERE canonical_subcategory IS NOT NULL GROUP BY 1
  `);
  const labels = rows.map((r) => ({ label: r.label, n: Number(r.n) }));

  const seen = new Set<number>();
  let clusters = 0;
  for (let i = 0; i < labels.length; i += 1) {
    if (seen.has(i)) continue;
    const cluster = [i];
    for (let j = i + 1; j < labels.length; j += 1) {
      if (seen.has(j)) continue;
      if (
        domainKey(labels[i].label) === domainKey(labels[j].label) ||
        labelSimilarity(labels[i].label, labels[j].label) >= SCAN_THRESHOLD
      ) {
        cluster.push(j);
        seen.add(j);
      }
    }
    if (cluster.length < 2) continue;
    clusters += 1;
    console.log(`\nCLUSTER ${clusters} (verify same-scope by eye before adding to MERGES):`);
    for (const k of cluster) {
      const sim = labelSimilarity(labels[cluster[0]].label, labels[k].label).toFixed(2);
      console.log(`  ${labels[k].label}  (corpus rows=${labels[k].n}, sim=${sim})`);
    }
    const involved = cluster.map((k) => labels[k].label);
    for (const row of await census(client, involved)) {
      console.log(`    · ${row.table}.${row.column}: ${sqlLiteral(row.label)} × ${row.rows}`);
    }
  }
  if (clusters === 0) console.log('No lexical clusters found — the corpus is clean.');
}

// ─── dry-run / apply the merge map ───────────────────────────────────────────

// Tables the apply path knows how to handle, by semantics. Anything else that
// the census finds populated for a source label ABORTS.
const RETARGET: Array<{ table: string; column: string }> = [
  { table: 'Question', column: 'canonical_subcategory' },
  { table: 'GeneratedQuestion', column: 'canonical_subcategory' },
  { table: 'MASTERY_EVENTS', column: 'canonical_subcategory' },
  { table: 'SkippedDailyQuestion', column: 'canonical_subcategory' },
  { table: 'CrafterDraftDecision', column: 'domain' },
];
const DROP_CACHE: Array<{ table: string; column: string }> = [
  { table: 'DomainRelation', column: 'child_domain' },
  { table: 'DomainRelation', column: 'related_domain' },
  { table: 'RetrievalDomainHealth', column: 'domain' },
];
const CONSOLIDATE_TABLES = new Set([
  'PLAYER_MASTERY',
  'DeclaredInterest',
  'USER_DOMAIN_DIFFICULTY',
  'PROFILE_DOMAIN_VISIBILITY',
  'USER_DOMAIN_EXCLUSIONS',
  'DAILY_REFINE_DECISION',
]);

// Per-row rename with a unique-collision fallback: when the user already has an
// equivalent row for the target label, the survivor's state stands and the
// source row is dropped. Fits any per-user cache/ledger whose unique key
// includes the label column (USER_DOMAIN_EXCLUSIONS, DAILY_REFINE_DECISION).
async function renameOrDropRows(
  client: pg.Client,
  table: string,
  column: string,
  target: string,
  sources: string[],
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM "${table}" WHERE "${column}" = ANY($1)`,
    [sources],
  );
  for (const row of rows) {
    try {
      await client.query(`SAVEPOINT rename_row`);
      await client.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [target, row.id]);
      await client.query(`RELEASE SAVEPOINT rename_row`);
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      await client.query(`ROLLBACK TO SAVEPOINT rename_row`);
      await client.query(`DELETE FROM "${table}" WHERE id = $1`, [row.id]);
    }
    console.log(`  ${table}: consolidated row ${row.id}`);
  }
}

// Schema order (masteryTierEnum) — the stronger tier survives a mastery merge.
const TIER_RANK: Record<string, number> = { establishing: 0, familiar: 1, solid: 2, mastery: 3 };

async function run(client: pg.Client): Promise<void> {
  const allSources = MERGES.flatMap((m) => m.sources);
  const rows = await census(client, allSources);
  if (rows.length === 0) {
    console.log('Nothing to merge — no source-label rows anywhere (already applied?).');
    return;
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to execute)'} — merge map:`);
  for (const m of MERGES) {
    console.log(`  → ${m.target}`);
    for (const s of m.sources) console.log(`    ← ${s}`);
  }
  console.log('\nRows holding a source label:');
  for (const r of rows) console.log(`  ${r.table}.${r.column}: ${sqlLiteral(r.label)} × ${r.rows}`);

  const handled = new Set([
    ...RETARGET.map((t) => `${t.table}.${t.column}`),
    ...DROP_CACHE.map((t) => `${t.table}.${t.column}`),
  ]);
  const unhandled = rows.filter(
    (r) => !handled.has(`${r.table}.${r.column}`) && !CONSOLIDATE_TABLES.has(r.table),
  );
  if (unhandled.length > 0) {
    console.error('\nABORT — rows exist in tables this script does not consolidate:');
    for (const r of unhandled) console.error(`  ${r.table}.${r.column}: ${r.rows}`);
    console.error('Extend the script deliberately for these before applying.');
    process.exitCode = 1;
    return;
  }

  if (!APPLY) return;

  await client.query('BEGIN');
  try {
    for (const { target, sources } of MERGES) {
      const targetKey = domainKey(target);

      for (const { table, column } of RETARGET) {
        const extra =
          table === 'GeneratedQuestion' ? `, "domain_key" = ${sqlLiteral(targetKey)}` : '';
        const res = await client.query(
          `UPDATE "${table}" SET "${column}" = $1${extra} WHERE "${column}" = ANY($2)`,
          [target, sources],
        );
        if (res.rowCount) console.log(`  ${table}: retargeted ${res.rowCount}`);
      }

      // PLAYER_MASTERY: unique (user_id, canonical_subcategory). Sum a source
      // row into an existing target row (max tier wins), else rename in place.
      const mastery = await client.query<{
        id: string;
        user_id: string;
        canonical_subcategory: string;
        tier: string;
      }>(
        `SELECT id, user_id, canonical_subcategory, tier FROM "PLAYER_MASTERY"
         WHERE canonical_subcategory = ANY($1)`,
        [sources],
      );
      for (const row of mastery.rows) {
        const existing = await client.query<{ id: string; tier: string }>(
          `SELECT id, tier FROM "PLAYER_MASTERY" WHERE user_id = $1 AND canonical_subcategory = $2`,
          [row.user_id, target],
        );
        if (existing.rows.length > 0) {
          const strongerTier =
            (TIER_RANK[row.tier] ?? 0) > (TIER_RANK[existing.rows[0].tier] ?? 0)
              ? row.tier
              : existing.rows[0].tier;
          await client.query(
            `UPDATE "PLAYER_MASTERY" t SET
               total_points = t.total_points + s.total_points,
               lifetime_points_baseline = coalesce(t.lifetime_points_baseline, 0) + coalesce(s.lifetime_points_baseline, 0),
               tier = $3::"MasteryTier",
               updated_at = greatest(t.updated_at, s.updated_at)
             FROM "PLAYER_MASTERY" s WHERE t.id = $1 AND s.id = $2`,
            [existing.rows[0].id, row.id, strongerTier],
          );
          await client.query(`DELETE FROM "PLAYER_MASTERY" WHERE id = $1`, [row.id]);
          console.log(`  PLAYER_MASTERY: summed ${row.canonical_subcategory} into ${target} (user ${row.user_id})`);
        } else {
          await client.query(`UPDATE "PLAYER_MASTERY" SET canonical_subcategory = $1 WHERE id = $2`, [
            target,
            row.id,
          ]);
          console.log(`  PLAYER_MASTERY: renamed for user ${row.user_id}`);
        }
      }

      // USER_DOMAIN_DIFFICULTY: unique (user_id, canonical_subcategory) — an
      // adaptive-difficulty cache. Rename to the target unless the user already
      // has a target row; then the survivor's ladder state stands and the
      // source row is dropped.
      const difficulty = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM "USER_DOMAIN_DIFFICULTY" WHERE canonical_subcategory = ANY($1)`,
        [sources],
      );
      for (const row of difficulty.rows) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM "USER_DOMAIN_DIFFICULTY" WHERE user_id = $1 AND canonical_subcategory = $2`,
          [row.user_id, target],
        );
        if (existing.rows.length > 0) {
          await client.query(`DELETE FROM "USER_DOMAIN_DIFFICULTY" WHERE id = $1`, [row.id]);
        } else {
          await client.query(
            `UPDATE "USER_DOMAIN_DIFFICULTY" SET canonical_subcategory = $1 WHERE id = $2`,
            [target, row.id],
          );
        }
        console.log(`  USER_DOMAIN_DIFFICULTY: consolidated for user ${row.user_id}`);
      }

      // PROFILE_DOMAIN_VISIBILITY: unique per (user_id, canonical_subcategory)
      // AND (user_id, domain) — both columns carry the label, both retarget.
      // On collision the survivor's visibility choice stands.
      const visibility = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM "PROFILE_DOMAIN_VISIBILITY"
         WHERE canonical_subcategory = ANY($1) OR domain = ANY($1)`,
        [sources],
      );
      for (const row of visibility.rows) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM "PROFILE_DOMAIN_VISIBILITY"
           WHERE user_id = $1 AND (canonical_subcategory = $2 OR domain = $2) AND id <> $3`,
          [row.user_id, target, row.id],
        );
        if (existing.rows.length > 0) {
          await client.query(`DELETE FROM "PROFILE_DOMAIN_VISIBILITY" WHERE id = $1`, [row.id]);
        } else {
          await client.query(
            `UPDATE "PROFILE_DOMAIN_VISIBILITY" SET canonical_subcategory = $1, domain = $1 WHERE id = $2`,
            [target, row.id],
          );
        }
        console.log(`  PROFILE_DOMAIN_VISIBILITY: consolidated for user ${row.user_id}`);
      }

      // DeclaredInterest: unique (userId, domain) — NB camelCase columns on
      // this older table. OR isActive on collision.
      const declared = await client.query<{ id: string; userId: string }>(
        `SELECT id, "userId" FROM "DeclaredInterest" WHERE domain = ANY($1)`,
        [sources],
      );
      for (const row of declared.rows) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM "DeclaredInterest" WHERE "userId" = $1 AND domain = $2`,
          [row.userId, target],
        );
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE "DeclaredInterest" t SET "isActive" = t."isActive" OR s."isActive"
             FROM "DeclaredInterest" s WHERE t.id = $1 AND s.id = $2`,
            [existing.rows[0].id, row.id],
          );
          await client.query(`DELETE FROM "DeclaredInterest" WHERE id = $1`, [row.id]);
        } else {
          await client.query(`UPDATE "DeclaredInterest" SET domain = $1 WHERE id = $2`, [target, row.id]);
        }
        console.log(`  DeclaredInterest: consolidated for user ${row.userId}`);
      }

      await renameOrDropRows(client, 'USER_DOMAIN_EXCLUSIONS', 'canonical_subcategory', target, sources);
      await renameOrDropRows(client, 'DAILY_REFINE_DECISION', 'canonical_subcategory', target, sources);

      for (const { table, column } of DROP_CACHE) {
        const res = await client.query(`DELETE FROM "${table}" WHERE "${column}" = ANY($1)`, [sources]);
        if (res.rowCount) console.log(`  ${table}: dropped ${res.rowCount} cache rows (${column})`);
      }
    }
    await client.query('COMMIT');
    console.log('\n✓ Applied. Re-run without flags to confirm 0 remaining source rows.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    if (SCAN) await scan(client);
    else await run(client);
  } finally {
    await client.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
