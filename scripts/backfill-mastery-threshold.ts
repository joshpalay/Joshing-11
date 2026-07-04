/**
 * Mastery v2 (points-threshold model; docs/thinking/MASTERY-MODEL-v2.md "Final
 * model") — seed KnowledgeNode.mastery_threshold (POINTS) via the LLM.
 *
 * Every node needs a points threshold: a leaf's "points to master this topic," a
 * parent's "points to master this whole area." v1 only set thresholds on parents
 * (small bars like 100–2,000) and left leaves NULL — both are wrong for the new
 * model. `--all` re-scores every node (recommended once, to replace the v1 parent
 * bars); the default touches only NULL rows.
 *
 * Uses scoreMasteryThresholdPoints (Haiku). Touches ONLY mastery_threshold.
 *
 * Read-only by default. From repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-mastery-threshold.ts          # dry-run
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-mastery-threshold.ts --apply
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-mastery-threshold.ts --all --apply
 */
import pg from 'pg';

import { scoreMasteryThresholdPoints } from '../src/server/llm/domain-depth';

const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('No DIRECT_URL/DATABASE_URL in env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

type NodeRow = { id: string; label: string; node_kind: string; mastery_threshold: number | null };

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<NodeRow>(
      ALL
        ? `SELECT id, label, node_kind, mastery_threshold FROM "KnowledgeNode" ORDER BY node_kind DESC, label`
        : `SELECT id, label, node_kind, mastery_threshold FROM "KnowledgeNode" WHERE mastery_threshold IS NULL ORDER BY node_kind DESC, label`,
    );

    console.log(`\n=== mastery_threshold seed — ${APPLY ? 'APPLY' : 'DRY RUN'}${ALL ? ' (--all)' : ''} ===`);
    console.log(`nodes to seed: ${rows.length}\n     old →  new   kind    label`);

    let changed = 0;
    for (const node of rows) {
      const points = await scoreMasteryThresholdPoints(node.label);
      const shown = points ?? '—(skip)';
      const old = node.mastery_threshold ?? '·';
      console.log(`  ${String(old).padStart(6)} → ${String(shown).padStart(6)}  ${node.node_kind.padEnd(6)}  ${node.label}`);
      if (APPLY && points !== null) {
        await client.query(`UPDATE "KnowledgeNode" SET mastery_threshold = $1 WHERE id = $2`, [
          points,
          node.id,
        ]);
        changed += 1;
      }
    }

    console.log(`\n${APPLY ? `updated ${changed} rows.` : '(dry run — pass --apply to write)'}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
