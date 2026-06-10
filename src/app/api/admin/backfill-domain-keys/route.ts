import { isNull, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, generatedQuestions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { isCronAuthorized } from '@/server/auth/cron';

export const dynamic = 'force-dynamic';

// One-off TS backfill for migration 0074 (BP-7 / C5): populate
// GeneratedQuestion.domain_key with the domainKey() fold of
// canonical_subcategory for rows that pre-date the column. The fold is TS-only
// by design (replicating it in SQL would be a second implementation that can
// drift), so the backfill runs here rather than in the migration or a boot
// guard. Idempotent: only touches rows where domain_key IS NULL, one UPDATE
// per distinct spelling. Until this has run, pickBankSource still matches old
// rows via its legacy exact-string fallback predicate — no correctness gap,
// just missed variant hits.
//
// Run (cron-authorized): curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//   $BASE_URL/api/admin/backfill-domain-keys
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const spellings = await db
    .selectDistinct({ canonicalSubcategory: generatedQuestions.canonicalSubcategory })
    .from(generatedQuestions)
    .where(isNull(generatedQuestions.domainKey));

  let rowsUpdated = 0;
  for (const { canonicalSubcategory } of spellings) {
    const folded = domainKey(canonicalSubcategory);
    const result = await db
      .update(generatedQuestions)
      .set({ domainKey: folded })
      .where(sql`${generatedQuestions.canonicalSubcategory} = ${canonicalSubcategory} AND ${generatedQuestions.domainKey} IS NULL`);
    rowsUpdated += (result as { rowCount?: number }).rowCount ?? 0;
  }

  return NextResponse.json({
    distinctSpellings: spellings.length,
    rowsUpdated,
  });
}
