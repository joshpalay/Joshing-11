/** Read-only category audit for the daily diagnostic. No migrations or LLM calls. */
import 'dotenv/config';
import pg from 'pg';

import { analyzeCategoryIntegrity, type RecentMerge } from '../src/server/knowledge/category-integrity';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for the category integrity audit');

  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '30s'");

  const labels = await client.query<{ label: string; rows: string }>(`
    SELECT label, count(*)::text AS rows FROM (
      SELECT canonical_subcategory AS label FROM "PLAYER_MASTERY"
      UNION ALL SELECT canonical_subcategory FROM "GeneratedQuestion"
      UNION ALL SELECT canonical_subcategory FROM "Question" WHERE canonical_subcategory IS NOT NULL
      UNION ALL SELECT domain FROM "DeclaredInterest" WHERE "isActive" = true
      UNION ALL SELECT label FROM "KnowledgeNode"
    ) category_labels
    WHERE label <> ''
    GROUP BY label
  `);
  const bank = await client.query<{ label: string; key: string | null; rows: string }>(`
    SELECT canonical_subcategory AS label, domain_key AS key, count(*)::text AS rows
    FROM "GeneratedQuestion" GROUP BY 1, 2
  `);
  const nodes = await client.query<{ label: string; domainKey: string }>(
    'SELECT label, domain_key AS "domainKey" FROM "KnowledgeNode"',
  );
  const edges = await client.query<{ childDomainKey: string; parentDomainKey: string }>(
    'SELECT child_domain_key AS "childDomainKey", parent_domain_key AS "parentDomainKey" FROM "KnowledgeEdge"',
  );
  const events = await client.query<{ metadata: unknown }>(`
    SELECT metadata FROM "MASTERY_EVENTS"
    WHERE source_type = 'domain_merged' AND created_at >= now() - interval '24 hours'
  `);
  const leaf = await client.query<{ rows: string }>(
    'SELECT count(*)::text AS rows FROM "KnowledgeLeafMastery"',
  );
  await client.query('COMMIT');

  const recentMerges: RecentMerge[] = [];
  let targetOverrides = 0;
  for (const { metadata } of events.rows) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
    const entry = metadata as Record<string, unknown>;
    if (entry.targetChanged === true) targetOverrides++;
    if (typeof entry.target !== 'string' || !Array.isArray(entry.sources)) continue;
    recentMerges.push({
      target: entry.target,
      sources: entry.sources.filter((source): source is string => typeof source === 'string'),
    });
  }

  const findings = analyzeCategoryIntegrity({
    labels: labels.rows.map(({ label, rows }) => ({ label, rows: Number(rows) })),
    bankLabels: bank.rows.map(({ label, key, rows }) => ({ label, key, rows: Number(rows) })),
    nodes: nodes.rows,
    edges: edges.rows,
    recentMerges,
  });
  const hardFailure = findings.nodeKeyMismatches.length > 0
    || findings.orphanEdges.length > 0
    || findings.hasCycle
    || findings.graphSourceMerges.length > 0;

  const summaryOnly = process.argv.includes('--summary');
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    verdict: hardFailure ? 'graph_integrity_failure' : 'ok',
    scope: { graphNodes: nodes.rowCount, graphEdges: edges.rowCount, leafAwards: Number(leaf.rows[0]?.rows ?? 0) },
    recentTidy: {
      windowHours: 24,
      appliedMerges: events.rowCount,
      targetOverrides,
      // Skipped suggestions only reach structured application logs; they are
      // deliberately not reported as zero here.
      skippedSuggestions: 'unavailable_from_database',
    },
    findings: summaryOnly ? {
      splitKeys: findings.splitKeys.length,
      nodeKeyMismatches: findings.nodeKeyMismatches.length,
      orphanEdges: findings.orphanEdges.length,
      bankKeyMismatches: findings.bankKeyMismatches.length,
      graphSourceMerges: findings.graphSourceMerges.length,
      hasCycle: findings.hasCycle,
    } : findings,
  }, null, 2));
  if (hardFailure) process.exitCode = 1;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[category-integrity] Audit failed:', error);
  process.exitCode = 1;
});
