/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) Phase 2 — seed
 * KnowledgeNode.node_weight for existing nodes.
 *
 * New nodes are seeded at creation (the admin route). This backfills the ones
 * that predate the column — Phase 0 (2026-07-04) counted ~86 unseeded (77 leaves
 * + 9 "both"). For each null-weight node it computes a depth weight via
 * computeNodeWeight (Wikidata child-count → LLM fallback; the SAME path the route
 * uses) and, with --apply, writes it. It touches ONLY node_weight — never labels,
 * edges, mastery, or questions.
 *
 * NOTE: computing calls Wikidata (free) and occasionally Haiku (cheap) even in
 * dry-run, so the report shows the values that WOULD be written. By default only
 * NULL-weight rows are touched; --all re-seeds every node (human overrides are
 * lost — use deliberately).
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-node-weight.ts          # dry-run report
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-node-weight.ts --apply   # write
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-node-weight.ts --all --apply
 *
 * Idempotent: re-running without --all reports 0 remaining (every row is seeded).
 */
import pg from 'pg';

import { computeNodeWeight } from '../src/server/knowledge/node-weight';

const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('No DIRECT_URL/DATABASE_URL in env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

type NodeRow = { id: string; label: string; node_weight: number | null };

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<NodeRow>(
      ALL
        ? `SELECT id, label, node_weight FROM "KnowledgeNode" ORDER BY label`
        : `SELECT id, label, node_weight FROM "KnowledgeNode" WHERE node_weight IS NULL ORDER BY label`,
    );

    console.log(`\n=== node_weight backfill — ${APPLY ? 'APPLY' : 'DRY RUN'}${ALL ? ' (--all)' : ''} ===`);
    console.log(`nodes to seed: ${rows.length}\n`);

    const bySource = { wikidata: 0, llm: 0, none: 0 };
    let changed = 0;

    for (const node of rows) {
      const { weight, source } = await computeNodeWeight(node.label);
      bySource[source] += 1;
      const shown = weight ?? '—(unseeded)';
      console.log(`  ${String(shown).padStart(11)}  [${source.padEnd(8)}]  ${node.label}`);

      if (APPLY && weight !== null) {
        await client.query(`UPDATE "KnowledgeNode" SET node_weight = $1 WHERE id = $2`, [
          weight,
          node.id,
        ]);
        changed += 1;
      }
    }

    console.log(`\nby source — wikidata: ${bySource.wikidata}, llm: ${bySource.llm}, none: ${bySource.none}`);
    if (APPLY) {
      console.log(`updated ${changed} rows.`);
    } else {
      console.log('\n(no writes — pass --apply to execute)');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
