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
 * The APPLY/PREVIEW transaction itself now lives in
 * src/server/db/queries/domain-merges.ts, shared verbatim with the admin
 * decision UI (/admin/domains) so there is one copy of the prod-mutating logic.
 * This script owns the hand-curated MERGES map, --scan cluster discovery, and
 * the CLI reporting; it passes its own pg.Client into the shared applier.
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/merge-fragmented-domains.ts --scan  # cluster candidates + per-table row census
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/merge-fragmented-domains.ts         # dry-run the merge map
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/merge-fragmented-domains.ts --apply # execute, one transaction
 *
 * Apply semantics per table class (see the shared module for the full detail):
 *   - retarget:    Question/GeneratedQuestion/MASTERY_EVENTS/SkippedDailyQuestion/
 *                  CrafterDraftDecision (GeneratedQuestion also refreshes domain_key).
 *   - consolidate: per-(user, domain) tables — PLAYER_MASTERY sums points (max tier);
 *                  DeclaredInterest ORs isActive; the rest rename-or-drop on collision.
 *   - drop cache:  DomainRelation / RetrievalDomainHealth source rows deleted.
 * Any OTHER table that holds a source label aborts the apply — silent partial
 * merges are how territories drift apart again.
 *
 * Idempotent: re-running after --apply finds 0 source rows everywhere.
 */
import pg from 'pg';

import {
  applyDomainMerges,
  censusDomainLabels,
  previewDomainMerges,
  type DomainMergeSpec,
} from '../src/server/db/queries/domain-merges';
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
const MERGES: DomainMergeSpec[] = [
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
    for (const row of await censusDomainLabels(client, involved)) {
      console.log(`    · ${row.table}.${row.column}: ${sqlLiteral(row.label)} × ${row.rows}`);
    }
  }
  if (clusters === 0) console.log('No lexical clusters found — the corpus is clean.');
}

// ─── dry-run / apply the merge map (delegates to the shared applier) ──────────
async function run(client: pg.Client): Promise<void> {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to execute)'} — merge map:`);
  for (const m of MERGES) {
    console.log(`  → ${m.target}`);
    for (const s of m.sources) console.log(`    ← ${s}`);
  }

  const preview = await previewDomainMerges(client, MERGES);
  if (preview.census.length === 0) {
    console.log('\nNothing to merge — no source-label rows anywhere (already applied?).');
    return;
  }
  console.log('\nRows holding a source label:');
  for (const r of preview.census) {
    console.log(`  ${r.table}.${r.column}: ${sqlLiteral(r.label)} × ${r.rows}`);
  }

  if (preview.unhandled.length > 0) {
    console.error('\nABORT — rows exist in tables this script does not consolidate:');
    for (const r of preview.unhandled) console.error(`  ${r.table}.${r.column}: ${r.rows}`);
    console.error('Extend src/server/db/queries/domain-merges.ts deliberately for these before applying.');
    process.exitCode = 1;
    return;
  }

  if (!APPLY) return;

  const result = await applyDomainMerges(client, MERGES);
  if (!result.ok) {
    // Should not happen (preview already gated), but never claim success on !ok.
    console.error(`\nABORT — apply returned ${result.reason}.`);
    process.exitCode = 1;
    return;
  }
  for (const line of result.log) console.log(`  ${line}`);
  console.log(`\n✓ Applied (${result.retargeted} rows retargeted). Re-run without flags to confirm 0 remaining source rows.`);
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
