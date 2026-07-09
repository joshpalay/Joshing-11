/**
 * Populate CORPUS-grounded domain size estimates (D-SUPPLY-FINITENESS-01).
 *
 * For each played domain, resolves it to a real Wikipedia / Wikidata / Fandom
 * anchor (Haiku, candidate-grounded), counts it shape-aware, normalizes to an
 * estimated sustainable question count, and caches it on DomainDepthEstimate
 * (source='corpus'). getTargetQuestionCountForDomains then PREFERS that number
 * over coefficient·depth². The estimate is a SEED — the finiteness loop
 * co-calibrates it from observed yield.
 *
 * Fail-open per domain: a resolver miss or a low/bespoke resolution leaves the
 * row on its depth-derived fallback (never written), so a partial run is safe.
 *
 * Read-only by default. Run from repo root (Node 24):
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-domain-size.ts               # dry-run, all played domains
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-domain-size.ts --apply        # write
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/backfill-domain-size.ts "Hamlet" "Star Trek"  # specific domains (dry-run)
 *
 * Idempotent: an upsert keyed on domain_key, so re-running refreshes in place.
 */
import { sql } from 'drizzle-orm';

import { db } from '../src/server/db';
import { domainKey } from '../src/lib/knowledge/domain-key';
import { estimateDomainSize } from '../src/server/daily/domain-size-estimate';
import { upsertCorpusSizeEstimate } from '../src/server/db/queries/domain-depth-estimate';

const APPLY = process.argv.includes('--apply');
const explicit = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function domainsToSize(): Promise<string[]> {
  if (explicit.length > 0) return explicit;
  const result = await db.execute(sql`
    SELECT DISTINCT canonical_subcategory AS d
    FROM "PLAYER_MASTERY"
    WHERE canonical_subcategory IS NOT NULL AND canonical_subcategory <> ''
  `);
  const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
  return rows.map((r) => String(r.d ?? '')).filter(Boolean);
}

async function main(): Promise<void> {
  const domains = await domainsToSize();
  // One estimate per folded domain_key; label = a representative canonical string.
  const labelByKey = new Map<string, string>();
  for (const d of domains) {
    const k = domainKey(d);
    if (!labelByKey.has(k)) labelByKey.set(k, d);
  }
  console.log(
    `${labelByKey.size} unique domain keys (${domains.length} canonical labels). ${
      APPLY ? 'APPLY — writing' : 'DRY-RUN'
    }\n`,
  );

  let sized = 0;
  let bespoke = 0;
  let failed = 0;
  for (const [key, label] of labelByKey) {
    let est = null;
    try {
      est = await estimateDomainSize(label);
    } catch {
      est = null;
    }
    if (!est) {
      failed += 1;
      console.log(`  · FAIL      ${label} (resolver returned null)`);
      await sleep(400);
      continue;
    }
    if (est.estimatedQuestions == null) {
      bespoke += 1;
      console.log(`  · bespoke   ${est.shape.padEnd(18)} ${label} (Haiku depth fallback)`);
    } else {
      sized += 1;
      console.log(
        `  · ${String(est.estimatedQuestions).padStart(5)}q  ${est.confidence.padEnd(6)} ${est.shape.padEnd(
          18,
        )} ${est.basis.padEnd(28)} ${label}`,
      );
      if (APPLY) {
        await upsertCorpusSizeEstimate({
          domainKey: key,
          sampleLabel: label,
          estimatedQuestions: est.estimatedQuestions,
          corpusCount: est.corpusCount,
          shape: est.shape,
          confidence: est.confidence,
          basis: est.basis,
          wikipediaTitle: est.wikipediaTitle,
          wikidataQid: est.wikidataQid,
          fandomHost: est.fandomHost,
        });
      }
    }
    await sleep(500);
  }

  console.log(
    `\nDone. sized=${sized} bespoke-fallback=${bespoke} failed=${failed}. ${
      APPLY ? 'Written.' : 'Dry-run — re-run with --apply to write.'
    }`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
